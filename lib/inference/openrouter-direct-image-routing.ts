import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  cooperativeProfileRef,
  reserveAiProfileFunds,
} from "@/lib/billing/ai-profile-balance";
import { paidAiPriceQuote } from "@/lib/billing/paid-ai-pricing";
import { fundingQuoteForUser } from "@/lib/billing/ai-funding-handoff";
import {
  estimateOpenRouterMediaCostUsd,
  openRouterKeySpendStatus,
  openRouterMediaCatalog,
  recommendedForRequest,
} from "@/lib/inference/openrouter-media-catalog";
import { mediaKnownBlockedRouteKeys } from "@/lib/inference/media-model-capabilities";
import type { MediaAdultContentClass } from "@/lib/inference/media-request";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";

type SourceMediaJob = {
  id: string;
  conversation_id: string | null;
  prompt: string;
  model: string;
  model_mixer: unknown;
  request_max_spend_microusd: number | null;
  media_level: number | null;
  estimated_provider_cost_microusd: number | null;
  pricing_dimensions: unknown;
  request_root_job_id: string;
  route_attempt: number;
};

export type DirectImageFallbackResult =
  | {
      kind: "queued";
      jobId: string;
      model: string;
      estimatedProviderCostUsd: number;
      quotedUserPriceUsd: number;
    }
  | {
      kind: "already-active";
      jobId: string;
      model: string;
    }
  | {
      kind: "funding-required";
      shortfallUsd: number;
      minimumRequiredBalanceUsd: number;
      availableBalanceUsd: number;
    }
  | { kind: "none" };

function dimensions(job: SourceMediaJob) {
  return job.pricing_dimensions &&
    typeof job.pricing_dimensions === "object" &&
    !Array.isArray(job.pricing_dimensions)
    ? (job.pricing_dimensions as {
        referenceAttachmentIds?: unknown;
        aspectRatio?: unknown;
        resolution?: unknown;
        audio?: unknown;
      })
    : {};
}

