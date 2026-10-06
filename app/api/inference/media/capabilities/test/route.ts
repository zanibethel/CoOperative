import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";
import {
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";
import {
  ensureMediaCapabilityRouteCatalog,
} from "@/lib/inference/media-policy-evidence";
import {
  MEDIA_SMOKE_PROMPTS,
  mediaCapabilitySmokeRoutes,
  type MediaSmokeScope,
} from "@/lib/inference/media-capability-smoke-matrix";
import {
  mediaContentPreferenceForUser,
  recordMediaModelCapabilityTest,
  type MediaCapabilityTestOutcome,
} from "@/lib/inference/media-model-capabilities";
import {
  openRouterKeySpendStatus,
} from "@/lib/inference/openrouter-media-catalog";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import {
  mediaBenchmarkEvidenceForOwner,
  mediaBenchmarkSummaryForRoute,
} from "@/lib/inference/media-model-benchmarks";

export const runtime = "nodejs";
export const maxDuration = 300;

const runSchema = z.object({
  provider: z.enum(["nous", "openrouter"]),
  model: z.string().min(1).max(240),
  kind: z.enum(["image", "video"]),
  scope: z.enum(["sfw_baseline", "adult_non_explicit_boundary"]),
  maxSpendUsd: z.number().min(0).max(10),
  confirm: z.literal(true),
});

function testTypeForScope(scope: MediaSmokeScope) {
  return scope === "sfw_baseline" ? "sfw_smoke" as const : "adult_content" as const;
}

function testNote(input: {
  scope: MediaSmokeScope;
  kind: "image" | "video";
  outcome: MediaCapabilityTestOutcome;
}) {
  const routeLabel = input.kind === "video" ? "video route" : "image route";
  if (input.scope === "sfw_baseline") {
    if (input.outcome === "supported") {
      return `The exact ${routeLabel} completed the standardized SFW baseline smoke test.`;
    }
    if (input.outcome === "blocked") {
      return `The exact ${routeLabel} rejected the standardized SFW baseline with a content/policy-style failure.`;
    }
    return `The standardized SFW baseline for this exact ${routeLabel} failed without clear evidence of a content-policy block.`;
  }

  if (input.outcome === "supported") {
    return `The exact ${routeLabel} completed the standardized non-explicit adult boundary test. This verifies only non-explicit adult capability.`;
  }
  if (input.outcome === "blocked") {
    return `The exact ${routeLabel} rejected the standardized non-explicit adult boundary test with a content/policy-style failure.`;
  }
  return `The standardized non-explicit adult boundary test for this exact ${routeLabel} failed without clear evidence of a content-policy block.`;
}

function nextCent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil((value - 1e-9) * 100) / 100;
}

function failureOutcome(value: string): MediaCapabilityTestOutcome {
  const text = value.toLowerCase();
  return /(?:content|safety|moderation|policy|nsfw|nudity|sexual).{0,90}(?:block|filter|reject|deny|prohibit|not allowed)|(?:block|filter|reject|deny|prohibit).{0,90}(?:content|safety|moderation|policy|nsfw|nudity|sexual)/i.test(
    text,
  )
    ? "blocked"
    : "inconclusive";
}

async function existingTestForJob(ownerRef: string, jobId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_model_capability_tests")
    .select(
      "id,provider,model,endpoint,test_type,outcome,prompt_classification,notes,tested_at",
    )
    .eq("owner_ref", ownerRef)
    .eq("source_job_id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function recordJobOutcome(input: {
  ownerRef: string;
  jobId: string;
  provider: string;
  model: string;
  kind: "image" | "video";
  scope: MediaSmokeScope;
  outcome: MediaCapabilityTestOutcome;
  note: string;
}) {
  const existing = await existingTestForJob(input.ownerRef, input.jobId);
  if (existing) return existing;

  return recordMediaModelCapabilityTest({
    ownerRef: input.ownerRef,
    provider: input.provider,
    model: input.model,
    endpoint: "",
    routeKind: input.kind,
    testType: testTypeForScope(input.scope),
    outcome: input.outcome,
    sourceJobId: input.jobId,
    promptClassification: input.scope,
    notes: input.note,
  });
}

