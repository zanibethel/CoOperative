import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { recordModelCapabilityEvidence } from "@/lib/inference/model-capability-registry";
import type { MediaAdultContentClass } from "@/lib/inference/media-request";

export type MediaContentPreference =
  | "sfw_only"
  | "adult_allowed"
  | "prefer_adult_capable"
  | "require_adult_capable";

export type MediaCapabilityTestType =
  | "sfw_smoke"
  | "adult_content"
  | "reference_fidelity"
  | "identity_preservation"
  | "edit_strength"
  | "policy_behavior"
  | "control_compatibility"
  | "other";

export type MediaCapabilityTestOutcome =
  | "supported"
  | "blocked"
  | "partial"
  | "inconclusive";

export type AdultCapabilityState = "verified" | "blocked" | "unknown";

export type MediaExecutionContentGateReason =
  | "sfw_request"
  | "nsfw_disabled"
  | "adult_route_blocked"
  | "adult_route_unverified"
  | "adult_explicit_unverified"
  | "adult_route_allowed"
  | "adult_preflight_unavailable";

export type MediaExecutionContentGateResult = {
  allowed: boolean;
  preference: MediaContentPreference;
  adultCapability: AdultCapabilityState;
  reason: MediaExecutionContentGateReason;
  note: string;
  policySource: string | null;
  latestTestOutcome: MediaCapabilityTestOutcome | null;
};

export type MediaPolicyRefusalOrigin =
  | "none"
  | "orchestrator"
  | "provider";

export function mediaPolicyRefusalOrigin(
  detail: string,
  requestedClass: MediaAdultContentClass,
): MediaPolicyRefusalOrigin {
  if (!mediaPolicyRefusalDetected(detail, requestedClass)) return "none";

  if (
    /\b0 tool calls?\b|\bno tool call\b|\bnot calling (?:the )?(?:image )?tool\b|\bwon't call (?:the )?(?:image )?tool\b/i.test(
      detail,
    )
  ) {
    return "orchestrator";
  }

  return "provider";
}

export function mediaPolicyRefusalDetected(
  detail: string,
  requestedClass: MediaAdultContentClass,
) {
  if (requestedClass === "sfw") return false;

  const refusalSignal =
    /(?:can't|cannot|won't|unable to|refus(?:e|ed|al)|reject(?:ed|ion)?|block(?:ed|ing)?|filter(?:ed|ing)?|prohibit(?:s|ed)?|not allowed|disallow(?:ed|s)?|policy|moderation|safety)/i;
  const adultSignal =
    requestedClass === "adult_explicit"
      ? /(?:sexual|sexually explicit|explicit nudity|nudity|nsfw|porn|breasts?|nipples?|genitals?|penis|vagina|vulva|anus)/i
      : /(?:adult|nudity|nude|nsfw|sexual|erotic)/i;

  return refusalSignal.test(detail) && adultSignal.test(detail);
}

