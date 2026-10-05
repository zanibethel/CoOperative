import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type MediaRouteEvidenceKind =
  | "provider-policy"
  | "executor-policy"
  | "capability-refusal"
  | "retryable-technical"
  | "uncertain"
  | "fatal-configuration"
  | "technical-unknown";

export async function recordMediaRouteOutcome(input: {
  ownerRef: string;
  sourceJobId: string;
  provider: string;
  model: string;
  endpoint?: string | null;
  executionMode?: string | null;
  requestShape: string;
  outcomeKind: MediaRouteEvidenceKind;
  detail?: string | null;
  blocksRoute?: boolean;
}) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("media_route_outcomes").insert({
    owner_ref: input.ownerRef,
    source_job_id: input.sourceJobId,
    provider: input.provider,
    model: input.model,
    endpoint: input.endpoint || "",
    execution_mode: input.executionMode || "unknown",
    request_shape: input.requestShape,
    outcome_kind: input.outcomeKind,
    blocks_route: input.blocksRoute === true,
    detail: input.detail?.slice(0, 1600) || null,
  });
  if (error) throw error;
}

export async function knownCapabilityBlockedMediaRoutes(input: {
  ownerRef: string;
  requestShape: string;
}) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("media_route_outcomes")
    .select("provider,model,endpoint,outcome_kind,created_at")
    .eq("owner_ref", input.ownerRef)
    .eq("request_shape", input.requestShape)
    .eq("blocks_route", true)
    .eq("outcome_kind", "capability-refusal")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  return new Set(
    (data || []).map((row) =>
      [row.provider, row.model, row.endpoint || ""].join("|"),
    ),
  );
}
