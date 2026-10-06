import "server-only";

import { createHash } from "crypto";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { hermesManagedMediaCatalog } from "@/lib/inference/hermes-managed-catalog";
import { nousManagedMediaCatalog } from "@/lib/inference/nous-managed-media";
import { openRouterMediaCatalog } from "@/lib/inference/openrouter-media-catalog";
import { publicTextModelRegistry } from "@/lib/inference/text-model-registry";
import { recomputeAllModelTaskScores } from "@/lib/inference/model-performance-scoring";

export const MODEL_CAPABILITY_SCANNER_VERSION = "2026-10-06.1";

type JsonMap = Record<string, unknown>;

type RouteSnapshot = {
  provider: string;
  model: string;
  endpoint: string;
  routeKind: string;
  displayName: string;
  source: string;
  status: string;
  free: boolean;
  recommended: boolean;
  executionReady: boolean;
  inputModalities: string[];
  outputModalities: string[];
  capabilitySummary: JsonMap;
  pricing: JsonMap;
  limits: JsonMap;
  policySummary: JsonMap;
  benchmarkSummary: JsonMap;
  runtimeSummary: JsonMap;
  metadata: JsonMap;
};

type ScanSourceResult = {
  source: string;
  provider: string;
  ok: boolean;
  count: number;
  detail?: string;
};

type ExistingPolicyRow = {
  provider: string;
  model: string;
  endpoint: string;
  adult_content_policy: string | null;
  adult_content_policy_source: string | null;
  adult_content_policy_checked_at: string | null;
  adult_non_explicit_policy: string | null;
  adult_non_explicit_policy_source: string | null;
  adult_non_explicit_policy_checked_at: string | null;
  adult_explicit_policy: string | null;
  adult_explicit_policy_source: string | null;
  adult_explicit_policy_checked_at: string | null;
  reference_capability: string | null;
  reference_capability_source: string | null;
  notes: string | null;
  updated_at: string | null;
};

function routeKey(input: {
  provider: string;
  model: string;
  endpoint?: string | null;
  routeKind: string;
}) {
  return [
    input.provider,
    input.model,
    input.endpoint || "",
    input.routeKind,
  ].join("|");
}

function policyKey(provider: string, model: string, endpoint = "") {
  return [provider, model, endpoint].join("|");
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function fingerprint(snapshot: RouteSnapshot) {
  const metadata = { ...snapshot.metadata };
  delete metadata.catalogFetchedAt;

  return createHash("sha256")
    .update(
      JSON.stringify(
        stableValue({
          ...snapshot,
          metadata,
        }),
      ),
    )
    .digest("hex");
}

function changedFields(before: JsonMap, after: JsonMap) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) =>
      JSON.stringify(stableValue(before[key])) !==
      JSON.stringify(stableValue(after[key])),
  );
}

function policySummary(row: ExistingPolicyRow | undefined): JsonMap {
  if (!row) {
    return {
      adult: {
        general: "unknown",
        nonExplicit: "unknown",
        explicit: "unknown",
      },
      referenceCapability: "unknown",
    };
  }

  return {
    adult: {
      general: row.adult_content_policy || "unknown",
      generalSource: row.adult_content_policy_source,
      generalCheckedAt: row.adult_content_policy_checked_at,
      nonExplicit: row.adult_non_explicit_policy || "unknown",
      nonExplicitSource: row.adult_non_explicit_policy_source,
      nonExplicitCheckedAt: row.adult_non_explicit_policy_checked_at,
      explicit: row.adult_explicit_policy || "unknown",
      explicitSource: row.adult_explicit_policy_source,
      explicitCheckedAt: row.adult_explicit_policy_checked_at,
    },
    referenceCapability: row.reference_capability || "unknown",
    referenceCapabilitySource: row.reference_capability_source,
    notes: row.notes,
    evidenceUpdatedAt: row.updated_at,
  };
}

function inferEvidenceRouteKind(row: ExistingPolicyRow) {
  const endpoint = row.endpoint || "";
  if (/video|pixverse/i.test(row.model) || /video/i.test(endpoint)) {
    return "video";
  }
  if (endpoint) return "image-edit";
  if (/image|flux|banana|grok|seedream|z-image/i.test(row.model)) {
    return "image";
  }
  return "image";
}

function snapshotSummary(snapshot: RouteSnapshot): JsonMap {
  return {
    provider: snapshot.provider,
    model: snapshot.model,
    endpoint: snapshot.endpoint,
    routeKind: snapshot.routeKind,
    status: snapshot.status,
    free: snapshot.free,
    recommended: snapshot.recommended,
    executionReady: snapshot.executionReady,
    inputModalities: snapshot.inputModalities,
    outputModalities: snapshot.outputModalities,
    capabilitySummary: snapshot.capabilitySummary,
    pricing: snapshot.pricing,
    limits: snapshot.limits,
    policySummary: snapshot.policySummary,
    runtimeSummary: snapshot.runtimeSummary,
  };
}