export async function recordMediaRuntimePolicyRefusal(input: {
  ownerRef: string;
  provider: string;
  model: string;
  endpoint?: string | null;
  sourceJobId: string;
  requestedClass: MediaAdultContentClass;
  detail: string;
}) {
  const origin = mediaPolicyRefusalOrigin(
    input.detail,
    input.requestedClass,
  );
  if (input.requestedClass === "sfw" || origin === "none") {
    return { recorded: false as const, origin };
  }
  if (origin === "orchestrator") {
    return {
      recorded: false as const,
      origin,
      note:
        "The orchestration layer refused before the provider/model was called, so no model capability evidence was recorded.",
    };
  }

  const admin = createAdminSupabaseClient();
  const endpoint = input.endpoint || "";
  const now = new Date().toISOString();
  const source = `runtime-policy-refusal:${input.sourceJobId}`;
  const promptClassification =
    input.requestedClass === "adult_explicit"
      ? "adult_explicit_boundary"
      : "adult_non_explicit_boundary";

  await recordMediaModelCapabilityTest({
    ownerRef: input.ownerRef,
    provider: input.provider,
    model: input.model,
    endpoint,
    testType: "adult_content",
    outcome: "blocked",
    sourceJobId: input.sourceJobId,
    promptClassification,
    notes:
      `Runtime provider/model refusal observed for ${input.requestedClass}. ` +
      input.detail.slice(0, 1200),
  });

  const scopedPatch =
    input.requestedClass === "adult_explicit"
      ? {
          adult_explicit_policy: "disallowed",
          adult_explicit_policy_source: source,
          adult_explicit_policy_checked_at: now,
        }
      : {
          adult_non_explicit_policy: "disallowed",
          adult_non_explicit_policy_source: source,
          adult_non_explicit_policy_checked_at: now,
        };

  const { data: updated, error: updateError } = await admin
    .from("media_model_capabilities")
    .update({
      ...scopedPatch,
      notes:
        `Observed runtime policy refusal for ${input.requestedClass}; future routing excludes this exact route for that scope.`,
      updated_at: now,
    })
    .eq("provider", input.provider)
    .eq("model", input.model)
    .eq("endpoint", endpoint)
    .select("provider,model,endpoint")
    .maybeSingle();

  if (updateError) throw updateError;

  if (!updated) {
    const { error: insertError } = await admin
      .from("media_model_capabilities")
      .insert({
        provider: input.provider,
        model: input.model,
        endpoint,
        ...scopedPatch,
        notes:
          `Observed runtime policy refusal for ${input.requestedClass}; future routing excludes this exact route for that scope.`,
        updated_at: now,
      });
    if (insertError) throw insertError;
  }

  return {
    recorded: true as const,
    origin: "provider" as const,
    provider: input.provider,
    model: input.model,
    endpoint,
    requestedClass: input.requestedClass,
  };
}

function effectiveContentPreference(
  value: unknown,
  adultContentAcknowledgedAt: string | null | undefined,
): MediaContentPreference {
  const preference =
    value === "adult_allowed" ||
    value === "prefer_adult_capable" ||
    value === "require_adult_capable"
      ? value
      : "sfw_only";

  return preference !== "sfw_only" && !adultContentAcknowledgedAt
    ? "sfw_only"
    : preference;
}

function adultCapabilityState(input: {
  policy: unknown;
  latestTestOutcome: unknown;
  latestPromptClassification: unknown;
  requestedClass: MediaAdultContentClass;
}): AdultCapabilityState {
  if (input.policy === "disallowed") return "blocked";

  const classification =
    typeof input.latestPromptClassification === "string"
      ? input.latestPromptClassification
      : null;

  if (input.latestTestOutcome === "blocked") {
    if (
      classification === "adult_non_explicit_boundary" ||
      (classification === "adult_explicit_boundary" &&
        input.requestedClass === "adult_explicit")
    ) {
      return "blocked";
    }
  }

  if (input.latestTestOutcome === "supported") {
    if (classification === "adult_explicit_boundary") return "verified";
    if (
      classification === "adult_non_explicit_boundary" &&
      input.requestedClass === "adult_non_explicit"
    ) {
      return "verified";
    }
  }

  if (input.policy === "allowed") return "verified";
  return "unknown";
}

