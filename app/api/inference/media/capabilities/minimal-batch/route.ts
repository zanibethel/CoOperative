import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  mediaContentPreferenceForUser,
  recordMediaModelCapabilityTest,
  type MediaCapabilityTestOutcome,
} from "@/lib/inference/media-model-capabilities";
import {
  MEDIA_SMOKE_PROMPTS,
  mediaCapabilitySmokeRoutes,
  type MediaSmokeRoute,
  type MediaSmokeScope,
} from "@/lib/inference/media-capability-smoke-matrix";
import {
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import { openRouterKeySpendStatus } from "@/lib/inference/openrouter-media-catalog";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_TAG = "minimal-media-verification-2026-10-06";
const HARD_BATCH_CAP_USD = 0.30;
const MAX_TESTS = 5;

type Target = {
  id: string;
  provider: "nous" | "openrouter";
  kind: "image" | "video";
  scope: MediaSmokeScope;
};

const TARGETS: Target[] = [
  {
    id: "openrouter-image-sfw",
    provider: "openrouter",
    kind: "image",
    scope: "sfw_baseline",
  },
  {
    id: "nous-video-sfw",
    provider: "nous",
    kind: "video",
    scope: "sfw_baseline",
  },
  {
    id: "nous-video-nonexplicit",
    provider: "nous",
    kind: "video",
    scope: "adult_non_explicit_boundary",
  },
  {
    id: "openrouter-video-sfw",
    provider: "openrouter",
    kind: "video",
    scope: "sfw_baseline",
  },
  {
    id: "openrouter-video-nonexplicit",
    provider: "openrouter",
    kind: "video",
    scope: "adult_non_explicit_boundary",
  },
];

async function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (
    secret &&
    request.headers.get("authorization") === `Bearer ${secret}`
  ) {
    return true;
  }

  const token = request.headers.get("x-coop-batch-token")?.trim();
  if (!token) return false;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("ai_model_scan_runs")
    .select("id,status,metadata,started_at")
    .eq("trigger_source", "owner-authorized-media-batch")
    .eq("status", "running")
    .contains("metadata", {
      batchTag: BATCH_TAG,
      batchToken: token,
      hardCapUsd: HARD_BATCH_CAP_USD,
    })
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;
  const metadata =
    data.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>)
      : {};
  const expiresAt =
    typeof metadata.expiresAt === "string"
      ? Date.parse(metadata.expiresAt)
      : 0;
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function testType(scope: MediaSmokeScope) {
  return scope === "sfw_baseline" ? "sfw_smoke" : "adult_content";
}

function failureOutcome(text: string): MediaCapabilityTestOutcome {
  const value = text.toLowerCase();
  return /(?:content|safety|moderation|policy|nsfw|nudity|sexual).{0,90}(?:block|filter|reject|deny|prohibit|not allowed)|(?:block|filter|reject|deny|prohibit).{0,90}(?:content|safety|moderation|policy|nsfw|nudity|sexual)/i.test(
    value,
  )
    ? "blocked"
    : "inconclusive";
}

function promptFor(route: MediaSmokeRoute, scope: MediaSmokeScope) {
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
      lines.push(`Generated audio: ${route.request.audio ? "on" : "off"}.`);
    }
  } else if (route.request.aspectRatio) {
    lines.push(`Preferred aspect ratio: ${route.request.aspectRatio}.`);
  }
  return lines.join("\n");
}

async function ownerIdentity() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("unison_platform_owners")
    .select("user_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.user_id) throw new Error("No platform owner is configured.");
  return {
    userId: data.user_id as string,
    ownerRef: `coop-user:${data.user_id}`,
  };
}