async function loadEvidenceMaps() {
  const admin = createAdminSupabaseClient();
  const [
    { data: policies, error: policyError },
    { data: runtimeRows, error: runtimeError },
  ] = await Promise.all([
    admin
      .from("media_model_capabilities")
      .select(
        "provider,model,endpoint,adult_content_policy,adult_content_policy_source,adult_content_policy_checked_at,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_non_explicit_policy_checked_at,adult_explicit_policy,adult_explicit_policy_source,adult_explicit_policy_checked_at,reference_capability,reference_capability_source,notes,updated_at",
      ),
    admin
      .from("media_route_outcomes")
      .select(
        "provider,model,endpoint,execution_mode,request_shape,outcome_kind,blocks_route,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  if (policyError) throw policyError;
  if (runtimeError) throw runtimeError;

  const policyMap = new Map<string, ExistingPolicyRow>();
  for (const row of (policies || []) as ExistingPolicyRow[]) {
    policyMap.set(policyKey(row.provider, row.model, row.endpoint || ""), row);
  }

  const runtimeMap = new Map<string, JsonMap>();
  for (const row of runtimeRows || []) {
    const key = policyKey(row.provider, row.model, row.endpoint || "");
    if (runtimeMap.has(key)) continue;
    runtimeMap.set(key, {
      latestOutcome: row.outcome_kind,
      latestRequestShape: row.request_shape,
      latestExecutionMode: row.execution_mode,
      blocksRoute: row.blocks_route === true,
      observedAt: row.created_at,
    });
  }

  return { policyMap, runtimeMap, policyRows: (policies || []) as ExistingPolicyRow[] };
}

async function openRouterTextCatalog() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    const credential = process.env.OPENROUTER_API_KEY?.trim();
    if (credential) headers.Authorization = `Bearer ${credential}`;

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `OpenRouter text catalog returned HTTP ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<Record<string, unknown>>;
    };

    return (payload.data || []).flatMap((row) => {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) return [];

      const architecture =
        row.architecture &&
        typeof row.architecture === "object" &&
        !Array.isArray(row.architecture)
          ? (row.architecture as JsonMap)
          : {};
      const inputModalities = Array.isArray(architecture.input_modalities)
        ? architecture.input_modalities.filter(
            (value): value is string => typeof value === "string",
          )
        : ["text"];
      const outputModalities = Array.isArray(architecture.output_modalities)
        ? architecture.output_modalities.filter(
            (value): value is string => typeof value === "string",
          )
        : ["text"];

      // Dedicated image/video output routes are represented by the media
      // catalogs. Keep this route only when it can produce text.
      if (
        outputModalities.length > 0 &&
        !outputModalities.some(
          (value) => value.toLowerCase() === "text",
        )
      ) {
        return [];
      }

      const pricing =
        row.pricing &&
        typeof row.pricing === "object" &&
        !Array.isArray(row.pricing)
          ? (row.pricing as JsonMap)
          : {};
      const supportedParameters = Array.isArray(row.supported_parameters)
        ? row.supported_parameters.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const contextLength =
        typeof row.context_length === "number"
          ? row.context_length
          : Number(row.context_length);

      return [
        {
          id,
          name:
            typeof row.name === "string" && row.name
              ? row.name
              : id,
          inputModalities,
          outputModalities,
          contextLength:
            Number.isFinite(contextLength) && contextLength > 0
              ? contextLength
              : null,
          pricing,
          supportedParameters,
          free:
            id.endsWith(":free") ||
            (Number(pricing.prompt) === 0 &&
              Number(pricing.completion) === 0),
        },
      ];
    });
  } finally {
    clearTimeout(timer);
  }
}

function localRegistrySnapshots(
  policyMap: Map<string, ExistingPolicyRow>,
  runtimeMap: Map<string, JsonMap>,
) {
  const registry = publicTextModelRegistry();
  const routes: RouteSnapshot[] = [];

  for (const profile of registry.profiles) {
    routes.push({
      provider: "cooperative-local",
      model: profile.defaultModelId,
      endpoint: "",
      routeKind: "text",
      displayName: `Local ${profile.profile} · ${profile.defaultModelId}`,
      source: "text-model-registry",
      status: "active",
      free: true,
      recommended: true,
      executionReady: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
      capabilitySummary: {
        textGeneration: true,
        profile: profile.profile,
        runtime: profile.runtime,
        purpose: profile.purpose,
        toolCalling: "unknown",
        structuredOutput: "unknown",
        reasoning: profile.profile === "quality" ? "preferred" : "available",
      },
      pricing: {
        billing: "owned-local",
        estimatedProviderCostUsd: 0,
      },
      limits: {},
      policySummary: policySummary(
        policyMap.get(policyKey("cooperative-local", profile.defaultModelId)),
      ),
      benchmarkSummary: {},
      runtimeSummary:
        runtimeMap.get(policyKey("cooperative-local", profile.defaultModelId)) || {},
      metadata: {
        registryRevision: registry.revision,
        overrideEnv: profile.overrideEnv,
      },
    });
  }

  routes.push({
    provider: "cooperative-local",
    model: registry.capabilities[0].defaultModelId,
    endpoint: "",
    routeKind: "vision",
    displayName: `Local vision · ${registry.capabilities[0].defaultModelId}`,
    source: "text-model-registry",
    status: "active",
    free: true,
    recommended: true,
    executionReady: true,
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    capabilitySummary: {
      vision: true,
      imageUnderstanding: true,
      runtime: registry.capabilities[0].runtime,
      purpose: registry.capabilities[0].purpose,
    },
    pricing: { billing: "owned-local", estimatedProviderCostUsd: 0 },
    limits: {},
    policySummary: {},
    benchmarkSummary: {},
    runtimeSummary: {},
    metadata: {
      registryRevision: registry.revision,
      overrideEnv: registry.capabilities[0].overrideEnv,
    },
  });

  for (const backend of registry.ownedNodeBackends) {
    routes.push({
      provider: "cooperative-local",
      model: backend.defaultModelId,
      endpoint: backend.runtime,
      routeKind: "text-runtime",
      displayName: backend.runtime,
      source: "text-model-registry",
      status: "active",
      free: true,
      recommended: false,
      executionReady: true,
      inputModalities: ["text"],
      outputModalities: ["text"],
      capabilitySummary: {
        capabilities: backend.capabilities,
        runtime: backend.runtime,
        purpose: backend.purpose,
      },
      pricing: { billing: "owned-node", estimatedProviderCostUsd: 0 },
      limits: {},
      policySummary: {},
      benchmarkSummary: {},
      runtimeSummary: {},
      metadata: { registryRevision: registry.revision },
    });
  }

  const localImageRoutes: Array<{
    model: string;
    displayName: string;
    routeKind: "image" | "image-edit";
    inputModalities: string[];
    defaultModelId: string;
    explicitModelId?: string;
    profile: "fast" | "quality";
    referenceMode?: string;
  }> = [
    {
      model: "local-image-fast",
      displayName: "Owned Local Fast · SD 1.5",
      routeKind: "image",
      inputModalities: ["text"],
      defaultModelId: "stable-diffusion-v1-5/stable-diffusion-v1-5",
      profile: "fast",
    },
    {
      model: "local-image-quality",
      displayName: "Owned Local Quality · SSD-1B / SDXL adult mode",
      routeKind: "image",
      inputModalities: ["text"],
      defaultModelId: "segmind/SSD-1B",
      explicitModelId: "stabilityai/stable-diffusion-xl-base-1.0",
      profile: "quality",
    },
    {
      model: "local-image-fast-reference",
      displayName: "Owned Local Fast · Reference",
      routeKind: "image-edit",
      inputModalities: ["text", "image"],
      defaultModelId: "stable-diffusion-v1-5/stable-diffusion-v1-5",
      profile: "fast",
      referenceMode: "img2img",
    },
    {
      model: "local-image-quality-reference",
      displayName: "Owned Local Quality · Reference",
      routeKind: "image-edit",
      inputModalities: ["text", "image"],
      defaultModelId: "segmind/SSD-1B",
      profile: "quality",
      referenceMode: "img2img",
    },
    {
      model: "local-image-quality-identity",
      displayName: "Owned Local Quality · Identity",
      routeKind: "image-edit",
      inputModalities: ["text", "image"],
      defaultModelId: "stabilityai/stable-diffusion-xl-base-1.0",
      profile: "quality",
      referenceMode: "ip-adapter",
    },
  ];

  for (const imageRoute of localImageRoutes) {
    routes.push({
      provider: "cooperative-local",
      model: imageRoute.model,
      endpoint: "",
      routeKind: imageRoute.routeKind,
      displayName: imageRoute.displayName,
      source: "owned-image-worker",
      status: "active",
      free: true,
      recommended: imageRoute.model === "local-image-quality",
      executionReady: true,
      inputModalities: imageRoute.inputModalities,
      outputModalities: ["image"],
      capabilitySummary: {
        textToImage: imageRoute.routeKind === "image",
        imageToImage: imageRoute.routeKind === "image-edit",
        referenceImages: imageRoute.routeKind === "image-edit",
        profile: imageRoute.profile,
        runtime: "diffusers-owned-worker",
        defaultModelId: imageRoute.defaultModelId,
        explicitModelId: imageRoute.explicitModelId || null,
        safetyFilterControl: "local-configurable",
        explicitReferenceImagesAllowed: false,
        referenceMode: imageRoute.referenceMode || null,
      },
      pricing: {
        billing: "owned-local",
        estimatedProviderCostUsd: 0,
      },
      limits: {
        maxReferenceImages: imageRoute.routeKind === "image-edit" ? 1 : 0,
      },
      policySummary: policySummary(
        policyMap.get(policyKey("cooperative-local", imageRoute.model)),
      ),
      benchmarkSummary: {},
      runtimeSummary:
        runtimeMap.get(policyKey("cooperative-local", imageRoute.model)) || {},
      metadata: {
        registryRevision: registry.revision,
        ownedRuntime: true,
        thirdPartyProviderBoundary: false,
        licenseReview:
          imageRoute.model === "local-image-quality"
            ? {
                defaultModel: "segmind/SSD-1B",
                defaultLicense: "Apache-2.0",
                explicitModel: "stabilityai/stable-diffusion-xl-base-1.0",
                explicitLicense: "CreativeML Open RAIL++-M",
                explicitLicenseSource:
                  "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/blob/main/LICENSE.md",
              }
            : {},
      },
    });
  }

  return routes;
}

export async function recordModelCapabilityEvidence(input: {
  ownerRef?: string | null;
  provider: string;
  model: string;
  endpoint?: string | null;
  routeKind: string;
  capabilityKey: string;
  scope?: string;
  state: string;
  sourceType: string;
  sourceRef?: string | null;
  confidence?: number;
  observedAt?: string;
  expiresAt?: string | null;
  evidence?: JsonMap;
}) {
  const admin = createAdminSupabaseClient();
  const endpoint = input.endpoint || "";

  const { data: route, error: routeError } = await admin
    .from("ai_model_registry")
    .select("id")
    .eq("provider", input.provider)
    .eq("model", input.model)
    .eq("endpoint", endpoint)
    .eq("route_kind", input.routeKind)
    .maybeSingle();
  if (routeError) throw routeError;

  const { data, error } = await admin
    .from("ai_model_capability_evidence")
    .insert({
      registry_route_id: route?.id || null,
      owner_ref: input.ownerRef || null,
      provider: input.provider,
      model: input.model,
      endpoint,
      route_kind: input.routeKind,
      capability_key: input.capabilityKey,
      scope: input.scope || "",
      state: input.state,
      source_type: input.sourceType,
      source_ref: input.sourceRef || null,
      confidence: Math.min(1, Math.max(0, input.confidence ?? 0.5)),
      observed_at: input.observedAt || new Date().toISOString(),
      expires_at: input.expiresAt || null,
      evidence: input.evidence || {},
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

async function backfillEvidenceRouteId(input: {
  routeId: string;
  provider: string;
  model: string;
  endpoint: string;
  routeKind: string;
}) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("ai_model_capability_evidence")
    .update({ registry_route_id: input.routeId })
    .is("registry_route_id", null)
    .eq("provider", input.provider)
    .eq("model", input.model)
    .eq("endpoint", input.endpoint)
    .eq("route_kind", input.routeKind);
  if (error) throw error;
}

async function persistSpecializedPolicyEvidence(
  routeId: string,
  route: RouteSnapshot,
  currentFingerprintChanged: boolean,
) {
  if (!currentFingerprintChanged) return;

  const adult =
    route.policySummary.adult &&
    typeof route.policySummary.adult === "object"
      ? (route.policySummary.adult as JsonMap)
      : null;

  if (adult) {
    for (const [key, capabilityKey] of [
      ["general", "adult-content"],
      ["nonExplicit", "adult-non-explicit"],
      ["explicit", "adult-explicit"],
    ] as const) {
      const state = adult[key];
      if (typeof state !== "string" || state === "unknown") continue;
      const source =
        typeof adult[`${key}Source`] === "string"
          ? String(adult[`${key}Source`])
          : null;
      const observedAt =
        typeof adult[`${key}CheckedAt`] === "string"
          ? String(adult[`${key}CheckedAt`])
          : new Date().toISOString();

      const admin = createAdminSupabaseClient();
      const { error } = await admin
        .from("ai_model_capability_evidence")
        .insert({
          registry_route_id: routeId,
          owner_ref: null,
          provider: route.provider,
          model: route.model,
          endpoint: route.endpoint,
          route_kind: route.routeKind,
          capability_key: capabilityKey,
          scope: key,
          state,
          source_type: "policy",
          source_ref: source,
          confidence: state === "allowed" || state === "disallowed" ? 0.9 : 0.5,
          observed_at: observedAt,
          evidence: {
            migratedFrom: "media_model_capabilities",
          },
        });
      if (error) throw error;
    }
  }
}

export async function scanModelCapabilities(input: {
  triggerSource?: string;
} = {}) {
  const admin = createAdminSupabaseClient();
  const scanId = crypto.randomUUID();
  const triggerSource = input.triggerSource || "manual";
  const startedAt = new Date().toISOString();

  const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await admin
    .from("ai_model_scan_runs")
    .update({
      status: "failed",
      error: "Scanner run exceeded the 15-minute stale-run guard.",
      completed_at: startedAt,
    })
    .eq("status", "running")
    .lt("started_at", staleCutoff);

  const { data: activeRun, error: activeRunError } = await admin
    .from("ai_model_scan_runs")
    .select("id,scanner_version,trigger_source,status,started_at")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRunError) throw activeRunError;
  if (activeRun) {
    return {
      scanId: activeRun.id,
      scannerVersion: activeRun.scanner_version,
      status: "already-running" as const,
      discoveredCount: 0,
      newCount: 0,
      changedCount: 0,
      missingCount: 0,
      sources: [] as ScanSourceResult[],
      completedAt: null,
    };
  }

  const { error: runInsertError } = await admin
    .from("ai_model_scan_runs")
    .insert({
      id: scanId,
      scanner_version: MODEL_CAPABILITY_SCANNER_VERSION,
      trigger_source: triggerSource,
      status: "running",
      sources: [],
      started_at: startedAt,
    });
  if (runInsertError) throw runInsertError;

  try {
    const { policyMap, runtimeMap, policyRows } = await loadEvidenceMaps();
    const routes: RouteSnapshot[] = [];
    const sources: ScanSourceResult[] = [];
    const successfulCoverage = new Set<string>();

    const [
      openRouterResult,
      openRouterTextResult,
      hermesManagedResult,
      nousResult,
    ] = await Promise.allSettled([
      openRouterMediaCatalog(true),
      openRouterTextCatalog(),
      hermesManagedMediaCatalog(),
      nousManagedMediaCatalog(),
    ]);

    if (openRouterResult.status === "fulfilled") {
      const catalog = openRouterResult.value;
      successfulCoverage.add("openrouter:image");
      successfulCoverage.add("openrouter:video");

      for (const model of catalog.image) {
        routes.push({
          provider: "openrouter",
          model: model.id,
          endpoint: "",
          routeKind: "image",
          displayName: model.name || model.id,
          source: catalog.source,
          status: "active",
          free: model.free,
          recommended: model.recommended === true,
          executionReady: true,
          inputModalities: model.inputModalities,
          outputModalities: ["image"],
          capabilitySummary: {
            textToImage: true,
            imageToImage:
              model.inputModalities.some(
                (value) => value.toLowerCase() === "image",
              ) || (model.minInputReferences ?? 0) > 0,
            referenceImages:
              model.inputModalities.some(
                (value) => value.toLowerCase() === "image",
              ) || (model.minInputReferences ?? 0) > 0,
            minInputReferences: model.minInputReferences ?? 0,
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
            transparency: "unknown",
            inpainting: "unknown",
            outpainting: "unknown",
            styleTransfer: "unknown",
          },
          pricing: {
            free: model.free,
            unit: model.unit,
            minUnitCostUsd: model.minUnitCostUsd,
            maxUnitCostUsd: model.maxUnitCostUsd,
            costLabel: model.costLabel,
            skus: model.pricingSkus,
          },
          limits: {
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
            minInputReferences: model.minInputReferences ?? 0,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("openrouter", model.id)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("openrouter", model.id)) || {},
          metadata: {
            catalogFetchedAt: catalog.fetchedAt,
            recommendedByCoOperative: model.recommended === true,
          },
        });
      }

      for (const model of catalog.video) {
        routes.push({
          provider: "openrouter",
          model: model.id,
          endpoint: "",
          routeKind: "video",
          displayName: model.name || model.id,
          source: catalog.source,
          status: "active",
          free: model.free,
          recommended: model.recommended === true,
          executionReady: true,
          inputModalities: model.inputModalities,
          outputModalities: ["video"],
          capabilitySummary: {
            textToVideo: true,
            imageToVideo: model.inputModalities.some(
              (value) => value.toLowerCase() === "image",
            ),
            audioGeneration: model.audioSupported,
            durations: model.durations,
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
          },
          pricing: {
            free: model.free,
            unit: model.unit,
            minUnitCostUsd: model.minUnitCostUsd,
            maxUnitCostUsd: model.maxUnitCostUsd,
            costLabel: model.costLabel,
            skus: model.pricingSkus,
          },
          limits: {
            durations: model.durations,
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("openrouter", model.id)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("openrouter", model.id)) || {},
          metadata: { catalogFetchedAt: catalog.fetchedAt },
        });
      }

      sources.push({
        source: catalog.source,
        provider: "openrouter",
        ok: true,
        count: catalog.image.length + catalog.video.length,
      });
    } else {
      sources.push({
        source: "openrouter-live",
        provider: "openrouter",
        ok: false,
        count: 0,
        detail:
          openRouterResult.reason instanceof Error
            ? openRouterResult.reason.message.slice(0, 500)
            : "OpenRouter catalog scan failed.",
      });
    }

    if (openRouterTextResult.status === "fulfilled") {
      successfulCoverage.add("openrouter:text");
      successfulCoverage.add("openrouter:multimodal-text");
      for (const model of openRouterTextResult.value) {
        routes.push({
          provider: "openrouter",
          model: model.id,
          endpoint: "",
          routeKind:
            model.inputModalities.some(
              (value) => value.toLowerCase() === "image",
            )
              ? "multimodal-text"
              : "text",
          displayName: model.name,
          source: "openrouter-models-live",
          status: "active",
          free: model.free,
          recommended: false,
          executionReady: true,
          inputModalities: model.inputModalities,
          outputModalities: model.outputModalities,
          capabilitySummary: {
            textGeneration: true,
            vision:
              model.inputModalities.some(
                (value) => value.toLowerCase() === "image",
              ),
            toolCalling:
              model.supportedParameters.includes("tools") ||
              model.supportedParameters.includes("tool_choice"),
            structuredOutput:
              model.supportedParameters.includes("response_format") ||
              model.supportedParameters.includes("structured_outputs"),
            reasoning:
              model.supportedParameters.includes("reasoning") ||
              model.supportedParameters.includes("include_reasoning"),
            supportedParameters: model.supportedParameters,
          },
          pricing: {
            free: model.free,
            promptTokenUsd: model.pricing.prompt ?? null,
            completionTokenUsd: model.pricing.completion ?? null,
            raw: model.pricing,
          },
          limits: {
            contextLength: model.contextLength,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("openrouter", model.id)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("openrouter", model.id)) || {},
          metadata: {
            catalogFetchedAt: new Date().toISOString(),
          },
        });
      }

      sources.push({
        source: "openrouter-models-live",
        provider: "openrouter",
        ok: true,
        count: openRouterTextResult.value.length,
      });
    } else {
      sources.push({
        source: "openrouter-models-live",
        provider: "openrouter",
        ok: false,
        count: 0,
        detail:
          openRouterTextResult.reason instanceof Error
            ? openRouterTextResult.reason.message.slice(0, 500)
            : "OpenRouter text catalog scan failed.",
      });
    }

    if (hermesManagedResult.status === "fulfilled") {
      const catalog = hermesManagedResult.value;
      successfulCoverage.add("nous:image");
      successfulCoverage.add("nous:video");

      for (const model of catalog.image) {
        const pricingVerifiedEnoughForAutomaticRouting =
          model.estimatedCostUsd !== null &&
          Number.isFinite(model.estimatedCostUsd) &&
          model.estimatedCostUsd >= 0 &&
          (model.pricingUnit === "image" ||
            model.pricingUnit === "megapixel");

        routes.push({
          provider: "nous",
          model: model.id,
          endpoint: "",
          routeKind: "image",
          displayName: model.displayName,
          source: catalog.source,
          status: "active",
          free: false,
          recommended: false,
          executionReady: pricingVerifiedEnoughForAutomaticRouting,
          inputModalities: ["text"],
          outputModalities: ["image"],
          capabilitySummary: {
            textToImage: true,
            imageToImage: Boolean(model.editEndpoint),
            referenceImages: Boolean(model.editEndpoint),
            maxReferenceImages: model.maxReferenceImages,
            hermesManaged: true,
            speed: model.speed,
            strengths: model.strengths,
          },
          pricing: {
            estimatedCostUsd: model.estimatedCostUsd,
            unit: model.pricingUnit,
            costLabel: model.priceLabel,
            approximate: true,
            pricingSource: catalog.imageSource,
          },
          limits: {
            maxReferenceImages: model.maxReferenceImages,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("nous", model.id)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("nous", model.id)) || {},
          metadata: {
            catalogFetchedAt: catalog.fetchedAt,
            hermesRelease: catalog.release,
            managedBackend: "fal",
            sourceCatalog: catalog.imageSource,
            automaticRouting:
              pricingVerifiedEnoughForAutomaticRouting
                ? model.pricingUnit === "megapixel"
                  ? "request-cost-resolver-required"
                  : "eligible-with-runtime-gates"
                : "price-unbounded",
          },
        });

        if (model.editEndpoint) {
          routes.push({
            provider: "nous",
            model: model.id,
            endpoint: model.editEndpoint,
            routeKind: "image-edit",
            displayName: `${model.displayName} · edit/reference`,
            source: catalog.source,
            status: "active",
            free: false,
            recommended: false,
            // Reference routes remain gated by the existing exact-route verification
            // flow. Discovery alone must not authorize a paid edit.
            executionReady: false,
            inputModalities: ["text", "image"],
            outputModalities: ["image"],
            capabilitySummary: {
              textToImage: false,
              imageToImage: true,
              referenceImages: true,
              maxReferenceImages: model.maxReferenceImages,
              hermesManaged: true,
            },
            pricing: {
              estimatedCostUsd: model.estimatedCostUsd,
              unit: model.pricingUnit,
              costLabel: model.priceLabel,
              approximate: true,
              pricingSource: catalog.imageSource,
            },
            limits: {
              maxReferenceImages: model.maxReferenceImages,
            },
            policySummary: policySummary(
              policyMap.get(
                policyKey("nous", model.id, model.editEndpoint),
              ),
            ),
            benchmarkSummary: {},
            runtimeSummary:
              runtimeMap.get(
                policyKey("nous", model.id, model.editEndpoint),
              ) || {},
            metadata: {
              catalogFetchedAt: catalog.fetchedAt,
              hermesRelease: catalog.release,
              managedBackend: "fal",
              sourceCatalog: catalog.imageSource,
              exactRouteVerificationRequired: true,
            },
          });
        }
      }

      for (const model of catalog.video) {
        routes.push({
          provider: "nous",
          model: model.id,
          endpoint: "",
          routeKind: "video",
          displayName: model.displayName,
          source: catalog.source,
          status: "active",
          free: false,
          recommended: false,
          // Hermes can execute these families, but automatic selection waits for
          // request-specific live price bounding. PixVerse is overwritten below
          // by the existing live-priced route and remains execution-ready.
          executionReady: false,
          inputModalities: model.imageEndpoint
            ? ["text", "image"]
            : ["text"],
          outputModalities: ["video"],
          capabilitySummary: {
            textToVideo: Boolean(model.textEndpoint),
            imageToVideo: Boolean(model.imageEndpoint),
            audioGeneration: model.audioSupported,
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
            hermesManaged: true,
            tier: model.tier,
            speed: model.speed,
            strengths: model.strengths,
          },
          pricing: {
            costLabel: model.tier,
            approximate: true,
            pricingSource: catalog.videoSource,
            livePriceRequiredForAutomaticRouting: true,
          },
          limits: {
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
            durationSeconds:
              model.minDurationSeconds !== null &&
              model.maxDurationSeconds !== null
                ? {
                    min: model.minDurationSeconds,
                    max: model.maxDurationSeconds,
                  }
                : null,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("nous", model.id)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("nous", model.id)) || {},
          metadata: {
            catalogFetchedAt: catalog.fetchedAt,
            hermesRelease: catalog.release,
            managedBackend: "fal-queue",
            sourceCatalog: catalog.videoSource,
            automaticRouting: "live-price-required",
          },
        });
      }

      sources.push({
        source: catalog.source,
        provider: "nous",
        ok: true,
        count:
          catalog.image.length +
          catalog.image.filter((model) => Boolean(model.editEndpoint)).length +
          catalog.video.length,
      });
    } else {
      sources.push({
        source: "hermes-managed-catalog",
        provider: "nous",
        ok: false,
        count: 0,
        detail:
          hermesManagedResult.reason instanceof Error
            ? hermesManagedResult.reason.message.slice(0, 500)
            : "Hermes managed media catalog scan failed.",
      });
    }

    if (nousResult.status === "fulfilled") {
      const catalog = nousResult.value;

      for (const model of catalog.image) {
        routes.push({
          provider: "nous",
          model: model.model,
          endpoint: "",
          routeKind: "image",
          displayName:
            typeof model.displayName === "string"
              ? model.displayName
              : model.model.replace(/^fal-ai\//, ""),
          source: catalog.source,
          status: "active",
          free: false,
          recommended: true,
          executionReady: model.executionReady !== false,
          inputModalities: ["text"],
          outputModalities: ["image"],
          capabilitySummary: {
            textToImage: true,
            imageToImage: Boolean(model.editEndpoint),
            referenceImages: Boolean(model.editEndpoint),
            maxReferenceImages: model.maxReferenceImages || 0,
            qualityLabel: model.qualityLabel,
            minQualityLevel: model.minLevel,
            hermesManaged: true,
          },
          pricing: {
            estimatedCostUsd: model.estimatedCostUsd,
            unit: model.pricingUnit || "unknown",
            pricingSource: model.pricingSource,
            approximate: model.pricingApproximate === true,
          },
          limits: {
            maxReferenceImages: model.maxReferenceImages || 0,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("nous", model.model)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("nous", model.model)) || {},
          metadata: {
            catalogFetchedAt: catalog.fetchedAt,
            qualityLabel: model.qualityLabel,
            hermesRelease: catalog.hermesRelease || null,
            managedBackend: "fal",
          },
        });
      }

      for (const model of catalog.videoModels || []) {
        routes.push({
          provider: "nous",
          model: model.model,
          endpoint: "",
          routeKind: "video",
          displayName: model.displayName,
          source: catalog.source,
          status: "active",
          free: false,
          recommended: model.executionReady,
          executionReady: model.executionReady,
          inputModalities: model.imageEndpoint
            ? ["text", "image"]
            : ["text"],
          outputModalities: ["video"],
          capabilitySummary: {
            textToVideo: true,
            imageToVideo: Boolean(model.imageEndpoint),
            audioGeneration: model.audioSupported,
            audioMode: model.audioMode,
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
            qualityLabel: model.qualityLabel,
            minQualityLevel: model.minLevel,
            hermesManaged: true,
          },
          pricing: {
            unit: "second",
            rates: model.rates,
            pricingSource: model.pricingSource,
            approximate: model.pricingApproximate,
            requestCostResolverRequired: true,
          },
          limits: {
            durationSeconds:
              model.minDurationSeconds !== null &&
              model.maxDurationSeconds !== null
                ? {
                    min: model.minDurationSeconds,
                    max: model.maxDurationSeconds,
                  }
                : null,
            aspectRatios: model.aspectRatios,
            resolutions: model.resolutions,
          },
          policySummary: policySummary(
            policyMap.get(policyKey("nous", model.model)),
          ),
          benchmarkSummary: {},
          runtimeSummary:
            runtimeMap.get(policyKey("nous", model.model)) || {},
          metadata: {
            catalogFetchedAt: catalog.fetchedAt,
            hermesRelease: catalog.hermesRelease || null,
            managedBackend: "fal-queue",
            automaticRouting: model.executionReady
              ? "request-cost-resolver-required"
              : "live-price-unbounded",
            pricingNote: model.pricingNote,
          },
        });
      }

      sources.push({
        source: catalog.source,
        provider: "nous",
        ok: true,
        count: catalog.image.length + (catalog.videoModels?.length || 0),
      });
    } else {
      sources.push({
        source: "nous-managed-live",
        provider: "nous",
        ok: false,
        count: 0,
        detail:
          nousResult.reason instanceof Error
            ? nousResult.reason.message.slice(0, 500)
            : "Nous catalog scan failed.",
      });
    }

    successfulCoverage.add("cooperative-local:text");
    successfulCoverage.add("cooperative-local:vision");
    successfulCoverage.add("cooperative-local:text-runtime");
    successfulCoverage.add("cooperative-local:image");
    successfulCoverage.add("cooperative-local:image-edit");
    const localRoutes = localRegistrySnapshots(policyMap, runtimeMap);
    routes.push(...localRoutes);
    sources.push({
      source: "text-model-registry",
      provider: "cooperative-local",
      ok: true,
      count: localRoutes.length,
    });

    // Preserve specialized exact routes, such as edit/reference endpoints, even
    // when they are not exposed as standalone entries in the current live catalog.
    for (const row of policyRows) {
      const kind = inferEvidenceRouteKind(row);
      const key = routeKey({
        provider: row.provider,
        model: row.model,
        endpoint: row.endpoint,
        routeKind: kind,
      });
      if (
        routes.some(
          (route) =>
            routeKey(route) === key,
        )
      ) {
        continue;
      }

      routes.push({
        provider: row.provider,
        model: row.model,
        endpoint: row.endpoint,
        routeKind: kind,
        displayName: `${row.model} · ${row.endpoint}`,
        source: "capability-evidence",
        status: "evidence-only",
        free: false,
        recommended: false,
        executionReady: false,
        inputModalities: kind === "image-edit" ? ["text", "image"] : ["text"],
        outputModalities: [kind.startsWith("video") ? "video" : "image"],
        capabilitySummary: {
          referenceImages: kind === "image-edit",
          evidenceOnly: true,
        },
        pricing: {},
        limits: {},
        policySummary: policySummary(row),
        benchmarkSummary: {},
        runtimeSummary:
          runtimeMap.get(policyKey(row.provider, row.model, row.endpoint)) || {},
        metadata: {
          evidenceOnly: true,
          lastCapabilityUpdate: row.updated_at,
        },
      });
    }

    const deduped = [
      ...new Map(routes.map((route) => [routeKey(route), route])).values(),
    ];

    const { data: existingRows, error: existingError } = await admin
      .from("ai_model_registry")
      .select("*");
    if (existingError) throw existingError;

    const existingMap = new Map(
      (existingRows || []).map((row) => [
        routeKey({
          provider: row.provider,
          model: row.model,
          endpoint: row.endpoint,
          routeKind: row.route_kind,
        }),
        row,
      ]),
    );

    const seen = new Set<string>();
    let newCount = 0;
    let changedCount = 0;
    let missingCount = 0;
    const now = new Date().toISOString();

    for (const route of deduped) {
      const key = routeKey(route);
      seen.add(key);
      const current = existingMap.get(key);
      const currentFingerprint = fingerprint(route);
      const summary = snapshotSummary(route);

      if (!current) {
        const { data: inserted, error } = await admin
          .from("ai_model_registry")
          .insert({
            provider: route.provider,
            model: route.model,
            endpoint: route.endpoint,
            route_kind: route.routeKind,
            display_name: route.displayName,
            source: route.source,
            status: route.status,
            free: route.free,
            recommended: route.recommended,
            execution_ready: route.executionReady,
            input_modalities: route.inputModalities,
            output_modalities: route.outputModalities,
            capability_summary: route.capabilitySummary,
            pricing: route.pricing,
            limits: route.limits,
            policy_summary: route.policySummary,
            benchmark_summary: route.benchmarkSummary,
            runtime_summary: route.runtimeSummary,
            metadata: route.metadata,
            current_fingerprint: currentFingerprint,
            first_seen_at: now,
            last_seen_at: now,
            last_changed_at: now,
            last_scan_id: scanId,
            created_at: now,
            updated_at: now,
          })
          .select("id")
          .single();
        if (error) throw error;

        await admin.from("ai_model_scan_changes").insert({
          scan_id: scanId,
          registry_route_id: inserted.id,
          provider: route.provider,
          model: route.model,
          endpoint: route.endpoint,
          route_kind: route.routeKind,
          change_type: "new",
          previous_fingerprint: null,
          new_fingerprint: currentFingerprint,
          changed_fields: Object.keys(summary),
          before_summary: {},
          after_summary: summary,
        });

        await backfillEvidenceRouteId({
          routeId: inserted.id,
          provider: route.provider,
          model: route.model,
          endpoint: route.endpoint,
          routeKind: route.routeKind,
        });
        await persistSpecializedPolicyEvidence(
          inserted.id,
          route,
          true,
        );
        newCount += 1;
        continue;
      }

      const before: JsonMap = {
        provider: current.provider,
        model: current.model,
        endpoint: current.endpoint,
        routeKind: current.route_kind,
        status: current.status,
        free: current.free,
        recommended: current.recommended,
        executionReady: current.execution_ready,
        inputModalities: current.input_modalities,
        outputModalities: current.output_modalities,
        capabilitySummary: current.capability_summary,
        pricing: current.pricing,
        limits: current.limits,
        policySummary: current.policy_summary,
        runtimeSummary: current.runtime_summary,
      };
      const changed = current.current_fingerprint !== currentFingerprint;

      const { error: updateError } = await admin
        .from("ai_model_registry")
        .update({
          display_name: route.displayName,
          source: route.source,
          status: route.status,
          free: route.free,
          recommended: route.recommended,
          execution_ready: route.executionReady,
          input_modalities: route.inputModalities,
          output_modalities: route.outputModalities,
          capability_summary: route.capabilitySummary,
          pricing: route.pricing,
          limits: route.limits,
          policy_summary: route.policySummary,
          benchmark_summary: route.benchmarkSummary,
          runtime_summary: route.runtimeSummary,
          metadata: route.metadata,
          current_fingerprint: currentFingerprint,
          last_seen_at: now,
          last_changed_at: changed ? now : current.last_changed_at,
          last_scan_id: scanId,
          updated_at: now,
        })
        .eq("id", current.id);
      if (updateError) throw updateError;

      await backfillEvidenceRouteId({
        routeId: current.id,
        provider: route.provider,
        model: route.model,
        endpoint: route.endpoint,
        routeKind: route.routeKind,
      });

      if (changed) {
        const fields = changedFields(before, summary);
        await admin.from("ai_model_scan_changes").insert({
          scan_id: scanId,
          registry_route_id: current.id,
          provider: route.provider,
          model: route.model,
          endpoint: route.endpoint,
          route_kind: route.routeKind,
          change_type:
            current.status === "missing" && route.status !== "missing"
              ? "restored"
              : "updated",
          previous_fingerprint: current.current_fingerprint,
          new_fingerprint: currentFingerprint,
          changed_fields: fields,
          before_summary: before,
          after_summary: summary,
        });

        await persistSpecializedPolicyEvidence(
          current.id,
          route,
          true,
        );
        changedCount += 1;
      }
    }

    for (const current of existingRows || []) {
      const key = routeKey({
        provider: current.provider,
        model: current.model,
        endpoint: current.endpoint,
        routeKind: current.route_kind,
      });
      if (seen.has(key)) continue;
      if (
        !successfulCoverage.has(
          `${current.provider}:${current.route_kind}`,
        )
      ) {
        continue;
      }
      if (current.status === "missing") continue;

      const previousSummary: JsonMap = {
        status: current.status,
        source: current.source,
      };
      const { error: missingError } = await admin
        .from("ai_model_registry")
        .update({
          status: "missing",
          execution_ready: false,
          last_changed_at: now,
          last_scan_id: scanId,
          updated_at: now,
        })
        .eq("id", current.id);
      if (missingError) throw missingError;

      await admin.from("ai_model_scan_changes").insert({
        scan_id: scanId,
        registry_route_id: current.id,
        provider: current.provider,
        model: current.model,
        endpoint: current.endpoint,
        route_kind: current.route_kind,
        change_type: "missing",
        previous_fingerprint: current.current_fingerprint,
        new_fingerprint: current.current_fingerprint,
        changed_fields: ["status", "executionReady"],
        before_summary: previousSummary,
        after_summary: {
          status: "missing",
          executionReady: false,
        },
      });
      missingCount += 1;
    }

    const scoring = await recomputeAllModelTaskScores();

    const completedAt = new Date().toISOString();
    const { error: completeError } = await admin
      .from("ai_model_scan_runs")
      .update({
        status: "completed",
        sources,
        discovered_count: deduped.length,
        new_count: newCount,
        changed_count: changedCount,
        missing_count: missingCount,
        completed_at: completedAt,
        metadata: {
          successfulCoverage: [...successfulCoverage],
          scoring,
        },
      })
      .eq("id", scanId);
    if (completeError) throw completeError;

    return {
      scanId,
      scannerVersion: MODEL_CAPABILITY_SCANNER_VERSION,
      status: "completed" as const,
      discoveredCount: deduped.length,
      newCount,
      changedCount,
      missingCount,
      sources,
      scoring,
      completedAt,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Model capability scan failed.";
    await admin
      .from("ai_model_scan_runs")
      .update({
        status: "failed",
        error: detail.slice(0, 1600),
        completed_at: new Date().toISOString(),
      })
      .eq("id", scanId);

    throw error;
  }
}

export async function latestModelRegistrySnapshot() {
  const admin = createAdminSupabaseClient();
  const [
    { data: latestRun, error: runError },
    { data: routes, error: routesError },
  ] = await Promise.all([
    admin
      .from("ai_model_scan_runs")
      .select(
        "id,scanner_version,trigger_source,status,sources,discovered_count,new_count,changed_count,missing_count,error,started_at,completed_at",
      )
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("ai_model_registry")
      .select(
        "id,provider,model,endpoint,route_kind,display_name,source,status,free,recommended,execution_ready,input_modalities,output_modalities,capability_summary,pricing,limits,policy_summary,benchmark_summary,runtime_summary,score_summary,score_version,score_updated_at,first_seen_at,last_seen_at,last_changed_at",
      )
      .order("provider")
      .order("route_kind")
      .order("display_name"),
  ]);

  if (runError) throw runError;
  if (routesError) throw routesError;

  return {
    latestRun,
    routes: routes || [],
  };
}

export type ModelRegistryAvailabilityRoute = {
  id: string;
  provider: string;
  model: string;
  endpoint: string;
  routeKind: string;
  displayName: string;
  free: boolean;
  recommended: boolean;
  executionReady: boolean;
  inputModalities: string[];
  outputModalities: string[];
  capabilitySummary: Record<string, unknown>;
  pricing: Record<string, unknown>;
  limits: Record<string, unknown>;
  policySummary: Record<string, unknown>;
  runtimeSummary: Record<string, unknown>;
  scoreSummary: Record<string, unknown>;
  scoreVersion: string | null;
  scoreUpdatedAt: string | null;
  lastSeenAt: string;
  lastChangedAt: string;
};

export type ModelRegistryAvailability = {
  authoritative: boolean;
  latestCompletedScanAt: string | null;
  coverage: Set<string>;
  keys: Set<string>;
  routes: ModelRegistryAvailabilityRoute[];
};

export function modelRegistryRouteKey(input: {
  provider: string;
  model: string;
  endpoint?: string | null;
  routeKind: string;
}) {
  return [
    input.provider,
    input.model,
    input.endpoint || "",
    input.routeKind,
  ].join("|");
}

export function modelRegistryCoverageKey(provider: string, routeKind: string) {
  return `${provider}:${routeKind}`;
}

export function registryRouteEligible(
  availability: ModelRegistryAvailability,
  input: {
    provider: string;
    model: string;
    endpoint?: string | null;
    routeKind: string;
  },
) {
  const coverageKey = modelRegistryCoverageKey(
    input.provider,
    input.routeKind,
  );
  if (!availability.authoritative || !availability.coverage.has(coverageKey)) {
    return true;
  }
  return availability.keys.has(modelRegistryRouteKey(input));
}

export async function availableModelRegistryRoutes(input?: {
  providers?: string[];
  routeKinds?: string[];
  includeNonExecutable?: boolean;
  maxAgeHours?: number;
}): Promise<ModelRegistryAvailability> {
  const admin = createAdminSupabaseClient();
  const maxAgeHours = Math.max(1, input?.maxAgeHours ?? 36);
  const cutoff = new Date(
    Date.now() - maxAgeHours * 60 * 60 * 1000,
  ).toISOString();

  const { data: latestRun, error: runError } = await admin
    .from("ai_model_scan_runs")
    .select("completed_at,status")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError) throw runError;

  let query = admin
    .from("ai_model_registry")
    .select(
      "id,provider,model,endpoint,route_kind,display_name,status,free,recommended,execution_ready,input_modalities,output_modalities,capability_summary,pricing,limits,policy_summary,runtime_summary,score_summary,score_version,score_updated_at,last_seen_at,last_changed_at",
    )
    .gte("last_seen_at", cutoff);
  if (input?.providers?.length) {
    query = query.in("provider", input.providers);
  }
  if (input?.routeKinds?.length) {
    query = query.in("route_kind", input.routeKinds);
  }

  const { data, error } = await query;
  if (error) throw error;

  const scannedRows = data || [];
  const eligibleRows = scannedRows.filter(
    (row) =>
      row.status === "active" &&
      (input?.includeNonExecutable || row.execution_ready === true),
  );

  const routes: ModelRegistryAvailabilityRoute[] = eligibleRows.map((row) => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    endpoint: row.endpoint || "",
    routeKind: row.route_kind,
    displayName: row.display_name,
    free: row.free === true,
    recommended: row.recommended === true,
    executionReady: row.execution_ready === true,
    inputModalities: Array.isArray(row.input_modalities)
      ? row.input_modalities.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    outputModalities: Array.isArray(row.output_modalities)
      ? row.output_modalities.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    capabilitySummary:
      row.capability_summary &&
      typeof row.capability_summary === "object" &&
      !Array.isArray(row.capability_summary)
        ? (row.capability_summary as Record<string, unknown>)
        : {},
    pricing:
      row.pricing &&
      typeof row.pricing === "object" &&
      !Array.isArray(row.pricing)
        ? (row.pricing as Record<string, unknown>)
        : {},
    limits:
      row.limits &&
      typeof row.limits === "object" &&
      !Array.isArray(row.limits)
        ? (row.limits as Record<string, unknown>)
        : {},
    policySummary:
      row.policy_summary &&
      typeof row.policy_summary === "object" &&
      !Array.isArray(row.policy_summary)
        ? (row.policy_summary as Record<string, unknown>)
        : {},
    runtimeSummary:
      row.runtime_summary &&
      typeof row.runtime_summary === "object" &&
      !Array.isArray(row.runtime_summary)
        ? (row.runtime_summary as Record<string, unknown>)
        : {},
    scoreSummary:
      row.score_summary &&
      typeof row.score_summary === "object" &&
      !Array.isArray(row.score_summary)
        ? (row.score_summary as Record<string, unknown>)
        : {},
    scoreVersion:
      typeof row.score_version === "string" ? row.score_version : null,
    scoreUpdatedAt:
      typeof row.score_updated_at === "string" ? row.score_updated_at : null,
    lastSeenAt: row.last_seen_at,
    lastChangedAt: row.last_changed_at,
  }));

  const latestCompletedScanAt =
    latestRun?.completed_at && typeof latestRun.completed_at === "string"
      ? latestRun.completed_at
      : null;
  const authoritative =
    Boolean(latestCompletedScanAt) &&
    Date.parse(latestCompletedScanAt as string) >= Date.parse(cutoff) &&
    routes.length > 0;

  const coverage = new Set(
    scannedRows.map((row) =>
      modelRegistryCoverageKey(row.provider, row.route_kind),
    ),
  );
  const keys = new Set(
    routes.map((route) =>
      modelRegistryRouteKey({
        provider: route.provider,
        model: route.model,
        endpoint: route.endpoint,
        routeKind: route.routeKind,
      }),
    ),
  );

  return {
    authoritative,
    latestCompletedScanAt,
    coverage,
    keys,
    routes,
  };
}

export function registryTaskScore(
  availability: ModelRegistryAvailability,
  input: {
    provider: string;
    model: string;
    endpoint?: string | null;
    routeKind?: string | null;
    taskType: string;
  },
) {
  const route = availability.routes.find(
    (candidate) =>
      candidate.provider === input.provider &&
      candidate.model === input.model &&
      candidate.endpoint === (input.endpoint || "") &&
      (!input.routeKind || candidate.routeKind === input.routeKind),
  );
  if (!route) return null;

  const value = route.scoreSummary[input.taskType];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const numeric = (key: string) => {
    const raw = row[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  return {
    performance: numeric("performance"),
    costEfficiency: numeric("costEfficiency"),
    overallValue: numeric("overallValue"),
    confidence: numeric("confidence"),
    quality: numeric("quality"),
    reliability: numeric("reliability"),
    speed: numeric("speed"),
  };
}

export async function preferredRegistryFreeTextModel(input?: {
  needsVision?: boolean;
  requireReasoning?: boolean;
  requireStructuredOutput?: boolean;
}) {
  const availability = await availableModelRegistryRoutes({
    providers: ["openrouter"],
    routeKinds: ["text", "multimodal-text"],
    maxAgeHours: 36,
  }).catch(() => null);

  if (!availability?.authoritative) return "openrouter/free";

  const candidates = availability.routes.filter((route) => {
    if (!route.free || !route.executionReady) return false;
    if (
      input?.needsVision &&
      !route.inputModalities.some(
        (value) => value.toLowerCase() === "image",
      )
    ) {
      return false;
    }
    if (
      input?.requireReasoning &&
      route.capabilitySummary.reasoning !== true
    ) {
      return false;
    }
    if (
      input?.requireStructuredOutput &&
      route.capabilitySummary.structuredOutput !== true
    ) {
      return false;
    }
    return true;
  });

  if (!candidates.length) return null;

  const taskType = input?.needsVision
    ? "vision"
    : input?.requireReasoning
      ? "reasoning"
      : "general-text";

  const ranked = [...candidates].sort((a, b) => {
    const aScore = registryTaskScore(availability, {
      provider: a.provider,
      model: a.model,
      endpoint: a.endpoint,
      routeKind: a.routeKind,
      taskType,
    });
    const bScore = registryTaskScore(availability, {
      provider: b.provider,
      model: b.model,
      endpoint: b.endpoint,
      routeKind: b.routeKind,
      taskType,
    });

    const aValue = aScore?.overallValue ?? 0;
    const bValue = bScore?.overallValue ?? 0;
    const aConfidence = aScore?.confidence ?? 0;
    const bConfidence = bScore?.confidence ?? 0;

    if (Math.abs(bValue - aValue) > 0.001) return bValue - aValue;
    if (Math.abs(bConfidence - aConfidence) > 0.001) {
      return bConfidence - aConfidence;
    }

    const fallbackScore = (route: ModelRegistryAvailabilityRoute) => {
      let value = 0;
      if (route.capabilitySummary.reasoning === true) value += 4;
      if (route.capabilitySummary.structuredOutput === true) value += 3;
      if (route.capabilitySummary.toolCalling === true) value += 1;
      if (
        route.inputModalities.some(
          (item) => item.toLowerCase() === "image",
        )
      ) {
        value += input?.needsVision ? 4 : 0;
      }
      const contextLength = Number(route.limits.contextLength || 0);
      value += Math.min(4, contextLength / 100_000);
      return value;
    };

    return (
      fallbackScore(b) - fallbackScore(a) ||
      a.model.localeCompare(b.model)
    );
  });

  return ranked[0]?.model || null;
}
