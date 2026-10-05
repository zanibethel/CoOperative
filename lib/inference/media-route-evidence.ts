import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { recordModelCapabilityEvidence } from "@/lib/inference/model-capability-registry";

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

  const routeKind = input.requestShape.startsWith("video")
    ? "video"
    : "image";
  const capabilityKey =
    input.outcomeKind === "capability-refusal"
      ? `request-shape-${input.requestShape.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`
      : `runtime-${input.outcomeKind.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`;

  await recordModelCapabilityEvidence({
    ownerRef: input.ownerRef,
    provider: input.provider,
    model: input.model,
    endpoint: input.endpoint || "",
    routeKind,
    capabilityKey,
    scope: input.requestShape,
    state:
      input.outcomeKind === "capability-refusal"
        ? "unsupported"
        : input.outcomeKind,
    sourceType: "runtime",
    sourceRef: input.sourceJobId,
    confidence: input.outcomeKind === "capability-refusal" ? 0.95 : 0.8,
    evidence: {
      outcomeKind: input.outcomeKind,
      executionMode: input.executionMode || "unknown",
      blocksRoute: input.blocksRoute === true,
      detail: input.detail?.slice(0, 1200) || null,
    },
  }).catch((e) => {
    console.error("Could not mirror media route outcome into model evidence", {
      sourceJobId: input.sourceJobId,
      detail: e instanceof Error ? e.message.slice(0, 600) : "unknown",
    });
  });
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
