import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

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
