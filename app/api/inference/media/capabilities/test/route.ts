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
  type MediaSmokeRoute,
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
  return scope === "sfw_baseline"
    ? ("sfw_smoke" as const)
    : ("adult_content" as const);
}

function failureOutcome(value: string): MediaCapabilityTestOutcome {
  const text = value.toLowerCase();
  return /(?:content|safety|moderation|policy|nsfw|nudity|sexual).{0,90}(?:block|filter|reject|deny|prohibit|not allowed)|(?:block|filter|reject|deny|prohibit).{0,90}(?:content|safety|moderation|policy|nsfw|nudity|sexual)/i.test(
    text,
  )
    ? "blocked"
    : "inconclusive";
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

function routePrompt(route: MediaSmokeRoute, scope: MediaSmokeScope) {
  const base = MEDIA_SMOKE_PROMPTS[route.kind][scope];
  const lines = [base];

  if (route.kind === "video") {
    if (route.request.durationSeconds) {
      lines.push(`Duration: ${route.request.durationSeconds} seconds.`);
    }
    if (route.request.aspectRatio) {
      lines.push(`Aspect ratio: ${route.request.aspectRatio}.`);
    }
    if (route.request.resolution) {
      lines.push(`Resolution: ${route.request.resolution}.`);
    }
    if (route.request.audio !== null) {
      lines.push(
        `Generated audio: ${route.request.audio ? "on" : "off"}.`,
      );
    }
  } else if (route.request.aspectRatio) {
    lines.push(`Preferred aspect ratio: ${route.request.aspectRatio}.`);
  }

  return lines.join("\n");
}

async function existingTestForJob(ownerRef: string, jobId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_model_capability_tests")
    .select(
      "id,provider,model,endpoint,test_type,outcome,source_job_id,prompt_classification,notes,tested_at",
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
    notes: testNote({
      scope: input.scope,
      kind: input.kind,
      outcome: input.outcome,
    }),
  });
}

function smokeIdentityFromPricingDimensions(
  pricingDimensions: Record<string, unknown>,
  fallbackKind: unknown,
) {
  const scope =
    pricingDimensions.promptClassification === "sfw_baseline" ||
    pricingDimensions.promptClassification ===
      "adult_non_explicit_boundary"
      ? (pricingDimensions.promptClassification as MediaSmokeScope)
      : ("sfw_baseline" as MediaSmokeScope);

  const kind =
    pricingDimensions.capabilityTestRouteKind === "video" ||
    fallbackKind === "video"
      ? ("video" as const)
      : ("image" as const);

  return { scope, kind };
}

async function reconcileExpiredCapabilityTests(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data: jobs, error } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,kind,owner_ref,provider,model,sandbox_name,result_url,usage,error,deadline_at,pricing_dimensions",
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

    const pricingDimensions =
      job.pricing_dimensions && typeof job.pricing_dimensions === "object"
        ? (job.pricing_dimensions as Record<string, unknown>)
        : {};
    const identity = smokeIdentityFromPricingDimensions(
      pricingDimensions,
      job.kind,
    );

    await recordJobOutcome({
      ownerRef,
      jobId: job.id,
      provider: job.provider,
      model: job.model,
      kind: identity.kind,
      scope: identity.scope,
      outcome,
    });
  }
}


