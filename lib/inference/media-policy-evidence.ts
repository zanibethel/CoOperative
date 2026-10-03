import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { nousManagedMediaCatalog } from "@/lib/inference/nous-managed-media";
import { openRouterMediaCatalog } from "@/lib/inference/openrouter-media-catalog";

const FAL_AUP = "https://fal.ai/legal/acceptable-use-policy";
const NOUS_TERMS = "https://portal.nousresearch.com/terms";
const OPENROUTER_TERMS = "https://openrouter.ai/terms";
const OPENROUTER_PROVIDERS = "https://openrouter.ai/providers";

const LOCAL_MODELS = [
  "local-image-fast",
  "local-image-quality",
  "local-image-fast-reference",
  "local-image-quality-reference",
  "local-image-quality-identity",
] as const;

type ScopedAdultPolicy = "unknown" | "disallowed" | "allowed";

type PolicySourceCheck = {
  provider: "nous" | "openrouter" | "cooperative-local";
  ok: boolean;
  checkedAt: string;
  source: string;
  nonExplicitPolicy: ScopedAdultPolicy;
  explicitPolicy: ScopedAdultPolicy;
  note: string;
  detail?: string | null;
};

async function fetchPolicyText(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,text/plain;q=0.9",
      "User-Agent": "CoOperative/1.0 media-policy-evidence",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Policy source returned HTTP ${response.status} for ${url}.`);
  }
  return response.text();
}

async function checkNousPolicy(): Promise<PolicySourceCheck> {
  const checkedAt = new Date().toISOString();
  const source = `${NOUS_TERMS} ; ${FAL_AUP}`;
  try {
    const [nousTerms, falAup] = await Promise.all([
      fetchPolicyText(NOUS_TERMS),
      fetchPolicyText(FAL_AUP),
    ]);
    const nousMarker = /Nous Research Services/i.test(nousTerms);
    const falPolicyMarker =
      /fal Acceptable Use Policy/i.test(falAup) ||
      /generative media platform/i.test(falAup);
    const explicitMarker = /sexually explicit content/i.test(falAup);
    const nciiMarker =
      /non-consensual intimate/i.test(falAup) ||
      /sexual or pornographic manner without their consent/i.test(falAup);

    if (!nousMarker || !falPolicyMarker) {
      throw new Error("Expected current policy-page identity markers were not found.");
    }

    return {
      provider: "nous",
      ok: true,
      checkedAt,
      source,
      nonExplicitPolicy: "unknown",
      explicitPolicy: explicitMarker ? "disallowed" : "unknown",
      note: explicitMarker
        ? `Nous managed-FAL routes are subject to Nous terms, fal acceptable-use rules, and applicable third-party model terms. The current fal policy restricts sexually explicit content${nciiMarker ? " and non-consensual intimate content" : ""}. It does not establish whether a specific model supports non-explicit adult/nudity output.`
        : "Nous managed-FAL routes are subject to Nous terms, fal acceptable-use rules, and applicable third-party model terms. The current policy source did not establish a broad sexually-explicit allowance or prohibition, so exact-route capability remains unknown.",
    };
  } catch (error) {
    return {
      provider: "nous",
      ok: false,
      checkedAt,
      source,
      nonExplicitPolicy: "unknown",
      explicitPolicy: "unknown",
      note:
        "Current Nous/fal policy evidence could not be verified, so existing capability state was left unchanged.",
      detail: error instanceof Error ? error.message : "Policy check failed.",
    };
  }
}

async function checkOpenRouterPolicy(): Promise<PolicySourceCheck> {
  const checkedAt = new Date().toISOString();
  const source = `${OPENROUTER_TERMS} ; ${OPENROUTER_PROVIDERS}`;
  try {
    const [terms, providers] = await Promise.all([
      fetchPolicyText(OPENROUTER_TERMS),
      fetchPolicyText(OPENROUTER_PROVIDERS),
    ]);
    const modelTermsMarker = /Model Terms/i.test(terms);
    const providerMarker = /Model Provider/i.test(terms);
    const providerDirectoryMarker =
      /provider/i.test(providers) && /terms/i.test(providers);
    if (!modelTermsMarker || !providerMarker || !providerDirectoryMarker) {
      throw new Error("Expected OpenRouter provider/model-terms markers were not found.");
    }

    return {
      provider: "openrouter",
      ok: true,
      checkedAt,
      source,
      nonExplicitPolicy: "unknown",
      explicitPolicy: "unknown",
      note:
        "OpenRouter requires compliance with the selected model/provider terms and does not provide one universal adult-content permission for every route. Exact adult capability therefore remains unknown until provider/model-specific evidence or a controlled exact-route test establishes it.",
    };
  } catch (error) {
    return {
      provider: "openrouter",
      ok: false,
      checkedAt,
      source,
      nonExplicitPolicy: "unknown",
      explicitPolicy: "unknown",
      note:
        "Current OpenRouter policy evidence could not be verified, so existing capability state was left unchanged.",
      detail: error instanceof Error ? error.message : "Policy check failed.",
    };
  }
}

function localPolicyCheck(): PolicySourceCheck {
  return {
    provider: "cooperative-local",
    ok: true,
    checkedAt: new Date().toISOString(),
    source: "cooperative://docs/ai/MEDIA_ROUTING_POLICY.md",
    nonExplicitPolicy: "unknown",
    explicitPolicy: "unknown",
    note:
      "Owned/local execution has no third-party provider policy boundary, but CoOperative safety and legal restrictions still apply. Model support for non-explicit adult output remains a separate capability question that requires an exact-route controlled test.",
  };
}

export async function ensureMediaCapabilityRouteCatalog() {
  const admin = createAdminSupabaseClient();
  const [nous, openRouter, existingResult] = await Promise.all([
    nousManagedMediaCatalog(),
    openRouterMediaCatalog(),
    admin
      .from("media_model_capabilities")
      .select(
        "provider,model,endpoint,adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at,reference_capability,reference_capability_source,notes",
      ),
  ]);

  if (existingResult.error) throw existingResult.error;

  const existing = new Map(
    (existingResult.data || []).map((row) => [
      [row.provider, row.model, row.endpoint || ""].join("|"),
      row,
    ]),
  );

  const desired: Array<{
    provider: string;
    model: string;
    endpoint: string;
    referenceCapability: string;
    referenceCapabilitySource: string;
  }> = [
    ...nous.image.map((model) => ({
      provider: "nous",
      model: model.model,
      endpoint: "",
      referenceCapability: "not-applicable",
      referenceCapabilitySource: model.pricingSource,
    })),
    ...(nous.video
      ? [
          {
            provider: "nous",
            model: nous.video.model,
            endpoint: "",
            referenceCapability: "not-applicable",
            referenceCapabilitySource: nous.video.pricingSource,
          },
        ]
      : []),
    ...openRouter.image.map((model) => ({
      provider: "openrouter",
      model: model.id,
      endpoint: "",
      referenceCapability: "not-applicable",
      referenceCapabilitySource: openRouter.source,
    })),
    ...openRouter.video.map((model) => ({
      provider: "openrouter",
      model: model.id,
      endpoint: "",
      referenceCapability: "not-applicable",
      referenceCapabilitySource: openRouter.source,
    })),
    ...LOCAL_MODELS.map((model) => ({
      provider: "cooperative-local",
      model,
      endpoint: "",
      referenceCapability: model.includes("reference") || model.includes("identity")
        ? "owned-local-reference"
        : "not-applicable",
      referenceCapabilitySource: "CoOperative local runtime",
    })),
  ];

  const rows = desired.map((route) => {
    const key = [route.provider, route.model, route.endpoint].join("|");
    const current = existing.get(key);
    return {
      provider: route.provider,
      model: route.model,
      endpoint: route.endpoint,
      adult_content_policy: current?.adult_content_policy || "unknown",
      adult_content_policy_source: current?.adult_content_policy_source || null,
      adult_content_policy_checked_at:
        current?.adult_content_policy_checked_at || null,
      adult_non_explicit_policy:
        current?.adult_non_explicit_policy || "unknown",
      adult_non_explicit_policy_source:
        current?.adult_non_explicit_policy_source || null,
      adult_non_explicit_policy_checked_at:
        current?.adult_non_explicit_policy_checked_at || null,
      adult_explicit_policy:
        current?.adult_explicit_policy || "unknown",
      adult_explicit_policy_source:
        current?.adult_explicit_policy_source || null,
      adult_explicit_policy_checked_at:
        current?.adult_explicit_policy_checked_at || null,
      reference_capability:
        current?.reference_capability || route.referenceCapability,
      reference_capability_source:
        current?.reference_capability_source || route.referenceCapabilitySource,
      notes:
        current?.notes ||
        "Discovered from the current executable media catalog; adult capability has not been established for this exact route.",
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length) {
    const { error } = await admin.from("media_model_capabilities").upsert(rows, {
      onConflict: "provider,model,endpoint",
    });
    if (error) throw error;
  }

  return {
    nousFetchedAt: nous.fetchedAt,
    openRouterFetchedAt: openRouter.fetchedAt,
    routeCount: rows.length,
  };
}

export async function refreshMediaPolicyEvidence() {
  await ensureMediaCapabilityRouteCatalog();

  const admin = createAdminSupabaseClient();
  const checks = await Promise.all([
    checkNousPolicy(),
    checkOpenRouterPolicy(),
    Promise.resolve(localPolicyCheck()),
  ]);

  for (const check of checks) {
    if (!check.ok) continue;

    const { data: rows, error: readError } = await admin
      .from("media_model_capabilities")
      .select(
        "provider,model,endpoint,adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at,notes",
      )
      .eq("provider", check.provider);
    if (readError) throw readError;

    if (!rows?.length) continue;

    const updates = rows.map((row) => {
      const hasSpecificNonExplicit =
        row.adult_non_explicit_policy !== "unknown" &&
        Boolean(row.adult_non_explicit_policy_source) &&
        row.adult_non_explicit_policy_source !== check.source;
      const hasSpecificExplicit =
        row.adult_explicit_policy !== "unknown" &&
        Boolean(row.adult_explicit_policy_source) &&
        row.adult_explicit_policy_source !== check.source;

      return {
        provider: row.provider,
        model: row.model,
        endpoint: row.endpoint || "",
        adult_content_policy: row.adult_content_policy || "unknown",
        adult_content_policy_source:
          row.adult_content_policy_source || check.source,
        adult_content_policy_checked_at:
          row.adult_content_policy_checked_at || check.checkedAt,
        adult_non_explicit_policy: hasSpecificNonExplicit
          ? row.adult_non_explicit_policy
          : check.nonExplicitPolicy,
        adult_non_explicit_policy_source: hasSpecificNonExplicit
          ? row.adult_non_explicit_policy_source
          : check.source,
        adult_non_explicit_policy_checked_at: hasSpecificNonExplicit
          ? row.adult_non_explicit_policy_checked_at || check.checkedAt
          : check.checkedAt,
        adult_explicit_policy:
          check.explicitPolicy === "disallowed"
            ? "disallowed"
            : hasSpecificExplicit
              ? row.adult_explicit_policy
              : check.explicitPolicy,
        adult_explicit_policy_source:
          check.explicitPolicy === "disallowed"
            ? check.source
            : hasSpecificExplicit
              ? row.adult_explicit_policy_source
              : check.source,
        adult_explicit_policy_checked_at:
          check.explicitPolicy === "disallowed"
            ? check.checkedAt
            : hasSpecificExplicit
              ? row.adult_explicit_policy_checked_at || check.checkedAt
              : check.checkedAt,
        notes: row.notes,
        updated_at: check.checkedAt,
      };
    });

    const { error: updateError } = await admin
      .from("media_model_capabilities")
      .upsert(updates, {
        onConflict: "provider,model,endpoint",
        ignoreDuplicates: false,
      });
    if (updateError) throw updateError;
  }

  return {
    checkedAt: new Date().toISOString(),
    sources: checks,
  };
}

export const MEDIA_POLICY_SOURCE_URLS = {
  falAcceptableUse: FAL_AUP,
  nousTerms: NOUS_TERMS,
  openRouterTerms: OPENROUTER_TERMS,
  openRouterProviders: OPENROUTER_PROVIDERS,
} as const;
