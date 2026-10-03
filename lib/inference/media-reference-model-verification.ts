import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type MediaReferenceModelVerification = {
  provider: string;
  model: string;
  editEndpoint: string;
  status: "verified" | "failed";
  sourceJobId: string | null;
  verifiedAt: string | null;
  lastAttemptAt: string;
  failureReason: string | null;
};

export async function mediaReferenceModelVerificationsForOwner(
  ownerRef: string,
): Promise<MediaReferenceModelVerification[]> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_reference_model_verifications")
    .select(
      "provider,model,edit_endpoint,status,source_job_id,verified_at,last_attempt_at,failure_reason",
    )
    .eq("owner_ref", ownerRef);

  if (error) throw error;

  return (data || []).map((row) => ({
    provider: row.provider,
    model: row.model,
    editEndpoint: row.edit_endpoint,
    status: row.status,
    sourceJobId: row.source_job_id,
    verifiedAt: row.verified_at,
    lastAttemptAt: row.last_attempt_at,
    failureReason: row.failure_reason,
  }));
}

export async function recordMediaReferenceModelVerification(input: {
  ownerRef: string;
  provider: string;
  model: string;
  editEndpoint: string;
  sourceJobId: string;
  success: boolean;
  failureReason?: string | null;
}) {
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();

  if (input.success) {
    const { error } = await admin
      .from("media_reference_model_verifications")
      .upsert(
        {
          owner_ref: input.ownerRef,
          provider: input.provider,
          model: input.model,
          edit_endpoint: input.editEndpoint,
          status: "verified",
          source_job_id: input.sourceJobId,
          verified_at: now,
          last_attempt_at: now,
          failure_reason: null,
          updated_at: now,
        },
        { onConflict: "owner_ref,provider,edit_endpoint" },
      );
    if (error) throw error;
    return;
  }

  const { data: existing, error: existingError } = await admin
    .from("media_reference_model_verifications")
    .select("status,verified_at")
    .eq("owner_ref", input.ownerRef)
    .eq("provider", input.provider)
    .eq("edit_endpoint", input.editEndpoint)
    .maybeSingle();
  if (existingError) throw existingError;

  const keepVerified = existing?.status === "verified";
  const { error } = await admin
    .from("media_reference_model_verifications")
    .upsert(
      {
        owner_ref: input.ownerRef,
        provider: input.provider,
        model: input.model,
        edit_endpoint: input.editEndpoint,
        status: keepVerified ? "verified" : "failed",
        source_job_id: input.sourceJobId,
        verified_at: keepVerified ? existing?.verified_at || now : null,
        last_attempt_at: now,
        failure_reason: input.failureReason?.slice(0, 1200) || "Verification failed.",
        updated_at: now,
      },
      { onConflict: "owner_ref,provider,edit_endpoint" },
    );
  if (error) throw error;
}