async function reconcileFinishedCapabilityTests(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const { data: jobs, error } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,kind,provider,model,result_url,error,pricing_dimensions,completed_at",
    )
    .eq("owner_ref", ownerRef)
    .in("status", ["completed", "failed"])
    .contains("pricing_dimensions", { capabilityTest: true })
    .order("completed_at", { ascending: false })
    .limit(25);

  if (error) throw error;

  for (const job of jobs || []) {
    const existing = await existingTestForJob(ownerRef, job.id);
    if (existing) continue;

    const pricingDimensions =
      job.pricing_dimensions && typeof job.pricing_dimensions === "object"
        ? (job.pricing_dimensions as Record<string, unknown>)
        : {};
    const identity = smokeIdentityFromPricingDimensions(
      pricingDimensions,
      job.kind,
    );
    const outcome: MediaCapabilityTestOutcome =
      job.status === "completed" && Boolean(job.result_url)
        ? "supported"
        : failureOutcome(job.error || "");

    await recordJobOutcome({
      ownerRef,
      jobId: job.id,
      provider: job.provider,
      model: job.model,
      kind: identity.kind,
      scope: identity.scope,
      outcome,
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
      await reconcileFinishedCapabilityTests(ownerRef);
      await ensureMediaCapabilityRouteCatalog();

      const [routes, benchmarkEvidence, preference] = await Promise.all([
        mediaCapabilitySmokeRoutes(ownerRef),
        mediaBenchmarkEvidenceForOwner(ownerRef).catch(() => []),
        mediaContentPreferenceForUser(userId),
      ]);

      const [
        { data: tests, error: testsError },
        { data: capabilities, error: capabilitiesError },
        { data: activeJobs, error: activeJobsError },
      ] = await Promise.all([
        admin
          .from("media_model_capability_tests")
          .select(
            "provider,model,endpoint,test_type,outcome,prompt_classification,tested_at,notes",
          )
          .eq("owner_ref", ownerRef)
          .in("test_type", ["sfw_smoke", "adult_content"])
          .order("tested_at", { ascending: false })
          .limit(1000),
        admin
          .from("media_model_capabilities")
          .select(
            "provider,model,endpoint,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at",
          ),
        admin
          .from("media_generation_jobs")
          .select(
            "id,kind,provider,model,status,estimated_provider_cost_microusd,created_at,pricing_dimensions",
          )
          .eq("owner_ref", ownerRef)
          .in("status", ["queued", "running"])
          .contains("pricing_dimensions", { capabilityTest: true })
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

      if (testsError) throw testsError;
      if (capabilitiesError) throw capabilitiesError;
      if (activeJobsError) throw activeJobsError;

      const latest = new Map<
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
        if (!latest.has(key)) latest.set(key, test);
      }

      const capabilityMap = new Map(
        (capabilities || []).map((row) => [
          [row.provider, row.model, row.endpoint || ""].join("|"),
          row,
        ]),
      );

      const matrixRoutes = routes.map((route) => {
        const routeKey = [
          route.provider,
          route.model,
          route.endpoint || "",
        ].join("|");
        const capability = capabilityMap.get(routeKey);
        const sfwTest =
          latest.get(
            [
              route.provider,
              route.model,
              route.endpoint || "",
              "sfw_smoke",
            ].join("|"),
          ) || null;
        const adultTest =
          latest.get(
            [
              route.provider,
              route.model,
              route.endpoint || "",
              "adult_content",
            ].join("|"),
          ) || null;

        return {
          ...route,
          policy: {
            adultNonExplicit:
              capability?.adult_non_explicit_policy || "unknown",
            adultNonExplicitSource:
              capability?.adult_non_explicit_policy_source || null,
            adultExplicit:
              capability?.adult_explicit_policy || "unknown",
            adultExplicitSource:
              capability?.adult_explicit_policy_source || null,
            adultExplicitCheckedAt:
              capability?.adult_explicit_policy_checked_at || null,
          },
          latestSfwTest: sfwTest,
          latestAdultNonExplicitTest: adultTest,
          adultNonExplicitTestEligible:
            capability?.adult_non_explicit_policy !== "disallowed" &&
            preference.preference !== "sfw_only" &&
            Boolean(preference.adultContentAcknowledgedAt),
          explicitGenerationTested: false,
          explicitClassificationSource: "policy-evidence-only",
          benchmarkScorecard: mediaBenchmarkSummaryForRoute(
            benchmarkEvidence,
            {
              provider: route.provider,
              model: route.model,
              endpoint: route.endpoint,
            },
          ),
        };
      });

      return NextResponse.json(
        {
          matrix: {
            routeCount: matrixRoutes.length,
            sfwCoveredCount: matrixRoutes.filter(
              (route) => Boolean(route.latestSfwTest),
            ).length,
            adultNonExplicitCoveredCount: matrixRoutes.filter(
              (route) => Boolean(route.latestAdultNonExplicitTest),
            ).length,
            explicitPolicyBlockedCount: matrixRoutes.filter(
              (route) => route.policy.adultExplicit === "disallowed",
            ).length,
            explicitGenerationTestsDisabled: true,
            note:
              "SFW and non-explicit adult boundary tests are one-shot exact-route generation tests. Sexually explicit generation is never used as a smoke test; explicit scope is classified from current policy/model evidence instead.",
          },
          preference: {
            mediaContentPreference: preference.preference,
            adultContentAcknowledgedAt:
              preference.adultContentAcknowledgedAt,
          },
          routes: matrixRoutes,
          activeJob: activeJobs?.[0]
            ? {
                jobId: activeJobs[0].id,
                kind: activeJobs[0].kind,
                provider: activeJobs[0].provider,
                model: activeJobs[0].model,
                status: activeJobs[0].status,
                promptClassification:
                  activeJobs[0].pricing_dimensions &&
                  typeof activeJobs[0].pricing_dimensions === "object"
                    ? (
                        activeJobs[0]
                          .pricing_dimensions as Record<string, unknown>
                      ).promptClassification || null
                    : null,
                estimatedProviderCostUsd:
                  activeJobs[0].estimated_provider_cost_microusd === null
                    ? null
                    : Number(
                        activeJobs[0].estimated_provider_cost_microusd,
                      ) / 1_000_000,
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
      return NextResponse.json(
        { error: "Capability test job not found." },
        { status: 404 },
      );
    }

    const pricingDimensions =
      job.pricing_dimensions && typeof job.pricing_dimensions === "object"
        ? (job.pricing_dimensions as Record<string, unknown>)
        : {};

    if (pricingDimensions.capabilityTest !== true) {
      return NextResponse.json(
        { error: "Job is not a capability test." },
        { status: 400 },
      );
    }

    const identity = smokeIdentityFromPricingDimensions(
      pricingDimensions,
      job.kind,
    );
    let status = job.status;
    let mediaUrl = job.result_url || null;
    let errorText = job.error || null;
    let recorded = await existingTestForJob(ownerRef, job.id);

    if (!recorded && status === "completed" && mediaUrl) {
      recorded = await recordJobOutcome({
        ownerRef,
        jobId: job.id,
        provider: job.provider,
        model: job.model,
        kind: identity.kind,
        scope: identity.scope,
        outcome: "supported",
      });
    } else if (!recorded && status === "failed") {
      recorded = await recordJobOutcome({
        ownerRef,
        jobId: job.id,
        provider: job.provider,
        model: job.model,
        kind: identity.kind,
        scope: identity.scope,
        outcome: failureOutcome(errorText || ""),
      });
    }

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
          kind: identity.kind,
          scope: identity.scope,
          outcome,
        });
      }
    }

    return NextResponse.json(
      {
        jobId: job.id,
        status,
        kind: identity.kind,
        scope: identity.scope,
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
              testType: recorded.test_type,
              promptClassification:
                recorded.prompt_classification,
              testedAt: recorded.tested_at,
              notes: recorded.notes,
            }
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not read capability test state.";

    return NextResponse.json(
      {
        error: "Could not read capability test state.",
        detail: detail.slice(0, 900),
      },
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
    await ensureMediaCapabilityRouteCatalog();

    if (input.scope === "adult_non_explicit_boundary") {
      const preference = await mediaContentPreferenceForUser(userId);
      if (
        preference.preference === "sfw_only" ||
        !preference.adultContentAcknowledgedAt
      ) {
        return NextResponse.json(
          {
            error:
              "Enable NSFW output and save the 18+ acknowledgment before running a non-explicit adult capability test.",
          },
          { status: 400 },
        );
      }
    }

    const routes = await mediaCapabilitySmokeRoutes(ownerRef);
    const route = routes.find(
      (item) =>
        item.provider === input.provider &&
        item.model === input.model &&
        item.endpoint === "" &&
        item.kind === input.kind,
    );

    if (!route) {
      return NextResponse.json(
        {
          error:
            "That exact media route is not currently executable with a bounded smoke-test price.",
        },
        { status: 400 },
      );
    }

    if (route.capUsd > input.maxSpendUsd + 0.000001) {
      return NextResponse.json(
        {
          error:
            "The approved capability-test cap is below the current live estimate.",
          estimatedProviderCostUsd:
            route.estimatedProviderCostUsd,
          requiredCapUsd: route.capUsd,
          costResolution: route.costResolution,
        },
        { status: 400 },
      );
    }

    const approvedTestCapUsd = route.capUsd;

    const { data: capability, error: capabilityError } = await admin
      .from("media_model_capabilities")
      .select(
        "adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at",
      )
      .eq("provider", input.provider)
      .eq("model", input.model)
      .eq("endpoint", "")
      .maybeSingle();

    if (capabilityError) throw capabilityError;

    if (input.scope === "adult_non_explicit_boundary") {
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
          {
            error:
              "Nous Portal is not currently authorized for a controlled test.",
          },
          { status: 400 },
        );
      }
      nousAuthJson = auth.sandboxAuthJson;
    } else {
      const service = await businessOwnedServiceCredentialForOwner(
        ownerRef,
        "openrouter-api",
      );
      providerCredential = service?.credential || undefined;

      if (!providerCredential) {
        return NextResponse.json(
          {
            error:
              "Controlled OpenRouter smoke tests require the profile's own connected OpenRouter key. CoOperative does not silently use platform-paid OpenRouter credits for the test matrix.",
          },
          { status: 400 },
        );
      }

      const spendStatus = await openRouterKeySpendStatus(
        providerCredential,
      );
      const enoughKnownBalance =
        spendStatus.accountCreditsRemainingUsd === null ||
        spendStatus.accountCreditsRemainingUsd >=
          route.estimatedProviderCostUsd;
      const enoughKeyLimit =
        spendStatus.keyLimitRemainingUsd === null ||
        spendStatus.keyLimitRemainingUsd >=
          route.estimatedProviderCostUsd;

      if (
        !spendStatus.paidEligible ||
        !enoughKnownBalance ||
        !enoughKeyLimit
      ) {
        return NextResponse.json(
          {
            error:
              "OpenRouter is connected, but its current key/credit state does not approve this one-shot test.",
          },
          { status: 400 },
        );
      }
    }

    const prompt = routePrompt(route, input.scope);
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await admin
      .from("media_generation_jobs")
      .insert({
        id: jobId,
        status: "queued",
        owner_ref: ownerRef,
        conversation_id: null,
        request_root_job_id: jobId,
        route_attempt: 1,
        execution_mode: "capability-test",
        kind: input.kind,
        prompt,
        provider: input.provider,
        model: input.model,
        model_mixer: null,
        request_max_spend_microusd: Math.round(
          approvedTestCapUsd * 1_000_000,
        ),
        media_level: 1,
        estimated_provider_cost_microusd: Math.round(
          route.estimatedProviderCostUsd * 1_000_000,
        ),
        estimated_user_charge_microusd: 0,
        estimated_infrastructure_cost_microusd: null,
        estimated_margin_microusd: null,
        provider_cost_bearer: "user-connected",
        pricing_dimensions: {
          capabilityTest: true,
          capabilityTestType: testTypeForScope(input.scope),
          capabilityTestRouteKind: input.kind,
          promptClassification: input.scope,
          request: route.request,
          costResolution: route.costResolution,
          noRetry: true,
          noFallback: true,
          noRecoveryAgent: true,
          explicitGenerationTest: false,
          policyCheckedAt:
            input.scope === "adult_non_explicit_boundary"
              ? capability?.adult_non_explicit_policy_checked_at ||
                capability?.adult_content_policy_checked_at ||
                null
              : null,
        },
        pricing_source: route.pricingSource,
        created_at: now,
        updated_at: now,
      });

    if (insertError) throw insertError;

    try {
      const started = await startHermesMediaTask({
        jobId,
        kind: input.kind,
        userRequest: prompt,
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
          kind: input.kind,
          scope: input.scope,
          provider: input.provider,
          model: input.model,
          estimatedProviderCostUsd:
            route.estimatedProviderCostUsd,
          capUsd: approvedTestCapUsd,
          costResolution: route.costResolution,
          note:
            input.scope === "sfw_baseline"
              ? "One exact-route SFW smoke test started. No retry, fallback, or Recovery Agent is allowed."
              : "One exact-route non-explicit adult boundary test started. No retry, fallback, or Recovery Agent is allowed. A success verifies only the non-explicit scope.",
        },
        {
          status: 202,
          headers: { "Cache-Control": "private, no-store" },
        },
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
        kind: input.kind,
        scope: input.scope,
        outcome,
      });

      return NextResponse.json(
        {
          jobId,
          status: "failed",
          kind: input.kind,
          scope: input.scope,
          provider: input.provider,
          model: input.model,
          error: detail,
          result: {
            outcome: result.outcome,
            testType: result.test_type,
            promptClassification:
              result.prompt_classification,
          },
        },
        {
          status: 200,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not start capability test.";

    return NextResponse.json(
      {
        error: "Could not start capability test.",
        detail: detail.slice(0, 900),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