async function reconcileExpiredCapabilityTests(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,owner_ref,provider,model,sandbox_name,result_url,usage,error,deadline_at,pricing_dimensions",
    )
    .eq("owner_ref", ownerRef)
    .in("status", ["queued", "running"])
    .contains("pricing_dimensions", { capabilityTest: true })
    .not("deadline_at", "is", null)
    .lte("deadline_at", nowIso)
    .order("deadline_at", { ascending: true })
    .limit(5);
  if (error) throw error;

  for (const job of jobs || []) {
    let polled: Awaited<ReturnType<typeof pollHermesMediaTask>> | null = null;

    if (job.status === "running" && job.sandbox_name && job.deadline_at) {
      try {
        polled = await pollHermesMediaTask({
          sandboxName: job.sandbox_name,
          deadlineAt: job.deadline_at,
        });
      } catch {
        polled = null;
      }
    }

    const completedAt = new Date().toISOString();
    let status = "failed";
    let mediaUrl: string | null = null;
    let errorText =
      "Capability test deadline elapsed before a final provider result was persisted.";
    let usage = job.usage;
    let outcome: MediaCapabilityTestOutcome = "inconclusive";

    if (polled && polled.state !== "running") {
      status = polled.state;
      mediaUrl = polled.mediaUrl;
      errorText = polled.error || "";
      usage = polled.usage;
      outcome =
        polled.state === "completed" && polled.mediaUrl
          ? "supported"
          : failureOutcome(
              [polled.error, polled.stderr, polled.stdout]
                .filter(Boolean)
                .join("\n"),
            );
    }

    const { error: updateError } = await admin
      .from("media_generation_jobs")
      .update({
        status,
        result_url: mediaUrl,
        usage,
        error: errorText || null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", job.id)
      .eq("owner_ref", ownerRef)
      .in("status", ["queued", "running"]);
    if (updateError) throw updateError;

    await recordJobOutcome({
      ownerRef,
      jobId: job.id,
      provider: job.provider,
      model: job.model,
      outcome,
      note:
        outcome === "supported"
          ? "The exact text-to-image route completed the standardized non-explicit adult/nudity boundary test. This verifies only non-explicit adult capability."
          : outcome === "blocked"
            ? "The exact route rejected the standardized non-explicit adult/nudity boundary test with a content/policy-style failure."
            : "The controlled capability test reached its deadline or failed without evidence that clearly establishes a content-policy block.",
    });
  }
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = `coop-user:${userId}`;
  const admin = createAdminSupabaseClient();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  try {
    await reconcileExpiredCapabilityTests(ownerRef);

    if (!jobId) {
      const [routes, benchmarkEvidence] = await Promise.all([
        liveImageRoutes(ownerRef),
        mediaBenchmarkEvidenceForOwner(ownerRef).catch(() => []),
      ]);
      const [
        { data: tests, error: testsError },
        { data: activeJobs, error: activeJobsError },
      ] = await Promise.all([
        admin
          .from("media_model_capability_tests")
          .select(
            "provider,model,endpoint,outcome,prompt_classification,tested_at",
          )
          .eq("owner_ref", ownerRef)
          .eq("test_type", "adult_content")
          .order("tested_at", { ascending: false })
          .limit(300),
        admin
          .from("media_generation_jobs")
          .select(
            "id,provider,model,status,estimated_provider_cost_microusd,created_at,pricing_dimensions",
          )
          .eq("owner_ref", ownerRef)
          .in("status", ["queued", "running"])
          .contains("pricing_dimensions", { capabilityTest: true })
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (testsError) throw testsError;
      if (activeJobsError) throw activeJobsError;

      const latest = new Map<string, NonNullable<typeof tests>[number]>();
      for (const test of tests || []) {
        const key = [test.provider, test.model, test.endpoint || ""].join("|");
        if (!latest.has(key)) latest.set(key, test);
      }

      return NextResponse.json(
        {
          promptClassification: TEST_PROMPT_CLASSIFICATION,
          testDescription:
            "One non-explicit adult/nudity boundary image. A success verifies only this non-explicit scope; it does not certify sexually explicit output.",
          routes: routes.map((route) => ({
            ...route,
            latestTest:
              latest.get([route.provider, route.model, ""].join("|")) || null,
            benchmarkScorecard: mediaBenchmarkSummaryForRoute(
              benchmarkEvidence,
              {
                provider: route.provider,
                model: route.model,
                endpoint: "",
              },
            ),
          })),
          activeJob: activeJobs?.[0]
            ? {
                jobId: activeJobs[0].id,
                provider: activeJobs[0].provider,
                model: activeJobs[0].model,
                status: activeJobs[0].status,
                estimatedProviderCostUsd:
                  activeJobs[0].estimated_provider_cost_microusd === null
                    ? null
                    : Number(activeJobs[0].estimated_provider_cost_microusd) /
                      1_000_000,
              }
            : null,
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const { data: job, error: jobError } = await admin
      .from("media_generation_jobs")
      .select(
        "id,status,owner_ref,kind,provider,model,sandbox_name,result_url,usage,error,started_at,deadline_at,completed_at,pricing_dimensions,estimated_provider_cost_microusd",
      )
      .eq("id", jobId)
      .eq("owner_ref", ownerRef)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job) {
      return NextResponse.json({ error: "Capability test job not found." }, { status: 404 });
    }

    const pricingDimensions =
      job.pricing_dimensions && typeof job.pricing_dimensions === "object"
        ? (job.pricing_dimensions as Record<string, unknown>)
        : {};
    if (pricingDimensions.capabilityTest !== true) {
      return NextResponse.json({ error: "Job is not a capability test." }, { status: 400 });
    }

    let status = job.status;
    let mediaUrl = job.result_url || null;
    let errorText = job.error || null;
    let recorded = await existingTestForJob(ownerRef, job.id);

    if (
      status === "running" &&
      job.sandbox_name &&
      job.deadline_at
    ) {
      const polled = await pollHermesMediaTask({
        sandboxName: job.sandbox_name,
        deadlineAt: job.deadline_at,
      });

      if (polled.state !== "running") {
        const completedAt = new Date().toISOString();
        status = polled.state;
        mediaUrl = polled.mediaUrl;
        errorText = polled.error;

        const { error: updateError } = await admin
          .from("media_generation_jobs")
          .update({
            status,
            result_url: mediaUrl,
            usage: polled.usage,
            error: errorText,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", job.id)
          .eq("owner_ref", ownerRef);
        if (updateError) throw updateError;

        const outcome: MediaCapabilityTestOutcome =
          polled.state === "completed" && polled.mediaUrl
            ? "supported"
            : failureOutcome(
                [polled.error, polled.stderr, polled.stdout]
                  .filter(Boolean)
                  .join("\n"),
              );

        recorded = await recordJobOutcome({
          ownerRef,
          jobId: job.id,
          provider: job.provider,
          model: job.model,
          outcome,
          note:
            outcome === "supported"
              ? "The exact text-to-image route completed the standardized non-explicit adult/nudity boundary test. This verifies only non-explicit adult capability."
              : outcome === "blocked"
                ? "The exact route rejected the standardized non-explicit adult/nudity boundary test with a content/policy-style failure."
                : "The standardized capability test failed for a reason that did not clearly establish a content-policy block.",
        });
      }
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status,
        provider: job.provider,
        model: job.model,
        mediaUrl,
        error: errorText,
        estimatedProviderCostUsd:
          job.estimated_provider_cost_microusd === null
            ? null
            : Number(job.estimated_provider_cost_microusd) / 1_000_000,
        result: recorded
          ? {
              outcome: recorded.outcome,
              promptClassification: recorded.prompt_classification,
              testedAt: recorded.tested_at,
              notes: recorded.notes,
            }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read capability test state.";
    return NextResponse.json(
      { error: "Could not read capability test state.", detail: detail.slice(0, 900) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = `coop-user:${userId}`;
  const admin = createAdminSupabaseClient();

  try {
    const input = runSchema.parse(await request.json());
    await reconcileExpiredCapabilityTests(ownerRef);
    const preference = await mediaContentPreferenceForUser(userId);
    if (
      preference.preference === "sfw_only" ||
      !preference.adultContentAcknowledgedAt
    ) {
      return NextResponse.json(
        {
          error:
            "Enable NSFW output and save the 18+ acknowledgment before running an adult-capability test.",
        },
        { status: 400 },
      );
    }

    const routes = await liveImageRoutes(ownerRef);
    const route = routes.find(
      (item) =>
        item.provider === input.provider &&
        item.model === input.model &&
        item.endpoint === "",
    );
    if (!route) {
      return NextResponse.json(
        { error: "That exact text-to-image route is not currently in the live executable catalog." },
        { status: 400 },
      );
    }

    if (route.capUsd > input.maxSpendUsd + 0.000001) {
      return NextResponse.json(
        {
          error: "The approved capability-test cap is below the current live estimate.",
          estimatedProviderCostUsd: route.estimatedCostUsd,
          requiredCapUsd: route.capUsd,
        },
        { status: 400 },
      );
    }

    const approvedTestCapUsd = route.capUsd;

    const { data: capability, error: capabilityError } = await admin
      .from("media_model_capabilities")
      .select("adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at")
      .eq("provider", input.provider)
      .eq("model", input.model)
      .eq("endpoint", "")
      .maybeSingle();
    if (capabilityError) throw capabilityError;
    const nonExplicitPolicy =
      capability?.adult_non_explicit_policy === "allowed" ||
      capability?.adult_non_explicit_policy === "disallowed"
        ? capability.adult_non_explicit_policy
        : capability?.adult_content_policy === "allowed" ||
            capability?.adult_content_policy === "disallowed"
          ? capability.adult_content_policy
          : "unknown";
    const nonExplicitPolicySource =
      capability?.adult_non_explicit_policy_source ||
      capability?.adult_content_policy_source ||
      null;
    if (nonExplicitPolicy === "disallowed") {
      return NextResponse.json(
        {
          error:
            "Current exact-route policy evidence marks non-explicit adult output as disallowed, so CoOperative will not probe it.",
          policySource: nonExplicitPolicySource,
        },
        { status: 400 },
      );
    }

    const { data: activeTests, error: activeTestsError } = await admin
      .from("media_generation_jobs")
      .select("id,provider,model,status")
      .eq("owner_ref", ownerRef)
      .in("status", ["queued", "running"])
      .contains("pricing_dimensions", { capabilityTest: true })
      .limit(1);
    if (activeTestsError) throw activeTestsError;
    if (activeTests?.length) {
      return NextResponse.json(
        {
          error:
            "Another controlled capability test is already active for this profile. Finish that one before starting another.",
          activeJobId: activeTests[0].id,
        },
        { status: 409 },
      );
    }

    let providerCredential: string | undefined;
    let nousAuthJson: string | undefined;

    if (input.provider === "nous") {
      const auth = await freshNousRuntimeAuthForOwner(ownerRef);
      if (!auth?.sandboxAuthJson) {
        return NextResponse.json(
          { error: "Nous Portal is not currently authorized for a controlled test." },
          { status: 400 },
        );
      }
      nousAuthJson = auth.sandboxAuthJson;
    } else {
      const service = await businessOwnedServiceCredentialForOwner(
        ownerRef,
        "openrouter-api",
      );
      providerCredential =
        service?.credential || process.env.OPENROUTER_API_KEY?.trim() || undefined;
      if (!providerCredential) {
        return NextResponse.json(
          { error: "OpenRouter is not connected for a controlled test." },
          { status: 400 },
        );
      }

      const spendStatus = await openRouterKeySpendStatus(providerCredential);
      const enoughKnownBalance =
        spendStatus.accountCreditsRemainingUsd === null ||
        spendStatus.accountCreditsRemainingUsd >= route.estimatedCostUsd;
      const enoughKeyLimit =
        spendStatus.keyLimitRemainingUsd === null ||
        spendStatus.keyLimitRemainingUsd >= route.estimatedCostUsd;
      if (!spendStatus.paidEligible || !enoughKnownBalance || !enoughKeyLimit) {
        return NextResponse.json(
          {
            error:
              "OpenRouter is connected, but its current key/credit state does not approve this one-shot test.",
          },
          { status: 400 },
        );
      }
    }

    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error: insertError } = await admin
      .from("media_generation_jobs")
      .insert({
        id: jobId,
        status: "queued",
        owner_ref: ownerRef,
        conversation_id: null,
        kind: "image",
        prompt: TEST_PROMPT,
        provider: input.provider,
        model: input.model,
        model_mixer: null,
        request_max_spend_microusd: Math.round(approvedTestCapUsd * 1_000_000),
        media_level: 1,
        estimated_provider_cost_microusd: Math.round(
          route.estimatedCostUsd * 1_000_000,
        ),
        estimated_user_charge_microusd: 0,
        estimated_infrastructure_cost_microusd: null,
        estimated_margin_microusd: null,
        provider_cost_bearer: "user-connected",
        pricing_dimensions: {
          capabilityTest: true,
          capabilityTestType: "adult_content",
          promptClassification: TEST_PROMPT_CLASSIFICATION,
          noRetry: true,
          noFallback: true,
          policyCheckedAt:
            capability?.adult_non_explicit_policy_checked_at ||
            capability?.adult_content_policy_checked_at ||
            null,
        },
        pricing_source: route.pricingSource,
        created_at: now,
        updated_at: now,
      });
    if (insertError) throw insertError;

    try {
      const started = await startHermesMediaTask({
        jobId,
        kind: "image",
        userRequest: TEST_PROMPT,
        provider: input.provider,
        model: input.model,
        providerCredential,
        nousAuthJson,
        capabilityTest: true,
      });

      const { error: startError } = await admin
        .from("media_generation_jobs")
        .update({
          status: "running",
          sandbox_name: started.sandboxName,
          started_at: started.startedAt,
          deadline_at: started.deadlineAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("owner_ref", ownerRef);
      if (startError) throw startError;

      return NextResponse.json(
        {
          jobId,
          status: "running",
          provider: input.provider,
          model: input.model,
          estimatedProviderCostUsd: route.estimatedCostUsd,
          capUsd: approvedTestCapUsd,
          promptClassification: TEST_PROMPT_CLASSIFICATION,
          note:
            "One exact-route test started. No retry or fallback is allowed. A successful result verifies only non-explicit adult/nudity capability.",
        },
        { status: 202, headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (startFailure) {
      const detail =
        startFailure instanceof Error
          ? startFailure.message
          : "Capability test could not start.";
      const completedAt = new Date().toISOString();
      await admin
        .from("media_generation_jobs")
        .update({
          status: "failed",
          error: detail.slice(0, 1200),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", jobId)
        .eq("owner_ref", ownerRef);

      const outcome = failureOutcome(detail);
      const result = await recordJobOutcome({
        ownerRef,
        jobId,
        provider: input.provider,
        model: input.model,
        outcome,
        note:
          outcome === "blocked"
            ? "The one-shot test was rejected before usable media was returned with a content/policy-style failure."
            : "The one-shot test could not start or complete for a reason that does not establish content capability.",
      });

      return NextResponse.json(
        {
          jobId,
          status: "failed",
          provider: input.provider,
          model: input.model,
          error: detail,
          result: {
            outcome: result.outcome,
            promptClassification: result.prompt_classification,
          },
        },
        { status: 200, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not start capability test.";
    return NextResponse.json(
      { error: "Could not start capability test.", detail: detail.slice(0, 900) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