export async function evaluateMediaExecutionContentGate(input: {
  userId: string;
  ownerRef: string;
  provider: string;
  model: string;
  endpoint?: string | null;
  adultContentClass?: MediaAdultContentClass;
  adultOutputRequested?: boolean;
}): Promise<MediaExecutionContentGateResult> {
  const admin = createAdminSupabaseClient();
  const requestedClass: MediaAdultContentClass =
    input.adultContentClass ||
    (input.adultOutputRequested ? "adult_non_explicit" : "sfw");

  if (requestedClass === "sfw") {
    return {
      allowed: true,
      preference: "sfw_only",
      adultCapability: "unknown",
      reason: "sfw_request",
      note:
        "This execution is SFW, so adult-capability preferences do not restrict the route.",
      policySource: null,
      latestTestOutcome: null,
    };
  }

  const { data: settings, error: settingsError } = await admin
    .from("personal_ai_settings")
    .select("media_content_preference,adult_content_acknowledged_at")
    .eq("user_id", input.userId)
    .maybeSingle();

  if (settingsError) {
    return {
      allowed: false,
      preference: "sfw_only",
      adultCapability: "unknown",
      reason: "adult_preflight_unavailable",
      note:
        "CoOperative could not re-check the current NSFW preference immediately before execution, so adult output was stopped.",
      policySource: null,
      latestTestOutcome: null,
    };
  }

  const preference = effectiveContentPreference(
    settings?.media_content_preference,
    settings?.adult_content_acknowledged_at,
  );

  if (preference === "sfw_only") {
    return {
      allowed: false,
      preference,
      adultCapability: "unknown",
      reason: "nsfw_disabled",
      note:
        "NSFW output is currently off, so the adult media request cannot be submitted.",
      policySource: null,
      latestTestOutcome: null,
    };
  }

  const endpoint = input.endpoint || "";
  const [
    { data: capability, error: capabilityError },
    { data: latestTest, error: latestTestError },
  ] = await Promise.all([
    admin
      .from("media_model_capabilities")
      .select(
        "adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at",
      )
      .eq("provider", input.provider)
      .eq("model", input.model)
      .eq("endpoint", endpoint)
      .maybeSingle(),
    admin
      .from("media_model_capability_tests")
      .select("outcome,prompt_classification,tested_at")
      .eq("owner_ref", input.ownerRef)
      .eq("provider", input.provider)
      .eq("model", input.model)
      .eq("endpoint", endpoint)
      .eq("test_type", "adult_content")
      .order("tested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (capabilityError || latestTestError) {
    return {
      allowed: false,
      preference,
      adultCapability: "unknown",
      reason: "adult_preflight_unavailable",
      note:
        "CoOperative could not re-check the current adult-capability evidence immediately before execution, so the request was stopped rather than relying on stale recommendation data.",
      policySource: null,
      latestTestOutcome: null,
    };
  }

  const latestTestOutcome =
    latestTest?.outcome === "supported" ||
    latestTest?.outcome === "blocked" ||
    latestTest?.outcome === "partial" ||
    latestTest?.outcome === "inconclusive"
      ? latestTest.outcome
      : null;
  const scopedPolicy =
    requestedClass === "adult_explicit"
      ? capability?.adult_explicit_policy
      : capability?.adult_non_explicit_policy;
  const legacyPolicy = capability?.adult_content_policy;
  const effectivePolicy =
    scopedPolicy === "allowed" || scopedPolicy === "disallowed"
      ? scopedPolicy
      : legacyPolicy === "allowed" || legacyPolicy === "disallowed"
        ? legacyPolicy
        : "unknown";
  const policySource =
    requestedClass === "adult_explicit"
      ? capability?.adult_explicit_policy_source ||
        capability?.adult_content_policy_source ||
        null
      : capability?.adult_non_explicit_policy_source ||
        capability?.adult_content_policy_source ||
        null;

  const state = adultCapabilityState({
    policy: effectivePolicy,
    latestTestOutcome,
    latestPromptClassification: latestTest?.prompt_classification,
    requestedClass,
  });

  if (state === "blocked") {
    return {
      allowed: false,
      preference,
      adultCapability: state,
      reason: "adult_route_blocked",
      note:
        effectivePolicy === "disallowed"
          ? policySource
            ? `Current provider/model policy disallows adult output (${policySource}).`
            : "Current provider/model policy disallows adult output."
          : "The latest controlled adult-capability test for this exact route was blocked.",
      policySource,
      latestTestOutcome,
    };
  }

  if (requestedClass === "adult_explicit" && state !== "verified") {
    return {
      allowed: false,
      preference,
      adultCapability: state,
      reason: "adult_explicit_unverified",
      note:
        "Sexually explicit output requires exact-route evidence that explicitly covers that scope. CoOperative will not probe an unknown hosted route during a real user request.",
      policySource,
      latestTestOutcome,
    };
  }

  if (preference === "require_adult_capable" && state !== "verified") {
    return {
      allowed: false,
      preference,
      adultCapability: state,
      reason: "adult_route_unverified",
      note:
        "Require adult-capable models is enabled, but this exact execution route is not currently verified for the requested adult-output scope.",
      policySource,
      latestTestOutcome,
    };
  }

  return {
    allowed: true,
    preference,
    adultCapability: state,
    reason: "adult_route_allowed",
    note:
      state === "verified"
        ? "The current preference and capability evidence allow this adult-output route."
        : "Adult output is allowed for this profile and this route is not currently known to block it; capability remains unverified.",
    policySource,
    latestTestOutcome,
  };
}

export async function mediaVerifiedAllowedRouteKeys(input: {
  ownerRef: string;
  requestedClass: MediaAdultContentClass;
}) {
  if (input.requestedClass === "sfw") return new Set<string>();

  const admin = createAdminSupabaseClient();
  const [
    { data: capabilities, error: capabilityError },
    { data: tests, error: testError },
  ] = await Promise.all([
    admin
      .from("media_model_capabilities")
      .select(
        "provider,model,endpoint,adult_content_policy,adult_non_explicit_policy,adult_explicit_policy",
      ),
    admin
      .from("media_model_capability_tests")
      .select("provider,model,endpoint,outcome,prompt_classification,tested_at")
      .eq("owner_ref", input.ownerRef)
      .eq("test_type", "adult_content")
      .order("tested_at", { ascending: false })
      .limit(500),
  ]);

  if (capabilityError) throw capabilityError;
  if (testError) throw testError;

  const verified = new Set<string>();

  for (const row of capabilities || []) {
    const scopedPolicy =
      input.requestedClass === "adult_explicit"
        ? row.adult_explicit_policy
        : row.adult_non_explicit_policy;
    const effectivePolicy =
      scopedPolicy === "allowed" || scopedPolicy === "disallowed"
        ? scopedPolicy
        : row.adult_content_policy;

    if (effectivePolicy === "allowed") {
      verified.add([row.provider, row.model, row.endpoint || ""].join("|"));
    }
  }

  const seenTests = new Set<string>();
  for (const test of tests || []) {
    const key = [test.provider, test.model, test.endpoint || ""].join("|");
    if (seenTests.has(key)) continue;
    seenTests.add(key);

    const applies =
      test.prompt_classification === "adult_explicit_boundary" ||
      (test.prompt_classification === "adult_non_explicit_boundary" &&
        input.requestedClass === "adult_non_explicit");

    if (!applies) continue;
    if (test.outcome === "supported") verified.add(key);
    if (test.outcome === "blocked") verified.delete(key);
  }

  return verified;
}

export async function mediaKnownBlockedRouteKeys(input: {
  ownerRef: string;
  requestedClass: MediaAdultContentClass;
}) {
  if (input.requestedClass === "sfw") return new Set<string>();

  const admin = createAdminSupabaseClient();
  const [{ data: capabilities, error: capabilityError }, { data: tests, error: testError }] =
    await Promise.all([
      admin
        .from("media_model_capabilities")
        .select(
          "provider,model,endpoint,adult_content_policy,adult_non_explicit_policy,adult_explicit_policy",
        ),
      admin
        .from("media_model_capability_tests")
        .select("provider,model,endpoint,outcome,prompt_classification,tested_at")
        .eq("owner_ref", input.ownerRef)
        .eq("test_type", "adult_content")
        .order("tested_at", { ascending: false })
        .limit(500),
    ]);

  if (capabilityError) throw capabilityError;
  if (testError) throw testError;

  const blocked = new Set<string>();
  for (const row of capabilities || []) {
    const scopedPolicy =
      input.requestedClass === "adult_explicit"
        ? row.adult_explicit_policy
        : row.adult_non_explicit_policy;
    const effectivePolicy =
      scopedPolicy === "allowed" || scopedPolicy === "disallowed"
        ? scopedPolicy
        : row.adult_content_policy;
    if (effectivePolicy === "disallowed") {
      blocked.add([row.provider, row.model, row.endpoint || ""].join("|"));
    }
  }

  const seenTests = new Set<string>();
  for (const test of tests || []) {
    const key = [test.provider, test.model, test.endpoint || ""].join("|");
    if (seenTests.has(key)) continue;
    seenTests.add(key);
    const applies =
      test.prompt_classification === "adult_explicit_boundary" ||
      (test.prompt_classification === "adult_non_explicit_boundary" &&
        input.requestedClass === "adult_non_explicit");
    if (applies && test.outcome === "blocked") blocked.add(key);
  }

  return blocked;
}

export async function recordMediaModelCapabilityTest(input: {
  ownerRef: string;
  provider: string;
  model: string;
  endpoint?: string | null;
  testType: MediaCapabilityTestType;
  outcome: MediaCapabilityTestOutcome;
  sourceJobId?: string | null;
  promptClassification?: string | null;
  notes?: string | null;
  routeKind?: "image" | "image-edit" | "video";
}) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_model_capability_tests")
    .insert({
      owner_ref: input.ownerRef,
      provider: input.provider,
      model: input.model,
      endpoint: input.endpoint || "",
      test_type: input.testType,
      outcome: input.outcome,
      source_job_id: input.sourceJobId || null,
      prompt_classification: input.promptClassification?.slice(0, 160) || null,
      notes: input.notes?.slice(0, 2000) || null,
    })
    .select(
      "id,provider,model,endpoint,test_type,outcome,source_job_id,prompt_classification,notes,tested_at",
    )
    .single();

  if (error) throw error;

  const routeKind =
    input.routeKind ||
    ((input.endpoint || "").trim() ? "image-edit" : "image");
  const state =
    input.outcome === "supported"
      ? "supported"
      : input.outcome === "blocked"
        ? "unsupported"
        : input.outcome;

  await recordModelCapabilityEvidence({
    ownerRef: input.ownerRef,
    provider: input.provider,
    model: input.model,
    endpoint: input.endpoint || "",
    routeKind,
    capabilityKey:
      input.testType === "adult_content"
        ? "adult-content"
        : input.testType === "sfw_smoke"
          ? "sfw-smoke"
          : input.testType.replace(/_/g, "-"),
    scope: input.promptClassification || input.testType,
    state,
    sourceType: "controlled-test",
    sourceRef: input.sourceJobId || data.id,
    confidence:
      input.outcome === "supported" || input.outcome === "blocked"
        ? 0.95
        : input.outcome === "partial"
          ? 0.7
          : 0.4,
    observedAt: data.tested_at,
    evidence: {
      testId: data.id,
      testType: input.testType,
      outcome: input.outcome,
      promptClassification: input.promptClassification || null,
      notes: input.notes?.slice(0, 1200) || null,
    },
  }).catch((e) => {
    console.error("Could not mirror media capability test into model evidence", {
      testId: data.id,
      detail: e instanceof Error ? e.message.slice(0, 600) : "unknown",
    });
  });

  return data;
}

export async function mediaContentPreferenceForUser(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("personal_ai_settings")
    .select("media_content_preference,adult_content_acknowledged_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  const adultContentAcknowledgedAt =
    data?.adult_content_acknowledged_at || null;

  return {
    preference: effectiveContentPreference(
      data?.media_content_preference,
      adultContentAcknowledgedAt,
    ),
    adultContentAcknowledgedAt,
  };
}