async function batchJobs(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,kind,provider,model,sandbox_name,result_url,error,deadline_at,completed_at,created_at,request_max_spend_microusd,estimated_provider_cost_microusd,pricing_dimensions",
    )
    .eq("owner_ref", ownerRef)
    .contains("pricing_dimensions", { capabilityBatchTag: BATCH_TAG })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function recordIfMissing(input: {
  ownerRef: string;
  job: Awaited<ReturnType<typeof batchJobs>>[number];
  outcome: MediaCapabilityTestOutcome;
}) {
  const admin = createAdminSupabaseClient();
  const { data: existing, error } = await admin
    .from("media_model_capability_tests")
    .select("id")
    .eq("owner_ref", input.ownerRef)
    .eq("source_job_id", input.job.id)
    .maybeSingle();
  if (error) throw error;
  if (existing) return;

  const pricing =
    input.job.pricing_dimensions &&
    typeof input.job.pricing_dimensions === "object"
      ? (input.job.pricing_dimensions as Record<string, unknown>)
      : {};
  const scope =
    pricing.promptClassification === "adult_non_explicit_boundary"
      ? ("adult_non_explicit_boundary" as const)
      : ("sfw_baseline" as const);

  await recordMediaModelCapabilityTest({
    ownerRef: input.ownerRef,
    provider: input.job.provider,
    model: input.job.model,
    endpoint: "",
    routeKind: input.job.kind === "video" ? "video" : "image",
    testType: testType(scope),
    outcome: input.outcome,
    sourceJobId: input.job.id,
    promptClassification: scope,
    notes:
      scope === "sfw_baseline"
        ? `Minimal verification batch: exact ${input.job.kind} route SFW baseline.`
        : `Minimal verification batch: exact ${input.job.kind} route non-explicit adult boundary.`,
  });
}

