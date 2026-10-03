import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { MediaAdultContentClass } from "@/lib/inference/media-request";

export type MediaContentPreference =
  | "sfw_only"
  | "adult_allowed"
  | "prefer_adult_capable"
  | "require_adult_capable";

export type MediaCapabilityTestType =
  | "adult_content"
  | "reference_fidelity"
  | "identity_preservation"
  | "edit_strength"
  | "policy_behavior"
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
        "adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at",
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
  const state = adultCapabilityState({
    policy: capability?.adult_content_policy,
    latestTestOutcome,
    latestPromptClassification: latestTest?.prompt_classification,
    requestedClass,
  });
  const policySource = capability?.adult_content_policy_source || null;

  if (state === "blocked") {
    return {
      allowed: false,
      preference,
      adultCapability: state,
      reason: "adult_route_blocked",
      note:
        capability?.adult_content_policy === "disallowed"
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
        "Sexually explicit output requires exact-route evidence that actually covers that scope. A non-explicit adult/nudity test is not enough.",
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

  return {
    preference:
      (data?.media_content_preference as MediaContentPreference | undefined) ||
      "sfw_only",
    adultContentAcknowledgedAt:
      data?.adult_content_acknowledged_at || null,
  };
}
