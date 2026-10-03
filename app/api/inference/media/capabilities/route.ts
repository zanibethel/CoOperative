import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = `coop-user:${userId}`;
  const admin = createAdminSupabaseClient();

  try {
    const [{ data: settings, error: settingsError }, { data: capabilities, error: capabilitiesError }, { data: tests, error: testsError }] =
      await Promise.all([
        admin
          .from("personal_ai_settings")
          .select("media_content_preference,adult_content_acknowledged_at")
          .eq("user_id", userId)
          .maybeSingle(),
        admin
          .from("media_model_capabilities")
          .select(
            "provider,model,endpoint,adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at,reference_capability,reference_capability_source,notes,updated_at",
          )
          .order("provider")
          .order("model"),
        admin
          .from("media_model_capability_tests")
          .select(
            "id,provider,model,endpoint,test_type,outcome,source_job_id,prompt_classification,notes,tested_at",
          )
          .eq("owner_ref", ownerRef)
          .order("tested_at", { ascending: false })
          .limit(200),
      ]);

    if (settingsError) throw settingsError;
    if (capabilitiesError) throw capabilitiesError;
    if (testsError) throw testsError;

    const latestByModelAndTest = new Map<
      string,
      NonNullable<typeof tests>[number]
    >();
    for (const test of tests || []) {
      const key = [
        test.provider,
        test.model,
        test.endpoint || "",
        test.test_type,
      ].join("|");
      if (!latestByModelAndTest.has(key)) latestByModelAndTest.set(key, test);
    }

    const models = (capabilities || []).map((model) => {
      const modelTests = [...latestByModelAndTest.values()].filter(
        (test) =>
          test.provider === model.provider &&
          test.model === model.model &&
          (test.endpoint || "") === (model.endpoint || ""),
      );

      return {
        provider: model.provider,
        model: model.model,
        endpoint: model.endpoint,
        adultContentPolicy: model.adult_content_policy,
        adultContentPolicySource: model.adult_content_policy_source,
        adultContentPolicyCheckedAt: model.adult_content_policy_checked_at,
        adultNonExplicitPolicy: model.adult_non_explicit_policy,
        adultNonExplicitPolicySource: model.adult_non_explicit_policy_source,
        adultNonExplicitPolicyCheckedAt:
          model.adult_non_explicit_policy_checked_at,
        adultExplicitPolicy: model.adult_explicit_policy,
        adultExplicitPolicySource: model.adult_explicit_policy_source,
        adultExplicitPolicyCheckedAt: model.adult_explicit_policy_checked_at,
        referenceCapability: model.reference_capability,
        referenceCapabilitySource: model.reference_capability_source,
        notes: model.notes,
        updatedAt: model.updated_at,
        latestTests: modelTests.map((test) => ({
          id: test.id,
          testType: test.test_type,
          outcome: test.outcome,
          sourceJobId: test.source_job_id,
          promptClassification: test.prompt_classification,
          notes: test.notes,
          testedAt: test.tested_at,
        })),
      };
    });

    return NextResponse.json(
      {
        preference: {
          mediaContentPreference:
            settings?.media_content_preference || "sfw_only",
          adultContentAcknowledgedAt:
            settings?.adult_content_acknowledged_at || null,
        },
        models,
        routingApplied: true,
        executionGateApplied: true,
        evidenceRefreshEndpoint: "/api/inference/media/capabilities/refresh",
        capabilityTestEndpoint: "/api/inference/media/capabilities/test",
        note:
          "Recommendation routing and execution-time gating use scoped capability evidence. SFW requests remain eligible for the best-fit model regardless of adult capability. General provider policy evidence is source metadata, not proof that an exact model supports a particular adult-output scope.",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not load media capability metadata.";

    return NextResponse.json(
      {
        error: "Could not load media capability metadata.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