async function reconcileActive(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const jobs = await batchJobs(ownerRef);
  const active = jobs.find(
    (job) => job.status === "queued" || job.status === "running",
  );
  if (!active) return null;

  if (
    active.status === "running" &&
    active.sandbox_name &&
    active.deadline_at
  ) {
    const polled = await pollHermesMediaTask({
      sandboxName: active.sandbox_name,
      deadlineAt: active.deadline_at,
    });
    if (polled.state !== "running") {
      const completedAt = new Date().toISOString();
      const { error: updateError } = await admin
        .from("media_generation_jobs")
        .update({
          status: polled.state,
          result_url: polled.mediaUrl,
          usage: polled.usage,
          error: polled.error,
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", active.id)
        .eq("owner_ref", ownerRef);
      if (updateError) throw updateError;

      await recordIfMissing({
        ownerRef,
        job: {
          ...active,
          status: polled.state,
          result_url: polled.mediaUrl,
          error: polled.error,
          completed_at: completedAt,
        },
        outcome:
          polled.state === "completed" && polled.mediaUrl
            ? "supported"
            : failureOutcome(
                [polled.error, polled.stderr, polled.stdout]
                  .filter(Boolean)
                  .join("\n"),
              ),
      });

      return {
        id: active.id,
        status: polled.state,
        provider: active.provider,
        model: active.model,
      };
    }
  }

  return {
    id: active.id,
    status: active.status,
    provider: active.provider,
    model: active.model,
  };
}

async function capabilityCoverage(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const { data: tests, error } = await admin
    .from("media_model_capability_tests")
    .select(
      "provider,model,test_type,outcome,prompt_classification,source_job_id,tested_at",
    )
    .eq("owner_ref", ownerRef)
    .in("test_type", ["sfw_smoke", "adult_content"])
    .order("tested_at", { ascending: false })
    .limit(500);
  if (error) throw error;

  const jobIds = [
    ...new Set((tests || []).map((row) => row.source_job_id).filter(Boolean)),
  ];
  const kindByJob = new Map<string, string>();
  if (jobIds.length) {
    const { data: jobs, error: jobsError } = await admin
      .from("media_generation_jobs")
      .select("id,kind")
      .in("id", jobIds);
    if (jobsError) throw jobsError;
    for (const job of jobs || []) kindByJob.set(job.id, job.kind);
  }

  return (tests || []).map((row) => ({
    provider: row.provider,
    model: row.model,
    kind: kindByJob.get(row.source_job_id || "") || null,
    scope:
      row.test_type === "sfw_smoke"
        ? ("sfw_baseline" as const)
        : row.prompt_classification === "adult_non_explicit_boundary"
          ? ("adult_non_explicit_boundary" as const)
          : null,
    outcome: row.outcome,
    conclusive:
      row.outcome === "supported" ||
      row.outcome === "blocked" ||
      row.outcome === "partial",
  }));
}

async function plan(ownerRef: string, userId: string) {
  const [routes, coverage, preference, jobs] = await Promise.all([
    mediaCapabilitySmokeRoutes(ownerRef),
    capabilityCoverage(ownerRef),
    mediaContentPreferenceForUser(userId),
    batchJobs(ownerRef),
  ]);

  // Aggregate ceiling is based on current provider-cost estimates, while each
  // individual job still has its own request cap. This avoids counting an
  // unused per-job safety cushion as if it were actual spend.
  const usedEstimatedProviderUsd = jobs.reduce(
    (sum, job) =>
      sum + Number(job.estimated_provider_cost_microusd || 0) / 1_000_000,
    0,
  );
  const remainingCapUsd = Math.max(
    0,
    HARD_BATCH_CAP_USD - usedEstimatedProviderUsd,
  );

  const targets = TARGETS.map((target) => {
    const alreadyCovered = coverage.some(
      (row) =>
        row.provider === target.provider &&
        row.kind === target.kind &&
        row.scope === target.scope &&
        row.conclusive,
    );

    if (alreadyCovered) {
      return {
        ...target,
        status: "already-covered" as const,
        route: null,
      };
    }

    if (
      target.scope === "adult_non_explicit_boundary" &&
      (preference.preference === "sfw_only" ||
        !preference.adultContentAcknowledgedAt)
    ) {
      return {
        ...target,
        status: "profile-scope-disabled" as const,
        route: null,
      };
    }

    const candidates = routes
      .filter(
        (route) =>
          route.provider === target.provider &&
          route.kind === target.kind &&
          coverage.every(
            (row) =>
              !(
                row.provider === route.provider &&
                row.model === route.model &&
                row.kind === route.kind &&
                row.scope === target.scope
              ),
          ),
      )
      .sort(
        (a, b) =>
          a.capUsd - b.capUsd ||
          a.estimatedProviderCostUsd - b.estimatedProviderCostUsd,
      );

    const route = candidates[0] || null;
    return {
      ...target,
      status: route ? ("pending" as const) : ("no-route" as const),
      route,
    };
  });

  return {
    hardCapUsd: HARD_BATCH_CAP_USD,
    usedEstimatedProviderUsd,
    remainingCapUsd,
    jobs,
    targets,
  };
}

async function startNext(ownerRef: string, userId: string) {
  const active = await reconcileActive(ownerRef);
  if (active?.status === "queued" || active?.status === "running") {
    return { state: "active" as const, active };
  }

  const current = await plan(ownerRef, userId);
  if (current.jobs.length >= MAX_TESTS) {
    return { state: "complete" as const, current };
  }

  const next = current.targets.find(
    (target) =>
      target.status === "pending" &&
      target.route &&
      target.route.capUsd <= current.remainingCapUsd + 0.000001,
  );
  if (!next?.route) {
    return { state: "complete" as const, current };
  }

  const route = next.route;

  if (next.scope === "adult_non_explicit_boundary") {
    const admin = createAdminSupabaseClient();
    const { data: capability, error } = await admin
      .from("media_model_capabilities")
      .select("adult_non_explicit_policy")
      .eq("provider", route.provider)
      .eq("model", route.model)
      .eq("endpoint", route.endpoint || "")
      .maybeSingle();
    if (error) throw error;
    if (capability?.adult_non_explicit_policy === "disallowed") {
      throw new Error(
        `Refusing to probe ${route.provider}/${route.model}: current policy evidence blocks the non-explicit adult scope.`,
      );
    }
  }

  let providerCredential: string | undefined;
  let nousAuthJson: string | undefined;

  if (route.provider === "nous") {
    const auth = await freshNousRuntimeAuthForOwner(ownerRef);
    if (!auth?.sandboxAuthJson) {
      throw new Error("Nous/Hermes authorization is unavailable.");
    }
    nousAuthJson = auth.sandboxAuthJson;
  } else {
    const service = await businessOwnedServiceCredentialForOwner(
      ownerRef,
      "openrouter-api",
    );
    providerCredential = service?.credential || undefined;
    if (!providerCredential) {
      throw new Error(
        "OpenRouter BYOK is required for the minimal verification batch.",
      );
    }
    const spend = await openRouterKeySpendStatus(providerCredential);
    const enoughAccount =
      spend.accountCreditsRemainingUsd === null ||
      spend.accountCreditsRemainingUsd >= route.estimatedProviderCostUsd;
    const enoughKey =
      spend.keyLimitRemainingUsd === null ||
      spend.keyLimitRemainingUsd >= route.estimatedProviderCostUsd;
    if (!spend.paidEligible || !enoughAccount || !enoughKey) {
      throw new Error(
        "OpenRouter key/credit state does not approve the next minimal test.",
      );
    }
  }

  const prompt = promptFor(route, next.scope);
  const jobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const admin = createAdminSupabaseClient();

  const { error: insertError } = await admin
    .from("media_generation_jobs")
    .insert({
      id: jobId,
      status: "queued",
      owner_ref: ownerRef,
      conversation_id: null,
      request_root_job_id: jobId,
      route_attempt: 1,
      execution_mode: "capability-test-batch",
      kind: route.kind,
      prompt,
      provider: route.provider,
      model: route.model,
      model_mixer: null,
      request_max_spend_microusd: Math.round(route.capUsd * 1_000_000),
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
        capabilityBatchTag: BATCH_TAG,
        capabilityBatchTarget: next.id,
        capabilityTestType: testType(next.scope),
        capabilityTestRouteKind: route.kind,
        promptClassification: next.scope,
        request: route.request,
        costResolution: route.costResolution,
        noRetry: true,
        noFallback: true,
        noRecoveryAgent: true,
        explicitGenerationTest: false,
        hardBatchCapUsd: HARD_BATCH_CAP_USD,
      },
      pricing_source: route.pricingSource,
      created_at: now,
      updated_at: now,
    });

  if (insertError) throw insertError;

  try {
    const started = await startHermesMediaTask({
      jobId,
      kind: route.kind,
      userRequest: prompt,
      provider: route.provider,
      model: route.model,
      providerCredential,
      nousAuthJson,
      capabilityTest: true,
    });

    const { error: updateError } = await admin
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

    if (updateError) throw updateError;

    return {
      state: "started" as const,
      jobId,
      target: next.id,
      route: {
        provider: route.provider,
        model: route.model,
        kind: route.kind,
        scope: next.scope,
        estimatedProviderCostUsd: route.estimatedProviderCostUsd,
        reservedCapUsd: route.capUsd,
      },
      batch: {
        hardCapUsd: HARD_BATCH_CAP_USD,
        previousEstimatedProviderUsd: current.usedEstimatedProviderUsd,
        estimatedProviderAfterStartUsd:
          current.usedEstimatedProviderUsd + route.estimatedProviderCostUsd,
        nextRequestCapUsd: route.capUsd,
      },
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not start batch test.";
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

    await recordIfMissing({
      ownerRef,
      job: {
        ...(await batchJobs(ownerRef)).find((job) => job.id === jobId)!,
        status: "failed",
        error: detail,
        completed_at: completedAt,
      },
      outcome: failureOutcome(detail),
    });

    return {
      state: "failed-to-start" as const,
      jobId,
      target: next.id,
      error: detail,
    };
  }
}

export async function GET(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { userId, ownerRef } = await ownerIdentity();
    const active = await reconcileActive(ownerRef);
    const current = await plan(ownerRef, userId);
    return NextResponse.json(
      { batchTag: BATCH_TAG, active, ...current },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Batch status failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { userId, ownerRef } = await ownerIdentity();
    const result = await startNext(ownerRef, userId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Batch execution failed.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