export async function queueNextDirectOpenRouterImageFallback(input: {
  ownerRef: string;
  userId: string;
  sourceJob: SourceMediaJob;
  requestedClass: MediaAdultContentClass;
}): Promise<DirectImageFallbackResult> {
  const admin = createAdminSupabaseClient();

  const { data: existingActive, error: activeError } = await admin
    .from("media_generation_jobs")
    .select("id,model")
    .eq("request_root_job_id", input.sourceJob.request_root_job_id)
    .in("status", ["queued", "running"])
    .neq("id", input.sourceJob.id)
    .order("route_attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) throw activeError;
  if (existingActive) {
    return {
      kind: "already-active",
      jobId: existingActive.id,
      model: existingActive.model,
    };
  }

  const dims = dimensions(input.sourceJob);
  const referenceAttachmentIds = Array.isArray(dims.referenceAttachmentIds)
    ? dims.referenceAttachmentIds.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      )
    : [];
  const requestCapUsd =
    typeof input.sourceJob.request_max_spend_microusd === "number"
      ? input.sourceJob.request_max_spend_microusd / 1_000_000
      : 0.05;
  const sourceEstimateUsd =
    typeof input.sourceJob.estimated_provider_cost_microusd === "number"
      ? input.sourceJob.estimated_provider_cost_microusd / 1_000_000
      : 0;
  const remainingCapUsd = Math.max(0, requestCapUsd - sourceEstimateUsd);
  if (remainingCapUsd <= 0) return { kind: "none" };

  const service = await businessOwnedServiceCredentialForOwner(
    input.ownerRef,
    "openrouter-api",
  );
  const byokCredential = service?.credential?.trim() || undefined;
  const cooperativeCredential =
    process.env.OPENROUTER_API_KEY?.trim() || undefined;
  const credential = byokCredential || cooperativeCredential;
  if (!credential) return { kind: "none" };

  const [catalog, blocked] = await Promise.all([
    openRouterMediaCatalog(true, credential),
    mediaKnownBlockedRouteKeys({
      ownerRef: input.ownerRef,
      requestedClass: input.requestedClass,
    }),
  ]);

  const pool = catalog.image.filter((model) => {
    if (model.id === input.sourceJob.model) return false;
    if (blocked.has(["openrouter", model.id, ""].join("|"))) return false;
    if (
      referenceAttachmentIds.length > 0 &&
      !(
        (model.minInputReferences ?? 0) > 0 ||
        model.inputModalities.some(
          (modality) => modality.toLowerCase() === "image",
        )
      )
    ) {
      return false;
    }
    return true;
  });
  if (!pool.length) return { kind: "none" };

  const level = Math.min(
    4,
    Math.max(0, Number(input.sourceJob.media_level || 0)),
  ) as 0 | 1 | 2 | 3 | 4;
  const requestShape = {
    durationSeconds: null,
    aspectRatio:
      typeof dims.aspectRatio === "string" ? dims.aspectRatio : null,
    resolution:
      typeof dims.resolution === "string" ? dims.resolution : null,
    audio: null,
  };

  const freeCandidate = recommendedForRequest(
    pool.filter((model) => model.free),
    0,
    requestShape,
  );
  const paidCandidate = recommendedForRequest(
    pool.filter((model) => !model.free),
    level > 0 ? level : 1,
    requestShape,
  );
  const candidate = freeCandidate || paidCandidate;
  if (!candidate) return { kind: "none" };

  const providerCostUsd = freeCandidate
    ? 0
    : estimateOpenRouterMediaCostUsd(candidate, {
        resolution:
          typeof dims.resolution === "string" ? dims.resolution : null,
      });
  if (
    providerCostUsd === null ||
    !Number.isFinite(providerCostUsd) ||
    providerCostUsd < 0
  ) {
    return { kind: "none" };
  }

  const usingByok = Boolean(byokCredential);
  const sellQuote =
    !candidate.free && !usingByok
      ? paidAiPriceQuote(providerCostUsd)
      : null;
  const quotedUserPriceUsd =
    candidate.free || usingByok ? 0 : Number(sellQuote?.userQuoteUsd || 0);
  const capCostUsd = usingByok ? providerCostUsd : quotedUserPriceUsd;
  if (capCostUsd > remainingCapUsd + 0.000001) {
    return { kind: "none" };
  }

  if (!candidate.free) {
    const spend = await openRouterKeySpendStatus(credential);
    const enoughCredits =
      spend.accountCreditsRemainingUsd === null ||
      spend.accountCreditsRemainingUsd >= providerCostUsd;
    const enoughLimit =
      spend.keyLimitRemainingUsd === null ||
      spend.keyLimitRemainingUsd >= providerCostUsd;
    if (!spend.paidEligible || !enoughCredits || !enoughLimit) {
      return { kind: "none" };
    }
  }

  let reservationId: string | null = null;
  if (!candidate.free && !usingByok) {
    const quote = await fundingQuoteForUser({
      userId: input.userId,
      estimatedCostUsd: quotedUserPriceUsd,
      maxSpendUsd: remainingCapUsd,
    });
    if (!quote.sufficientBalance) {
      return {
        kind: "funding-required",
        shortfallUsd: quote.shortfallUsd,
        minimumRequiredBalanceUsd: quote.minimumRequiredBalanceUsd,
        availableBalanceUsd: quote.availableBalanceUsd,
      };
    }

    const pendingJobId = crypto.randomUUID();
    const reservation = await reserveAiProfileFunds({
      profileRef: cooperativeProfileRef(input.userId),
      estimatedCostUsd: quotedUserPriceUsd,
      source: "media-generation",
      referenceId: pendingJobId,
      metadata: {
        provider: "openrouter",
        model: candidate.id,
        kind: "image",
        fallbackFromJobId: input.sourceJob.id,
        quotedUserPriceUsd,
        providerCostEstimateUsd: providerCostUsd,
      },
    });
    if (!reservation) return { kind: "none" };
    reservationId = reservation.id;

    const { error: insertError } = await admin
      .from("media_generation_jobs")
      .insert({
        id: pendingJobId,
        status: "queued",
        owner_ref: input.ownerRef,
        conversation_id: input.sourceJob.conversation_id,
        kind: "image",
        prompt: input.sourceJob.prompt,
        provider: "openrouter",
        model: candidate.id,
        model_mixer: input.sourceJob.model_mixer || null,
        request_max_spend_microusd: Math.round(
          remainingCapUsd * 1_000_000,
        ),
        media_level: level,
        estimated_provider_cost_microusd: Math.round(
          providerCostUsd * 1_000_000,
        ),
        estimated_user_charge_microusd: Math.round(
          quotedUserPriceUsd * 1_000_000,
        ),
        billing_mode: "cooperative-balance",
        provider_cost_bearer: "cooperative",
        ai_balance_reservation_id: reservationId,
        pricing_dimensions: {
          ...dims,
          directProvider: true,
          referenceAttachmentIds,
          referenceAttachmentCount: referenceAttachmentIds.length,
          providerCostEstimateUsd: providerCostUsd,
          quotedUserPriceUsd,
          markupPercent: sellQuote?.markupPercent || 0,
          openRouterBillingSource: "cooperative-balance",
        },
        pricing_source: catalog.source,
        fallback_from_job_id: input.sourceJob.id,
        request_root_job_id: input.sourceJob.request_root_job_id,
        route_attempt: Math.min(50, Math.max(1, Number(input.sourceJob.route_attempt || 1) + 1)),
        execution_mode: "direct-provider",
      });
    if (insertError) throw insertError;

    return {
      kind: "queued",
      jobId: pendingJobId,
      model: candidate.id,
      estimatedProviderCostUsd: providerCostUsd,
      quotedUserPriceUsd,
    };
  }

  const jobId = crypto.randomUUID();
  const { error: insertError } = await admin
    .from("media_generation_jobs")
    .insert({
      id: jobId,
      status: "queued",
      owner_ref: input.ownerRef,
      conversation_id: input.sourceJob.conversation_id,
      kind: "image",
      prompt: input.sourceJob.prompt,
      provider: "openrouter",
      model: candidate.id,
      model_mixer: input.sourceJob.model_mixer || null,
      request_max_spend_microusd: Math.round(remainingCapUsd * 1_000_000),
      media_level: level,
      estimated_provider_cost_microusd: Math.round(
        providerCostUsd * 1_000_000,
      ),
      estimated_user_charge_microusd: 0,
      billing_mode: candidate.free ? null : "openrouter-byok",
      provider_cost_bearer: candidate.free ? "free" : "user-connected",
      pricing_dimensions: {
        ...dims,
        directProvider: true,
        referenceAttachmentIds,
        referenceAttachmentCount: referenceAttachmentIds.length,
        providerCostEstimateUsd: providerCostUsd,
        quotedUserPriceUsd: 0,
        markupPercent: 0,
        openRouterBillingSource: candidate.free
          ? "free"
          : "user-connected-byok",
      },
      pricing_source: catalog.source,
      fallback_from_job_id: input.sourceJob.id,
        request_root_job_id: input.sourceJob.request_root_job_id,
        route_attempt: Math.min(50, Math.max(1, Number(input.sourceJob.route_attempt || 1) + 1)),
        execution_mode: "direct-provider",
      });
  if (insertError) throw insertError;

  return {
    kind: "queued",
    jobId,
    model: candidate.id,
    estimatedProviderCostUsd: providerCostUsd,
    quotedUserPriceUsd: 0,
  };
}
