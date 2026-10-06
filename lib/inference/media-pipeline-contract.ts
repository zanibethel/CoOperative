/**
 * Stable contracts for composing multiple media specialists into one request.
 *
 * This file deliberately models handoffs as artifacts instead of assuming that
 * unrelated models can exchange internal latent tensors. Provider-native
 * latents are allowed only when both sides advertise the same compatibility key.
 */

export const MEDIA_PIPELINE_CAPABILITIES = [
  "prompt-planning",
  "composition",
  "pose-control",
  "depth-control",
  "segmentation",
  "base-generation",
  "candidate-generation",
  "reference-fidelity",
  "identity-preservation",
  "face-detail",
  "anatomy",
  "hands",
  "skin-texture",
  "lighting",
  "background-detail",
  "inpainting",
  "outpainting",
  "upscaling",
  "quality-judge",
  "final-verification",
] as const;

export type MediaPipelineCapability =
  (typeof MEDIA_PIPELINE_CAPABILITIES)[number];

export type MediaArtifactKind =
  | "prompt"
  | "reference-image"
  | "image"
  | "mask"
  | "pose-map"
  | "depth-map"
  | "segmentation-map"
  | "embedding"
  | "quality-report"
  | "provider-native-latent";

export type MediaContentClass =
  | "sfw"
  | "adult-non-explicit"
  | "adult-explicit";

export type MediaExecutionLocality =
  | "same-device"
  | "owned-node"
  | "unison-node"
  | "hosted-provider";

export type MediaArtifactContract = {
  kind: MediaArtifactKind;
  mimeType?: string | null;
  /**
   * Required for provider-native-latent handoffs. It should identify a truly
   * compatible model family / VAE / latent representation, not merely a vendor.
   */
  compatibilityKey?: string | null;
};

export type MediaPipelineComponent = {
  registryRouteId: string | null;
  provider: string;
  model: string;
  endpoint: string;
  displayName: string;
  executionReady: boolean;
  locality: MediaExecutionLocality;
  free: boolean;
  capabilities: MediaPipelineCapability[];
  acceptedContentClasses: MediaContentClass[];
  accepts: MediaArtifactContract[];
  produces: MediaArtifactContract[];
  estimatedCostUsd: number | null;
  qualityScore: number | null;
  reliabilityScore: number | null;
  confidence: number;
};

export type MediaComponentSelectionRequest = {
  capability: MediaPipelineCapability;
  contentClass: MediaContentClass;
  availableArtifacts: MediaArtifactContract[];
  maxStageCostUsd: number;
  preferLocal?: boolean;
};

export type RankedMediaPipelineComponent = {
  component: MediaPipelineComponent;
  score: number;
  scoreBreakdown: {
    quality: number;
    reliability: number;
    confidence: number;
    budgetEfficiency: number;
    localityBonus: number;
    freeBonus: number;
  };
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function mediaArtifactsCompatible(
  produced: MediaArtifactContract,
  accepted: MediaArtifactContract,
) {
  if (produced.kind !== accepted.kind) return false;

  if (produced.kind !== "provider-native-latent") {
    return true;
  }

  const producedKey = produced.compatibilityKey?.trim() || "";
  const acceptedKey = accepted.compatibilityKey?.trim() || "";
  return Boolean(producedKey && acceptedKey && producedKey === acceptedKey);
}

export function mediaComponentCanConsume(
  component: MediaPipelineComponent,
  availableArtifacts: MediaArtifactContract[],
) {
  if (!component.accepts.length) return true;

  return component.accepts.every((accepted) =>
    availableArtifacts.some((produced) =>
      mediaArtifactsCompatible(produced, accepted),
    ),
  );
}

export function mediaComponentEligible(
  component: MediaPipelineComponent,
  request: MediaComponentSelectionRequest,
) {
  if (!component.executionReady) return false;
  if (!component.capabilities.includes(request.capability)) return false;
  if (!component.acceptedContentClasses.includes(request.contentClass)) {
    return false;
  }
  if (!mediaComponentCanConsume(component, request.availableArtifacts)) {
    return false;
  }

  if (component.estimatedCostUsd === null) {
    return component.free;
  }

  return component.estimatedCostUsd <= Math.max(0, request.maxStageCostUsd);
}

export function rankMediaPipelineComponents(
  components: MediaPipelineComponent[],
  request: MediaComponentSelectionRequest,
): RankedMediaPipelineComponent[] {
  const maxStageCostUsd = Math.max(0, request.maxStageCostUsd);
  const preferLocal = request.preferLocal !== false;

  return components
    .filter((component) => mediaComponentEligible(component, request))
    .map((component) => {
      const quality = clamp(component.qualityScore ?? 50);
      const reliability = clamp(component.reliabilityScore ?? 50);
      const confidence = clamp(component.confidence * 100);
      const cost = component.estimatedCostUsd ?? 0;
      const budgetEfficiency =
        cost <= 0
          ? 100
          : maxStageCostUsd > 0
            ? clamp((1 - cost / maxStageCostUsd) * 100)
            : 0;
      const localityBonus =
        preferLocal && component.locality !== "hosted-provider" ? 8 : 0;
      const freeBonus = component.free ? 4 : 0;

      const score = clamp(
        quality * 0.5 +
          reliability * 0.2 +
          confidence * 0.1 +
          budgetEfficiency * 0.2 +
          localityBonus +
          freeBonus,
      );

      return {
        component,
        score,
        scoreBreakdown: {
          quality,
          reliability,
          confidence,
          budgetEfficiency,
          localityBonus,
          freeBonus,
        },
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.component.estimatedCostUsd ?? 0) -
          (b.component.estimatedCostUsd ?? 0),
    );
}

/**
 * ai_model_task_scores.task_type is text, so component-specific scores can use
 * this stable naming convention without introducing a new database enum/table.
 */
export function mediaPipelineTaskType(capability: MediaPipelineCapability) {
  return `media-component:${capability}`;
}
