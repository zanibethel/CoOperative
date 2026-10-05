"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import ModelMixer, {
  DEFAULT_MODEL_MIXER_SETTINGS,
  ModelMixerTrigger,
  type ModelMixerSettings,
} from "./ModelMixer";
import MediaFullscreenViewer, {
  type FullscreenMedia,
} from "./MediaFullscreenViewer";
import MediaCloudPicker from "./MediaCloudPicker";
import {
  serviceConnectorByKey,
  serviceConnectorDisplayName,
} from "@/lib/runtime/service-connector-registry";

type Profile = "fast" | "quality";
type NodeRouting = "default" | "prefer-owned" | "require-node";
type WebAccessMode = "off" | "auto" | "always";

type OwnedNode = {
  id: string;
  displayName: string;
  state: string;
  workerVersion?: string | null;
  lastSeenAt?: string | null;
  fresh: boolean;
  textCapable: boolean;
  availableForText: boolean;
};

type NodesResult = {
  nodes?: OwnedNode[];
  error?: string;
  detail?: string;
};

type BusinessSummary = {
  id: string;
  name: string;
  industry?: string | null;
  monthlyConnectedServiceCostCents: number;
  reportedMonthlyTechnologySpendCents?: number | null;
  monthlyTechnologyBudgetCents?: number | null;
  maxCooperativeManagedSpendCents?: number | null;
  targetSavingsPercent?: number | null;
  connectedServicesCount: number;
  connectedAiCount: number;
};

type ImageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  jobId?: string | null;
  createdAt?: string;
};

type ConversationSummary = {
  id: string;
  title: string;
  profile: Profile;
  createdAt?: string;
  updatedAt?: string;
};

type ConversationResult = {
  conversation?: ConversationSummary;
  conversations?: ConversationSummary[];
  messages?: ChatMessage[];
  error?: string;
  detail?: string;
};

type OnboardingState = {
  status: "not_started" | "in_progress" | "completed" | "dismissed" | "paused";
  currentBatch: number;
  conversationId: string | null;
  totalBatches: number;
  mode?: "choose" | "personal" | "business";
  phase?: string;
  businessId?: string | null;
  pausedReason?: string | null;
  fields?: Array<{
    field_key: string;
    category: string;
    label: string;
    value_text: string | null;
    status: "known" | "unknown" | "deferred";
    updated_at: string;
  }>;
};

type OnboardingResult = {
  state?: OnboardingState;
  handled?: boolean;
  assistantText?: string;
  error?: string;
  detail?: string;
};

type AiBalanceSummary = {
  availableMicrousd: number;
  availableUsd: number;
  funded: boolean;
  paidAiEligible: boolean;
};

type BusinessResult = {
  businesses?: BusinessSummary[];
  aiBalance?: AiBalanceSummary;
  error?: string;
  detail?: string;
};

type ProfileSettingsResult = {
  settings?: {
    webAccessMode?: WebAccessMode;
  };
  error?: string;
  detail?: string;
};

type AttachmentResult = {
  attachment?: ImageAttachment;
  error?: string;
  detail?: string;
};

type JobResult = {
  jobId?: string;
  execution?:
    | "code"
    | "local-ai"
    | "community-ai"
    | "paid-ai"
    | "free-cloud-vision"
    | "free-cloud-text"
    | "media";
  status?: string;
  profile?: Profile;
  capability?: "text" | "vision" | "image" | "video";
  provider?: string | null;
  conversationId?: string | null;
  conversationTitle?: string | null;
  businessId?: string | null;
  businessScopeSource?: "selected" | "explicit-message" | "none";
  messages?: unknown;
  partialText?: string | null;
  text?: string | null;
  mediaUrl?: string | null;
  model?: string | null;
  firstTokenMs?: number | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  workerId?: string | null;
  routingPreference?: NodeRouting;
  preferredNodeId?: string | null;
  targetNodeId?: string | null;
  routeReason?: string | null;
  paidFallbackAllowed?: boolean;
  webSearchUsed?: boolean;
  webAccessMode?: WebAccessMode;
  webSourceCount?: number;
  funding?: {
    chargedUsd?: number;
    availableMicrousd?: number;
  } | null;
  fundingRequired?: {
    estimatedCostUsd?: number;
    availableBalanceUsd?: number;
    shortfallUsd?: number;
    minimumRequiredBalanceUsd?: number;
    topUpOption?: {
      id: string;
      label?: string;
      amountMicrousd?: number;
      amountUsd: number;
      currency?: string;
    } | null;
  } | null;
  sourceJobId?: string | null;
  error?: string | null;
  detail?: string | null;
  modelMixerUpdate?: {
    maxSpendUsd?: number;
  } | null;
};

type RecoveryEvent = {
  id: string | number;
  kind: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

type RecoveryIncident = {
  id: string;
  status:
    | "diagnosing"
    | "repairing"
    | "waiting_user"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelled";
  error_class: string;
  current_message: string;
  continuation_prompt?: string | null;
  requires_user_action: boolean;
  automatic_retry: boolean;
  resolution_summary?: string | null;
  updated_at?: string;
};

type RecoveryExecutor = {
  agent?: string | null;
  taskStatus?: string | null;
  workerId?: string | null;
  deviceName?: string | null;
  requestedProfile?: string | null;
  executor?: string | null;
  provider?: string | null;
  model?: string | null;
  waitingForWorker?: boolean;
};

type RecoveryResult = {
  incident?: RecoveryIncident;
  executor?: RecoveryExecutor;
  events?: RecoveryEvent[];
  error?: string;
  detail?: string;
};

const ACTIVE_JOB_KEY = "cooperative.local-ai.active-job";
const PENDING_PAID_RESUME_KEY = "cooperative.local-ai.pending-paid-resume-job";
const PENDING_MEDIA_RESUME_KEY = "cooperative.local-ai.pending-media-resume-job";
const ACTIVE_BUSINESS_KEY = "cooperative.local-ai.active-business";
const MAX_ATTACHMENTS = 4;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1800;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.filter((message): message is ChatMessage => {
    if (!message || typeof message !== "object") return false;
    const candidate = message as { role?: unknown; content?: unknown };
    return (
      (candidate.role === "user" || candidate.role === "assistant") &&
      typeof candidate.content === "string"
    );
  });
}

function resultMeta(result: JobResult) {
  const details = [
    result.provider,
    result.model,
    result.capability === "vision" ? "vision" : "text",
    result.workerId ? `worker ${result.workerId}` : null,
    typeof result.firstTokenMs === "number"
      ? `${(result.firstTokenMs / 1000).toFixed(1)}s first token`
      : null,
    typeof result.latencyMs === "number"
      ? `${(result.latencyMs / 1000).toFixed(1)}s total`
      : null,
    typeof result.promptTokens === "number" && typeof result.outputTokens === "number"
      ? `${result.promptTokens} in / ${result.outputTokens} out`
      : null,
    result.webSearchUsed
      ? `web ${result.webAccessMode || "on"}${
          typeof result.webSourceCount === "number"
            ? ` · ${result.webSourceCount} source${result.webSourceCount === 1 ? "" : "s"}`
            : ""
        }`
      : null,
    typeof result.funding?.chargedUsd === "number"
      ? `${result.funding.chargedUsd.toFixed(6)} charged`
      : null,
  ].filter(Boolean);

  return details.join(" · ");
}

function executionStep(
  status: string,
  capability?: "text" | "vision" | "image" | "video",
  streaming = false,
) {
  if (streaming) return "Responding…";
  if (status === "Preparing context…") return status;
  if (status === "Selecting an execution path…") return status;
  if (status === "Waiting for local capacity…") return status;
  if (status === "Using local vision…") return status;
  if (status === "Using free cloud vision…") return status;
  if (status === "Using free cloud reasoning…") return status;
  if (status === "Checking local vision capacity…") return status;
  if (status === "Checking local reasoning capacity…") return status;
  if (status === "Using local AI…") return status;
  if (status === "Using funded high-quality AI…") return status;
  if (status === "Generating image…") return status;
  if (status === "Generating video…") return status;
  if (status === "Recovery running in background…") return status;
  if (status === "Stopping…") return status;
  if (status === "Copied") return status;
  if (status === "Ready") return "Ready";
  if (capability === "image") return "Generating image…";
  if (capability === "video") return "Generating video…";
  return capability === "vision" ? "Using local vision…" : "Using local AI…";
}

function repairGeneratedMediaUrl(raw: string) {
  const cleaned = raw.replace(/[)\]}>.,]+$/, "");
  try {
    const parsed = new URL(cleaned);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname.endsWith(".b") && pathParts[0]?.endsWith(".media")) {
      parsed.hostname =
        parsed.hostname.replace(".", "") + "." + pathParts.shift();
      parsed.pathname = "/" + pathParts.join("/");
      return parsed.toString();
    }
  } catch {
    return cleaned;
  }
  return cleaned;
}

function generatedMedia(content: string) {
  const match = content.match(/MEDIA_(IMAGE|VIDEO):(https?:\/\/\S+)/i);
  if (!match) return null;

  return {
    kind: match[1].toLowerCase() as "image" | "video",
    url: repairGeneratedMediaUrl(match[2]),
    text: content.replace(match[0], "").trim(),
  };
}


function serviceConnectDirective(content: string) {
  const match = content.match(/SECURE_SERVICE_CONNECT:([a-z0-9-]+)/i);
  if (!match) return null;

  return {
    providerKey: match[1],
    text: content.replace(match[0], "").trim(),
  };
}

function oauthServiceConnectDirective(content: string) {
  const match = content.match(/OAUTH_SERVICE_CONNECT:([a-z0-9-]+)/i);
  if (!match) return null;

  return {
    providerKey: match[1],
    text: content.replace(match[0], "").trim(),
  };
}

function sandboxCodeTaskDirective(content: string) {
  const match = content.match(
    /SANDBOX_CODE_TASK:([0-9a-f]{8}-[0-9a-f-]{27,})/i,
  );
  if (!match) return null;

  return {
    taskId: match[1],
    text: content.replace(match[0], "").trim(),
  };
}

function connectorBuildDirective(content: string) {
  const match = content.match(
    /CONNECTOR_BUILD_STATUS:([0-9a-f]{8}-[0-9a-f-]{27,})/i,
  );
  if (!match) return null;

  return {
    taskId: match[1],
    text: content.replace(match[0], "").trim(),
  };
}

function recoveryStatusDirective(content: string) {
  const match = content.match(
    /RECOVERY_STATUS:([0-9a-f]{8}-[0-9a-f-]{27,})/i,
  );
  if (!match) return null;

  return {
    incidentId: match[1],
    text: content.replace(match[0], "").trim(),
  };
}

function fundingRequiredDirective(content: string) {
  const job = content.match(
    /(?:^|\n)(AI_MEDIA_FUNDING_REQUIRED|AI_FUNDING_REQUIRED):([0-9a-f]{8}-[0-9a-f-]{27,})\s*$/im,
  );
  if (!job) return null;

  const value = (name: string) => {
    const pattern = "(?:^|\\n)" + name + ":([^\\n]+)\\s*$";
    const match = content.match(new RegExp(pattern, "im"));
    return match?.[1]?.trim() || "";
  };
  const amount = (name: string) => {
    const parsed = Number(value(name));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const optionId = value("TOPUP_OPTION");
  const estimatedCostUsd = amount("ESTIMATED_USD");
  const minimumBalanceUsd = amount("MINIMUM_BALANCE_USD") || estimatedCostUsd;

  const text = content
    .replace(/(?:^|\n)AI_(?:MEDIA_)?FUNDING_REQUIRED:[^\n]+\s*$/gim, "")
    .replace(/(?:^|\n)ESTIMATED_USD:[^\n]+\s*$/gim, "")
    .replace(/(?:^|\n)AVAILABLE_USD:[^\n]+\s*$/gim, "")
    .replace(/(?:^|\n)MINIMUM_BALANCE_USD:[^\n]+\s*$/gim, "")
    .replace(/(?:^|\n)SHORTFALL_USD:[^\n]+\s*$/gim, "")
    .replace(/(?:^|\n)TOPUP_OPTION:[^\n]+\s*$/gim, "")
    .replace(/(?:^|\n)TOPUP_USD:[^\n]+\s*$/gim, "")
    .trim();

  return {
    resumeKind:
      job[1].toUpperCase() === "AI_MEDIA_FUNDING_REQUIRED"
        ? ("media" as const)
        : ("text" as const),
    sourceJobId: job[2],
    estimatedCostUsd,
    minimumBalanceUsd,
    availableBalanceUsd: amount("AVAILABLE_USD"),
    shortfallUsd: amount("SHORTFALL_USD"),
    topUpOptionId: optionId && optionId !== "none" ? optionId : null,
    topUpUsd: amount("TOPUP_USD"),
    text,
  };
}
function budgetFollowupDirective(content: string) {
  const marker = /(?:^|\n)BUDGET_FOLLOWUPS(?::([0-9]+(?:\.[0-9]+)?))?\s*$/im;
  const match = content.match(marker);
  if (!match) return null;

  const parsedCap = match[1] ? Number(match[1]) : null;
  return {
    text: content.replace(marker, "").trim(),
    suggestedCap:
      parsedCap !== null && Number.isFinite(parsedCap) && parsedCap > 0
        ? parsedCap
        : null,
  };
}

type MediaRecommendationOption = {
  tier: "high-end" | "balanced" | "lowest-cost";
  label: string;
  provider: "nous" | "openrouter" | "cooperative-local";
  model: string;
  modelName: string;
  estimatedCostUsd: number;
  capUsd: number;
  increaseNeededUsd: number;
  summary: string;
  executionReady?: boolean;
  referenceBehavior?: string | null;
  verificationNote?: string | null;
  editEndpoint?: string | null;
  recipe?: {
    workflow: "text-to-image" | "reference-image-edit" | "text-to-video";
    qualityIntent: "maximum-quality" | "balanced-quality-value" | "cost-efficient";
    aspectRatio: string | null;
    resolution: string | null;
    durationSeconds: number | null;
    audio: boolean | null;
    contentConstraint: "sfw-output" | "request-controlled-adult-output";
  };
  adultCapability?: "verified" | "blocked" | "unknown";
  adultCapabilityNote?: string | null;
  scorecard?: {
    qualityScore: number;
    qualitySource: "benchmark" | "mixed" | "heuristic";
    benchmarkCoverage: number;
    measuredDimensions: number;
    latestMeasuredAt: string | null;
    dimensions: {
      visualQuality: number | null;
      promptAdherence: number | null;
      anatomy: number | null;
      referenceFidelity: number | null;
      editStrength: number | null;
      speed: number | null;
    };
    selectionBasis: string;
  };
};

function mediaBenchmarkLabel(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}/100`
    : "Not benchmarked";
}

function mediaRecommendationsDirective(content: string) {
  const marker = /(?:^|\n)MEDIA_RECOMMENDATIONS:([^\s]+)\s*$/im;
  const match = content.match(marker);
  if (!match) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(match[1])) as {
      currentCapUsd?: unknown;
      options?: unknown;
    };
    const options = Array.isArray(parsed.options)
      ? parsed.options.filter((option): option is MediaRecommendationOption => {
          if (!option || typeof option !== "object") return false;
          const value = option as Partial<MediaRecommendationOption>;
          return (
            (value.tier === "high-end" ||
              value.tier === "balanced" ||
              value.tier === "lowest-cost") &&
            typeof value.label === "string" &&
            typeof value.provider === "string" &&
            typeof value.model === "string" &&
            typeof value.modelName === "string" &&
            typeof value.estimatedCostUsd === "number" &&
            Number.isFinite(value.estimatedCostUsd) &&
            typeof value.capUsd === "number" &&
            Number.isFinite(value.capUsd) &&
            typeof value.increaseNeededUsd === "number" &&
            Number.isFinite(value.increaseNeededUsd) &&
            typeof value.summary === "string" &&
            (value.executionReady === undefined ||
              typeof value.executionReady === "boolean") &&
            (value.referenceBehavior === undefined ||
              value.referenceBehavior === null ||
              typeof value.referenceBehavior === "string") &&
            (value.verificationNote === undefined ||
              value.verificationNote === null ||
              typeof value.verificationNote === "string") &&
            (value.adultCapability === undefined ||
              value.adultCapability === "verified" ||
              value.adultCapability === "blocked" ||
              value.adultCapability === "unknown") &&
            (value.adultCapabilityNote === undefined ||
              value.adultCapabilityNote === null ||
              typeof value.adultCapabilityNote === "string")
          );
        })
      : [];

    if (!options.length) return null;
    const rawText = content.replace(marker, "").trim();
    return {
      text: /^I understand the request\./i.test(rawText)
        ? "I understand the request. Expand High, Medium, or Low to compare the live-priced exact-match options. No generation has started."
        : rawText,
      currentCapUsd:
        typeof parsed.currentCapUsd === "number" &&
        Number.isFinite(parsed.currentCapUsd)
          ? parsed.currentCapUsd
          : null,
      options,
    };
  } catch {
    return null;
  }
}

function MediaRecommendationChoices({
  options,
  currentCapUsd,
  onChoose,
}: {
  options: MediaRecommendationOption[];
  currentCapUsd: number | null;
  onChoose: (option: MediaRecommendationOption) => void;
}) {
  const order: Record<MediaRecommendationOption["tier"], number> = {
    "high-end": 0,
    balanced: 1,
    "lowest-cost": 2,
  };
  const tierName: Record<MediaRecommendationOption["tier"], string> = {
    "high-end": "High",
    balanced: "Medium",
    "lowest-cost": "Low",
  };

  const sorted = [...options].sort((a, b) => order[a.tier] - order[b.tier]);
  const autoChoice =
    typeof currentCapUsd === "number"
      ? [...options]
          .filter(
            (option) =>
              option.executionReady !== false &&
              option.capUsd <= currentCapUsd + 0.000001,
          )
          .sort(
            (a, b) =>
              (b.scorecard?.qualityScore ?? 0) -
                (a.scorecard?.qualityScore ?? 0) ||
              (b.scorecard?.benchmarkCoverage ?? 0) -
                (a.scorecard?.benchmarkCoverage ?? 0) ||
              a.estimatedCostUsd - b.estimatedCostUsd,
          )[0] || null
      : null;

  return (
    <div className="media-recommendation-list" aria-label="Media recommendations">
      {sorted.map((option) => {
        const overCap =
          typeof currentCapUsd === "number" &&
          option.capUsd > currentCapUsd + 0.000001;
        const isAutoChoice = autoChoice?.tier === option.tier;
        return (
        <details
          className={`media-recommendation-card ${option.tier}${overCap ? " over-cap" : ""}${isAutoChoice ? " auto-choice" : ""}`}
          key={option.tier}
        >
          <summary>
            <span className="media-recommendation-title">
              <small>{tierName[option.tier]}</small>
              <strong>{option.label}</strong>
            </span>
            <span className="media-recommendation-price">
              <strong>
                {option.estimatedCostUsd.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 3,
                })}
              </strong>
              {typeof currentCapUsd === "number" ? (
                <small className={overCap ? "over-cap" : isAutoChoice ? "auto-choice" : ""}>
                  {overCap
                    ? "Over $" +
                      currentCapUsd.toFixed(2) +
                      " cap · +$" +
                      (option.capUsd - currentCapUsd).toFixed(2) +
                      " required"
                    : isAutoChoice
                      ? "Auto choice · fits $" + currentCapUsd.toFixed(2) + " cap"
                      : "Fits $" + currentCapUsd.toFixed(2) + " cap"}
                </small>
              ) : null}
            </span>
          </summary>

          <div className="media-recommendation-details">
            <p>{option.summary}</p>
            <div className="media-recommendation-meta">
              <span>
                <small>Provider</small>
                <strong>{option.provider}</strong>
              </span>
              <span>
                <small>Model</small>
                <strong>{option.modelName}</strong>
              </span>
              <span>
                <small>Estimated cost</small>
                <strong>
                  {option.estimatedCostUsd.toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 3,
                  })}
                </strong>
              </span>
              <span>
                <small>Cap change</small>
                <strong>
                  {option.increaseNeededUsd > 0
                    ? `+${option.increaseNeededUsd.toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "Fits current cap"}
                </strong>
              </span>
              {option.recipe ? (
                <>
                  <span>
                    <small>Workflow</small>
                    <strong>
                      {option.recipe.workflow === "reference-image-edit"
                        ? "Reference image edit"
                        : option.recipe.workflow === "text-to-video"
                          ? "Text to video"
                          : "Text to image"}
                    </strong>
                  </span>
                  <span>
                    <small>Quality goal</small>
                    <strong>
                      {option.recipe.qualityIntent === "maximum-quality"
                        ? "Maximum quality"
                        : option.recipe.qualityIntent === "balanced-quality-value"
                          ? "Balanced quality / value"
                          : "Cost efficient"}
                    </strong>
                  </span>
                  <span className="media-recommendation-meta-wide">
                    <small>Output configuration</small>
                    <strong>
                      {[
                        option.recipe.resolution,
                        option.recipe.aspectRatio,
                        option.recipe.durationSeconds
                          ? `${option.recipe.durationSeconds}s`
                          : null,
                        option.recipe.audio === true
                          ? "audio"
                          : option.recipe.audio === false
                            ? "no audio"
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Model-optimized image settings"}
                    </strong>
                  </span>
                  <span className="media-recommendation-meta-wide">
                    <small>Content output</small>
                    <strong>
                      {option.recipe.contentConstraint === "sfw-output"
                        ? "SFW output"
                        : "Follow request · adult output permitted"}
                    </strong>
                  </span>
                  {option.recipe.contentConstraint !== "sfw-output" ? (
                    <span className="media-recommendation-meta-wide">
                      <small>Adult capability</small>
                      <strong>
                        {option.adultCapability === "verified"
                          ? "Verified"
                          : option.adultCapability === "blocked"
                            ? "Blocked"
                            : "Not yet verified"}
                      </strong>
                    </span>
                  ) : null}
                </>
              ) : null}
              {option.scorecard ? (
                <>
                  <span>
                    <small>Routing quality</small>
                    <strong>
                      {option.scorecard.qualityScore}/100 ·{" "}
                      {option.scorecard.qualitySource === "benchmark"
                        ? "measured"
                        : option.scorecard.qualitySource === "mixed"
                          ? "mixed evidence"
                          : "heuristic"}
                    </strong>
                  </span>
                  <span>
                    <small>Visual quality</small>
                    <strong>
                      {mediaBenchmarkLabel(option.scorecard.dimensions.visualQuality)}
                    </strong>
                  </span>
                  <span>
                    <small>Prompt adherence</small>
                    <strong>
                      {mediaBenchmarkLabel(option.scorecard.dimensions.promptAdherence)}
                    </strong>
                  </span>
                  <span>
                    <small>Anatomy</small>
                    <strong>
                      {mediaBenchmarkLabel(option.scorecard.dimensions.anatomy)}
                    </strong>
                  </span>
                  <span>
                    <small>Reference fidelity</small>
                    <strong>
                      {mediaBenchmarkLabel(option.scorecard.dimensions.referenceFidelity)}
                    </strong>
                  </span>
                  <span>
                    <small>Edit strength</small>
                    <strong>
                      {mediaBenchmarkLabel(option.scorecard.dimensions.editStrength)}
                    </strong>
                  </span>
                  <span>
                    <small>Speed</small>
                    <strong>{mediaBenchmarkLabel(option.scorecard.dimensions.speed)}</strong>
                  </span>
                  <span>
                    <small>Benchmark evidence</small>
                    <strong>{option.scorecard.measuredDimensions}/6 measured</strong>
                  </span>
                  <span className="media-recommendation-meta-wide">
                    <small>Selection basis</small>
                    <strong>{option.scorecard.selectionBasis}</strong>
                  </span>
                </>
              ) : null}
              {option.referenceBehavior ? (
                <span className="media-recommendation-meta-wide">
                  <small>Reference behavior</small>
                  <strong>{option.referenceBehavior}</strong>
                </span>
              ) : null}
              <span>
                <small>Status</small>
                <strong>
                  {option.executionReady === false
                    ? "Verified recommendation · execution not enabled yet"
                    : "Ready to use"}
                </strong>
              </span>
            </div>
            {option.verificationNote ? (
              <p className="media-recommendation-note">{option.verificationNote}</p>
            ) : null}
            {option.recipe?.contentConstraint !== "sfw-output" &&
            option.adultCapabilityNote ? (
              <p className="media-recommendation-note">{option.adultCapabilityNote}</p>
            ) : null}
            <button
              className="media-recommendation-use"
              type="button"
              onClick={() => onChoose(option)}
              disabled={option.executionReady === false}
              title={
                option.executionReady === false
                  ? "This premium reference route is display-only until the Nous gateway and attachment handoff are verified."
                  : undefined
              }
            >
              {option.executionReady === false
                ? "Execution verification next"
                : `Use ${option.label}`}
            </button>
          </div>
        </details>
        );
      })}
    </div>
  );
}

type BudgetFollowupsProps = {
  onSuggestion?: (value: string) => void;
  onCapChange?: (value: number) => void;
  suggestedCap?: number | null;
};

function BudgetFollowups({
  onSuggestion,
  onCapChange,
  suggestedCap,
}: BudgetFollowupsProps) {
  const nextCap = suggestedCap ?? 0.1;
  return (
    <div className="recovery-suggestions" aria-label="Suggested budget follow-ups">
      <button
        type="button"
        onClick={() =>
          onSuggestion?.(
            "Keep my current budget. Reduce quality, resolution, or duration enough to fit it, then retry.",
          )
        }
      >
        Reduce quality to fit
      </button>
      <button
        type="button"
        onClick={() =>
          onSuggestion?.(
            "Use my Nous subscription/tool credits first. Use OpenRouter only as backup if it still fits my request cap.",
          )
        }
      >
        Use Nous first
      </button>
      <button
        type="button"
        onClick={() => {
          onCapChange?.(nextCap);
          onSuggestion?.(
            `Retry with a ${nextCap.toFixed(2)} max-spend cap. Still use Nous first and OpenRouter only as backup.`,
          );
        }}
      >
        Raise cap to {nextCap.toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
        })}
      </button>
      <a className="recovery-suggestion-link" href="/balance">
        Add AI balance
      </a>
    </div>
  );
}

function looksLikeCredentialText(value: string) {
  const text = value.trim();
  return (
    /^sk-or-v1-[A-Za-z0-9_-]{20,}$/i.test(text) ||
    /^sk-[A-Za-z0-9_-]{20,}$/i.test(text) ||
    /^AIza[0-9A-Za-z_-]{20,}$/i.test(text)
  );
}

type SecureServiceConnectCardProps = {
  providerKey: string;
  conversationId: string | null;
  onConnected: () => Promise<void> | void;
};

function SecureServiceConnectCard({
  providerKey,
  conversationId,
  onConnected,
}: SecureServiceConnectCardProps) {
  const connector = serviceConnectorByKey(providerKey);
  const providerName = serviceConnectorDisplayName(providerKey);
  const credentialHelpUrl = connector?.credentialHelpUrl || null;
  const [credential, setCredential] = useState("");
  const [working, setWorking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [cardError, setCardError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void fetch(
      `/api/local-ai/service-connect?providerKey=${encodeURIComponent(providerKey)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          connected?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Could not check connection.");
        if (!cancelled) setConnected(Boolean(payload.connected));
      })
      .catch((err) => {
        if (!cancelled) {
          setCardError(
            err instanceof Error ? err.message : "Could not check connection.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providerKey]);

  async function connect() {
    const secret = credential.trim();
    if (!secret || working) return;

    setWorking(true);
    setCardError("");
    try {
      const response = await fetch("/api/local-ai/service-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          providerKey,
          credential: secret,
        }),
      });
      const payload = (await response.json()) as {
        connected?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.connected) {
        throw new Error(payload.error || `Could not connect ${providerName}.`);
      }

      setCredential("");
      setConnected(true);
      await onConnected();
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : `Could not connect ${providerName}.`,
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="secure-service-card">
      <div className="secure-service-head">
        <span className="secure-service-lock" aria-hidden="true">⌾</span>
        <div>
          <strong>{providerName} secure connection</strong>
          <small>
            The key goes directly to encrypted server-side storage. It is not added to chat history.
          </small>
        </div>
      </div>

      {checking ? (
        <div className="secure-service-status">Checking connection…</div>
      ) : connected ? (
        <div className="secure-service-connected">
          <span>✓</span>
          <div>
            <strong>Connected</strong>
            <small>Hermes can use this provider for approved jobs.</small>
          </div>
        </div>
      ) : (
        <>
          <label className="secure-service-field">
            <span>{providerName} API key</span>
            <input
              type="password"
              autoComplete="off"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
              placeholder="Paste key securely"
              disabled={working}
            />
          </label>
          <button
            className="primary secure-service-button"
            type="button"
            onClick={() => void connect()}
            disabled={working || credential.trim().length < 8}
          >
            {working ? "Verifying securely…" : `Connect ${providerName}`}
          </button>
          {credentialHelpUrl ? (
            <a
              className="secure-service-key-link"
              href={credentialHelpUrl}
              target="_blank"
              rel="noreferrer"
            >
              Create or manage {providerName} credentials
            </a>
          ) : null}
        </>
      )}

      {cardError ? <div className="secure-service-error">{cardError}</div> : null}
    </div>
  );
}

type OAuthServiceConnectCardProps = {
  providerKey: string;
  conversationId: string | null;
  onConnected: () => Promise<void> | void;
};

function OAuthServiceConnectCard({
  providerKey,
  conversationId,
  onConnected,
}: OAuthServiceConnectCardProps) {
  const connector = serviceConnectorByKey(providerKey);
  const providerName = serviceConnectorDisplayName(providerKey);
  const endpoint = connector?.endpoint || "";
  const connectorConfigurationError = endpoint
    ? ""
    : `${providerName} connector endpoint is not configured.`;
  const [checking, setChecking] = useState(Boolean(endpoint));
  const [working, setWorking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [verificationUrl, setVerificationUrl] = useState("");
  const [userCode, setUserCode] = useState("");
  const [pollIntervalMs, setPollIntervalMs] = useState(2000);
  const [cardError, setCardError] = useState("");

  useEffect(() => {
    if (!endpoint) return;

    let cancelled = false;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          connected?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error || `Could not check ${providerName}.`);
        }
        if (!cancelled) setConnected(Boolean(payload.connected));
      })
      .catch((err) => {
        if (!cancelled) {
          setCardError(
            err instanceof Error ? err.message : `Could not check ${providerName}.`,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, providerName]);

  async function startConnection() {
    if (working) return;
    setWorking(true);
    setCardError("");
    try {
      if (!endpoint) {
        throw new Error(`${providerName} connector endpoint is not configured.`);
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
        }),
      });
      const payload = (await response.json()) as {
        connected?: boolean;
        sessionId?: string;
        verificationUrl?: string;
        userCode?: string;
        pollIntervalSeconds?: number;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || `Could not start ${providerName} sign-in.`);
      }
      if (payload.connected) {
        setConnected(true);
        await onConnected();
        return;
      }
      if (!payload.sessionId || !payload.verificationUrl) {
        throw new Error(`${providerName} did not return a usable sign-in session.`);
      }
      setSessionId(payload.sessionId);
      setVerificationUrl(payload.verificationUrl);
      setUserCode(payload.userCode || "");
      setPollIntervalMs(Math.max(1000, Number(payload.pollIntervalSeconds || 2) * 1000));
      window.open(payload.verificationUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : `Could not start ${providerName} sign-in.`,
      );
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!sessionId || connected) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void fetch(
        `${endpoint}?sessionId=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      )
        .then(async (response) => {
          const payload = (await response.json()) as {
            connected?: boolean;
            status?: string;
            pollIntervalSeconds?: number;
            error?: string | null;
          };
          if (cancelled) return;

          if (payload.connected || payload.status === "approved") {
            window.clearInterval(timer);
            setConnected(true);
            setSessionId(null);
            setCardError("");
            await onConnected();
            return;
          }

          if (
            payload.status === "denied" ||
            payload.status === "expired" ||
            payload.status === "failed"
          ) {
            window.clearInterval(timer);
            setSessionId(null);
            setCardError(payload.error || `${providerName} sign-in did not complete.`);
            return;
          }

          if (payload.pollIntervalSeconds) {
            setPollIntervalMs(
              Math.max(1000, Number(payload.pollIntervalSeconds) * 1000),
            );
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setCardError(
              err instanceof Error ? err.message : `Could not check ${providerName} sign-in.`,
            );
          }
        });
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    sessionId,
    connected,
    pollIntervalMs,
    onConnected,
    endpoint,
    providerName,
  ]);

  return (
    <div className="secure-service-card">
      <div className="secure-service-head">
        <span className="secure-service-lock" aria-hidden="true">↗</span>
        <div>
          <strong>{providerName} connection</strong>
          <small>
            Sign in through the provider. CoOperative keeps approved OAuth state
            in encrypted server-side storage and never sends it through chat.
          </small>
        </div>
      </div>

      {checking ? (
        <div className="secure-service-status">Checking connection…</div>
      ) : connected ? (
        <div className="secure-service-connected">
          <span>✓</span>
          <div>
            <strong>Connected</strong>
            <small>{providerName} is authorized for its approved CoOperative capabilities.</small>
          </div>
        </div>
      ) : sessionId ? (
        <>
          <div className="secure-service-oauth-code">
            <small>{providerName} authorization code</small>
            <strong>{userCode || "Open the approval page"}</strong>
          </div>
          <a
            className="primary secure-service-button secure-service-oauth-link"
            href={verificationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Approve in {providerName}
          </a>
          <div className="secure-service-status">
            Waiting for your approval… This card will finish automatically.
          </div>
        </>
      ) : (
        <button
          className="primary secure-service-button"
          type="button"
          onClick={() => void startConnection()}
          disabled={working}
        >
          {working ? "Starting secure sign-in…" : `Connect ${providerName}`}
        </button>
      )}

      {cardError || connectorConfigurationError ? (
        <div className="secure-service-error">
          {cardError || connectorConfigurationError}
        </div>
      ) : null}
    </div>
  );
}


type SandboxCodeTaskResult = {
  summary?: string;
  checksPassed?: boolean;
  changedFiles?: string[];
  strongerModelRecommendation?: {
    recommended?: boolean;
    nextStep?: string;
    requiresUserApproval?: boolean;
    reason?: string;
  };
  sandbox?: {
    pushed?: boolean;
    commitSha?: string | null;
    promotionState?: string;
    mergeAllowed?: boolean;
  };
};

type SandboxCodeTaskState = {
  task?: {
    id?: string;
    status?: string;
    branch_name?: string | null;
    error?: string | null;
    result?: SandboxCodeTaskResult | null;
  };
  error?: string;
  detail?: string;
};

function SandboxCodeTaskCard({ taskId }: { taskId: string }) {
  const [state, setState] = useState<SandboxCodeTaskState | null>(null);
  const [cardError, setCardError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function refresh() {
      try {
        const response = await fetch(
          `/api/agents/tasks?id=${encodeURIComponent(taskId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as SandboxCodeTaskState;
        if (!response.ok || !payload.task) {
          throw new Error(
            payload.detail || payload.error || "Could not read sandbox task.",
          );
        }
        if (cancelled) return;

        setState(payload);
        setCardError("");
        if (
          payload.task.status === "queued" ||
          payload.task.status === "running" ||
          payload.task.status === "waiting_llm"
        ) {
          timer = window.setTimeout(refresh, 2500);
        }
      } catch (err) {
        if (!cancelled) {
          setCardError(
            err instanceof Error ? err.message : "Could not read sandbox task.",
          );
          timer = window.setTimeout(refresh, 5000);
        }
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [taskId]);

  const task = state?.task;
  const result = task?.result || {};
  const sandbox = result.sandbox || {};
  const recommendation = result.strongerModelRecommendation;

  return (
    <div className="secure-service-card">
      <div className="secure-service-head">
        <span className="secure-service-lock" aria-hidden="true">⑂</span>
        <div>
          <strong>Sandbox code change</strong>
          <small>
            Main is protected. This task can only prepare and push a sandbox branch
            until owner review explicitly approves it for merge.
          </small>
        </div>
      </div>

      <div className="secure-service-status">
        Status: <strong>{task?.status || "queued"}</strong>
      </div>

      {task?.branch_name ? (
        <div className="secure-service-status">
          Test branch: <strong>{task.branch_name}</strong>
          {sandbox.pushed ? " · pushed for preview/testing" : ""}
        </div>
      ) : null}

      {result.summary ? (
        <div className="secure-service-status">{result.summary}</div>
      ) : null}

      {typeof result.checksPassed === "boolean" ? (
        <div className="secure-service-status">
          Checks: <strong>{result.checksPassed ? "passed" : "not all passed"}</strong>
        </div>
      ) : null}

      {sandbox.promotionState ? (
        <div className="secure-service-status">
          Promotion: <strong>{sandbox.promotionState}</strong>
        </div>
      ) : null}

      {recommendation?.recommended ? (
        <div className="secure-service-status">
          Stronger model suggested: {recommendation.reason ||
            "The current coding model needs help."}
          {recommendation.requiresUserApproval
            ? " A paid coding model requires your explicit approval."
            : ""}
        </div>
      ) : null}

      {task?.error ? <div className="secure-service-error">{task.error}</div> : null}
      {cardError ? <div className="secure-service-error">{cardError}</div> : null}
    </div>
  );
}

type FundingRequiredCardProps = {
  resumeKind: "text" | "media";
  sourceJobId: string;
  estimatedCostUsd: number;
  minimumBalanceUsd: number;
  availableBalanceUsd: number;
  topUpOptionId: string | null;
  topUpUsd: number;
  onResumed: (payload: JobResult) => Promise<void>;
};

function FundingRequiredCard({
  resumeKind,
  sourceJobId,
  estimatedCostUsd,
  minimumBalanceUsd,
  availableBalanceUsd,
  topUpOptionId,
  topUpUsd,
  onResumed,
}: FundingRequiredCardProps) {
  const [working, setWorking] = useState(false);
  const [cardError, setCardError] = useState("");
  const [currentBalanceUsd, setCurrentBalanceUsd] = useState(availableBalanceUsd);

  const enoughBalance = currentBalanceUsd + 1e-9 >= minimumBalanceUsd;

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/profile/ai-balance", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          availableUsd?: number;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Could not check AI balance.");
        if (!cancelled && typeof payload.availableUsd === "number") {
          setCurrentBalanceUsd(payload.availableUsd);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function addBalance() {
    if (!topUpOptionId || working) return;
    setWorking(true);
    setCardError("");

    try {
      const response = await fetch("/api/profile/ai-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topUpOptionId }),
      });
      const payload = (await response.json()) as {
        checkoutUrl?: string;
        error?: string;
        detail?: string;
      };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(
          payload.detail || payload.error || "Could not start secure balance top-up.",
        );
      }

      const pendingKey =
        resumeKind === "media"
          ? PENDING_MEDIA_RESUME_KEY
          : PENDING_PAID_RESUME_KEY;
      window.localStorage.setItem(pendingKey, sourceJobId);
      window.location.assign(payload.checkoutUrl);
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : "Could not start secure balance top-up.",
      );
      setWorking(false);
    }
  }

  async function continueRequest() {
    if (working) return;
    setWorking(true);
    setCardError("");
    try {
      const response = await fetch(
        resumeKind === "media"
          ? "/api/local-ai/chat/media-resume"
          : "/api/local-ai/chat/paid-fallback",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: sourceJobId }),
        },
      );
      const payload = (await response.json()) as JobResult;
      if (response.status === 402 && payload.fundingRequired) {
        if (typeof payload.fundingRequired.availableBalanceUsd === "number") {
          setCurrentBalanceUsd(payload.fundingRequired.availableBalanceUsd);
        }
        throw new Error(
          `Additional balance is still required (${Number(
            payload.fundingRequired.shortfallUsd || 0,
          ).toFixed(4)} short).`,
        );
      }
      const resumed =
        payload.status === "completed" ||
        payload.status === "running" ||
        payload.status === "queued";
      if (!response.ok || !resumed) {
        throw new Error(
          payload.detail || payload.error || "Paid AI could not resume this request.",
        );
      }
      window.localStorage.removeItem(
        resumeKind === "media"
          ? PENDING_MEDIA_RESUME_KEY
          : PENDING_PAID_RESUME_KEY,
      );
      await onResumed(payload);
    } catch (err) {
      setCardError(
        err instanceof Error ? err.message : "Paid AI could not resume this request.",
      );
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="secure-service-card">
      <div className="secure-service-head">
        <span className="secure-service-lock" aria-hidden="true">$</span>
        <div>
          <strong>
            {resumeKind === "media"
              ? "Funded media available"
              : "Stronger AI available"}
          </strong>
          <small>
            CoOperative will not start the paid{" "}
            {resumeKind === "media" ? "media provider call" : "model"} until the
            profile balance safely covers this request.
          </small>
        </div>
      </div>
      <div className="secure-service-status">
        Quoted request price: <strong>${estimatedCostUsd.toFixed(4)}</strong>
      </div>
      <div className="secure-service-status">
        Available balance: <strong>${currentBalanceUsd.toFixed(4)}</strong>
      </div>
      {!enoughBalance ? (
        <div className="secure-service-status">
          Minimum additional balance needed:{" "}\n          <strong>{"$" + Math.max(0, minimumBalanceUsd - currentBalanceUsd).toFixed(4)}</strong>
        </div>
      ) : null}
      <div className="secure-service-actions">
        {enoughBalance ? (
          <button type="button" disabled={working} onClick={() => void continueRequest()}>
            {working
              ? "Continuing…"
              : resumeKind === "media"
                ? "Continue media generation"
                : "Continue with stronger AI"}
          </button>
        ) : topUpOptionId ? (
          <button type="button" disabled={working} onClick={() => void addBalance()}>
            {working
              ? "Opening secure checkout…"
              : "Add $" + topUpUsd.toFixed(2) + " balance"}
          </button>
        ) : null}
      </div>
      {cardError ? <div className="secure-service-error">{cardError}</div> : null}
    </div>
  );
}

type ConnectorBuildStatus = {
  taskId?: string;
  status?: string;
  branchName?: string | null;
  error?: string | null;
  providerKey?: string | null;
  providerName?: string | null;
  reasoning?: {
    status?: string | null;
    workerId?: string | null;
    provider?: string | null;
    model?: string | null;
    routeReason?: string | null;
    error?: string | null;
    freeFallback?: boolean;
  } | null;
  strongerModelRecommendation?: {
    recommended?: boolean;
    reason?: string;
    requiresUserApproval?: boolean;
    nextStep?: string;
  } | null;
};

function ConnectorBuildStatusCard({ taskId }: { taskId: string }) {
  const [state, setState] = useState<ConnectorBuildStatus | null>(null);
  const [cardError, setCardError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function refresh() {
      try {
        const response = await fetch(
          `/api/local-ai/connector-build?taskId=${encodeURIComponent(taskId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as ConnectorBuildStatus & {
          error?: string | null;
        };
        if (!response.ok) {
          throw new Error(payload.error || "Could not read connector build status.");
        }
        if (cancelled) return;

        setState(payload);
        setCardError("");

        if (
          payload.status === "queued" ||
          payload.status === "claimed" ||
          payload.status === "running" ||
          payload.status === "waiting_llm"
        ) {
          timer = window.setTimeout(refresh, 3000);
        }
      } catch (err) {
        if (!cancelled) {
          setCardError(
            err instanceof Error
              ? err.message
              : "Could not read connector build status.",
          );
          timer = window.setTimeout(refresh, 5000);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [taskId]);

  const status = state?.status || "queued";
  const providerName = state?.providerName || "Third-party";
  const reasoning = state?.reasoning;
  const recommendation = state?.strongerModelRecommendation;
  const active =
    status === "queued" ||
    status === "claimed" ||
    status === "running" ||
    status === "waiting_llm";

  let statusText = `Builder status: ${status}.`;
  if (status === "waiting_llm" && reasoning?.freeFallback) {
    statusText =
      reasoning.status === "running"
        ? "Local/owned AI did not finish in the bounded window. Trying the next available free cloud model now…"
        : reasoning.status === "completed"
          ? "Free cloud reasoning completed. The builder is continuing with the connector plan…"
          : "The free cloud reasoning attempt ended. Checking whether another safe path is available…";
  } else if (status === "waiting_llm") {
    statusText = "Researching and planning the connector with local/owned AI…";
  } else if (active) {
    statusText = "Preparing a reusable connector for review…";
  } else if (status === "completed") {
    statusText = "Connector preparation completed and is ready for review.";
  } else if (status === "needs_approval") {
    statusText = "Connector preparation is ready for owner review.";
  } else if (status === "failed" && recommendation?.recommended) {
    statusText =
      "The free reasoning path could not produce a sufficiently reliable connector plan. A stronger paid model is recommended.";
  }

  return (
    <div className="secure-service-card">
      <div className="secure-service-head">
        <span className="secure-service-lock" aria-hidden="true">⌘</span>
        <div>
          <strong>{providerName} connector build</strong>
          <small>
            AI may research and prepare connector code, but it cannot receive
            credentials, authorize your account, merge, or deploy it.
          </small>
        </div>
      </div>

      <div className="secure-service-status">{statusText}</div>

      {reasoning?.freeFallback ? (
        <div className="secure-service-status">
          Free fallback:{" "}
          <strong>
            {reasoning.provider || "OpenRouter free"}
            {reasoning.model ? ` · ${reasoning.model}` : ""}
          </strong>
        </div>
      ) : null}

      {recommendation?.recommended ? (
        <div className="secure-service-status">
          <strong>Stronger AI suggested.</strong>{" "}
          {recommendation.requiresUserApproval
            ? "Paid AI will not run unless you explicitly approve a quoted request."
            : "CoOperative will keep the lower-cost path first."}
        </div>
      ) : null}

      {state?.branchName ? (
        <div className="secure-service-status">
          Local build branch: <strong>{state.branchName}</strong>
        </div>
      ) : null}

      {reasoning?.error && status === "waiting_llm" ? (
        <div className="secure-service-status">
          Latest reasoning issue: {reasoning.error}
        </div>
      ) : null}
      {state?.error ? (
        <div className="secure-service-error">{state.error}</div>
      ) : null}
      {cardError ? <div className="secure-service-error">{cardError}</div> : null}
    </div>
  );
}

type RecoveryStatusCardProps = {
  incidentId: string;
  onConversationChanged: () => Promise<void> | void;
  onSuggestion?: (value: string) => void;
  onCapChange?: (value: number) => void;
};

function RecoveryStatusCard({
  incidentId,
  onConversationChanged,
  onSuggestion,
  onCapChange,
}: RecoveryStatusCardProps) {
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [cardError, setCardError] = useState("");
  const lastStatusRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function refresh() {
      try {
        const response = await fetch(
          `/api/local-ai/recovery?incidentId=${encodeURIComponent(incidentId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as RecoveryResult;
        if (!response.ok || !payload.incident) {
          throw new Error(
            payload.detail || payload.error || "Could not read recovery status.",
          );
        }
        if (cancelled) return;

        const previousStatus = lastStatusRef.current;
        lastStatusRef.current = payload.incident.status;
        setResult(payload);
        setCardError("");

        if (
          previousStatus &&
          previousStatus !== payload.incident.status &&
          (payload.incident.status === "completed" ||
            payload.incident.status === "failed" ||
            payload.incident.status === "waiting_user")
        ) {
          await onConversationChanged();
        }

        if (
          payload.incident.status === "diagnosing" ||
          payload.incident.status === "repairing" ||
          payload.incident.status === "retrying"
        ) {
          timer = window.setTimeout(refresh, 2400);
        }
      } catch (err) {
        if (!cancelled) {
          setCardError(
            err instanceof Error ? err.message : "Could not read recovery status.",
          );
          timer = window.setTimeout(refresh, 5000);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [incidentId, onConversationChanged]);

  const incident = result?.incident;
  const events = result?.events || [];
  const active =
    incident?.status === "diagnosing" ||
    incident?.status === "repairing" ||
    incident?.status === "retrying";

  return (
    <div className="recovery-status-card">
      <div className="recovery-status-current">
        <span
          className={
            active
              ? "recovery-status-dot active"
              : incident?.status === "completed"
                ? "recovery-status-dot complete"
                : "recovery-status-dot"
          }
          aria-hidden="true"
        />
        <div>
          <strong>Recovery Agent</strong>
          <span>
            {incident?.current_message ||
              (cardError ? "Recovery status is temporarily unavailable." : "Checking recovery…")}
          </span>
        </div>
      </div>

      {incident?.continuation_prompt && active ? (
        <p className="recovery-continuation">{incident.continuation_prompt}</p>
      ) : null}

      {result?.executor ? (
        <div className="recovery-executor-strip">
          <span>
            <strong>Agent</strong>{" "}
            {result.executor.agent || "debugger"}
          </span>
          <span>
            <strong>Device</strong>{" "}
            {result.executor.waitingForWorker
              ? "waiting for local worker"
              : result.executor.taskStatus === "cancelled" &&
                  !result.executor.workerId
                ? "not used"
                : result.executor.deviceName ||
                  result.executor.workerId ||
                  "local/owned"}
          </span>
          <span>
            <strong>Model</strong>{" "}
            {result.executor.model ||
              (result.executor.waitingForWorker
                ? "not selected yet"
                : result.executor.taskStatus === "cancelled" &&
                    !result.executor.workerId
                  ? "not used"
                  : result.executor.requestedProfile
                    ? result.executor.requestedProfile + " profile"
                    : "pending")}
          </span>
          {result.executor.provider ? (
            <span>
              <strong>Provider</strong> {result.executor.provider}
            </span>
          ) : null}
        </div>
      ) : null}

      {incident?.status === "waiting_user" &&
      (incident.error_class === "spend_boundary" ||
        incident.error_class === "provider_credit_boundary") ? (
        <BudgetFollowups
          onSuggestion={onSuggestion}
          onCapChange={onCapChange}
        />
      ) : null}

      <details className="recovery-details">
        <summary>Recovery details</summary>
        <div className="recovery-event-list">
          <small>
            These are user-safe activity summaries, not private model reasoning.
          </small>
          {events.length === 0 ? (
            <span>Collecting recovery activity…</span>
          ) : (
            events.map((event) => (
              <div className="recovery-event" key={String(event.id)}>
                <span>{event.message}</span>
                {event.created_at ? (
                  <time>
                    {new Date(event.created_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                ) : null}
              </div>
            ))
          )}
          {incident?.resolution_summary ? (
            <div className="recovery-resolution">
              <strong>Resolution</strong>
              <span>{incident.resolution_summary}</span>
            </div>
          ) : null}
        </div>
      </details>

      {cardError ? <div className="secure-service-error">{cardError}</div> : null}
    </div>
  );
}

function loadBrowserImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image format could not be read on this device."));
    };
    image.src = url;
  });
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not prepare image for upload."));
      },
      mimeType,
      quality,
    );
  });
}

async function prepareImage(file: File) {
  const directlySupported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (directlySupported.has(file.type) && file.size <= MAX_UPLOAD_BYTES) {
    return file;
  }

  const image = await loadBrowserImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare image for upload.");

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob = await canvasBlob(canvas, "image/jpeg", quality);
  while (blob.size > MAX_UPLOAD_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, "image/jpeg", quality);
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is still too large after compression.");
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

export default function LocalAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [businesses, setBusinesses] = useState<BusinessSummary[]>([]);
  const [aiBalance, setAiBalance] = useState<AiBalanceSummary | null>(null);
  const [webAccessMode, setWebAccessMode] = useState<WebAccessMode>("off");
  const [ownedNodes, setOwnedNodes] = useState<OwnedNode[]>([]);
  const [nodeRouting, setNodeRouting] = useState<NodeRouting>("prefer-owned");
  const [requiredNodeId, setRequiredNodeId] = useState("");
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState("New chat");
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null);
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<Profile>("fast");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [modelMixerOpen, setModelMixerOpen] = useState(false);
  const [serviceConnectionRevision, setServiceConnectionRevision] = useState(0);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const [fullscreenMedia, setFullscreenMedia] = useState<FullscreenMedia | null>(null);
  const [modelMixer, setModelMixer] = useState<ModelMixerSettings>({
    ...DEFAULT_MODEL_MIXER_SETTINGS,
    agents: { ...DEFAULT_MODEL_MIXER_SETTINGS.agents },
  });
  const activePollRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageScrollRef = useRef<HTMLDivElement | null>(null);

  const refreshOwnedNodes = useCallback(async () => {
    const response = await fetch("/api/local-ai/nodes", { cache: "no-store" });
    const result = (await response.json()) as NodesResult;
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load owned Unison nodes.");
    }

    const items = result.nodes || [];
    setOwnedNodes(items);
    const available = items.filter((node) => node.availableForText);
    setRequiredNodeId((current) =>
      available.some((node) => node.id === current) ? current : available[0]?.id || "",
    );
    return items;
  }, []);

  const refreshProfileSettings = useCallback(async () => {
    const response = await fetch("/api/personal-ai/settings", { cache: "no-store" });
    const result = (await response.json()) as ProfileSettingsResult;
    if (!response.ok || !result.settings) {
      throw new Error(
        result.detail || result.error || "Could not load profile web settings.",
      );
    }
    const mode = result.settings.webAccessMode;
    setWebAccessMode(
      mode === "auto" || mode === "always" ? mode : "off",
    );
    return result.settings;
  }, []);

  const updateWebAccessMode = useCallback(async (mode: WebAccessMode) => {
    setWebAccessMode(mode);
    const response = await fetch("/api/personal-ai/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webAccessMode: mode }),
    });
    const result = (await response.json()) as ProfileSettingsResult;
    if (!response.ok || !result.settings) {
      throw new Error(
        result.detail || result.error || "Could not update Web access mode.",
      );
    }
    setWebAccessMode(
      result.settings.webAccessMode === "auto" ||
        result.settings.webAccessMode === "always"
        ? result.settings.webAccessMode
        : "off",
    );
  }, []);


  const refreshBusinesses = useCallback(async () => {
    const response = await fetch("/api/local-ai/businesses", { cache: "no-store" });
    const result = (await response.json()) as BusinessResult;
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load businesses.");
    }

    const items = result.businesses || [];
    setBusinesses(items);
    setAiBalance(result.aiBalance || null);

    const saved = window.localStorage.getItem(ACTIVE_BUSINESS_KEY) || "";
    const selected = items.find((item) => item.id === saved)?.id || "";
    setSelectedBusinessId(selected);

    if (selected) {
      window.localStorage.setItem(ACTIVE_BUSINESS_KEY, selected);
    } else {
      window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
    }

    return selected;
  }, []);

  const refreshConversations = useCallback(async () => {
    const response = await fetch("/api/local-ai/conversations", { cache: "no-store" });
    const result = (await response.json()) as ConversationResult;
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load conversations.");
    }

    const items = result.conversations || [];
    setConversations(items);
    return items;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const response = await fetch(
      `/api/local-ai/conversations?id=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as ConversationResult;

    if (!response.ok || !result.conversation) {
      throw new Error(result.detail || result.error || "Could not load conversation.");
    }

    setConversationId(result.conversation.id);
    setConversationTitle(result.conversation.title);
    setProfile(result.conversation.profile);
    setMessages(result.messages || []);
    setAttachments([]);
    setMeta("");
    setError("");
    return result;
  }, []);

  const refreshOnboarding = useCallback(async () => {
    const response = await fetch("/api/local-ai/onboarding", {
      cache: "no-store",
    });
    const result = (await response.json()) as OnboardingResult;
    if (!response.ok || !result.state) {
      throw new Error(
        result.detail || result.error || "Could not load get-to-know-you state.",
      );
    }
    setOnboardingState(result.state);
    return result.state;
  }, []);

  const startOrResumeOnboarding = useCallback(async () => {
    let state = await refreshOnboarding();

    if (state.status === "not_started") {
      const response = await fetch("/api/local-ai/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const result = (await response.json()) as OnboardingResult;
      if (!response.ok || !result.state) {
        throw new Error(
          result.detail || result.error || "Could not start get-to-know-you chat.",
        );
      }
      state = result.state;
      setOnboardingState(state);
    }

    if (
      state.status === "in_progress" &&
      state.conversationId &&
      state.phase !== "paused"
    ) {
      await loadConversation(state.conversationId);
      await refreshConversations();
      return true;
    }

    return false;
  }, [loadConversation, refreshConversations, refreshOnboarding]);

  const startBackgroundRecovery = useCallback(
    async (jobId: string, targetConversationId?: string | null) => {
      const response = await fetch("/api/local-ai/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceJobId: jobId }),
      });
      const result = (await response.json()) as {
        incident?: RecoveryIncident;
        error?: string;
        detail?: string;
      };

      if (!response.ok || !result.incident) {
        throw new Error(
          result.detail || result.error || "Could not start Recovery Agent.",
        );
      }

      if (targetConversationId) {
        await loadConversation(targetConversationId);
        await refreshConversations();
      }

      return result.incident;
    },
    [loadConversation, refreshConversations],
  );

  const pollJob = useCallback(
    async (jobId: string, fallbackMessages: ChatMessage[] = []) => {
      if (activePollRef.current === jobId) return;

      let pollingJobId = jobId;
      activePollRef.current = pollingJobId;
      setActiveJobId(pollingJobId);
      setStreamingText("");
      setBusy(true);
      setError("");

      try {
        let readFailureCount = 0;

        for (;;) {
          let response: Response;
          let result: JobResult;

          try {
            response = await fetch(
              `/api/local-ai/chat?jobId=${encodeURIComponent(pollingJobId)}`,
              { cache: "no-store" },
            );
            result = (await response.json()) as JobResult;
          } catch {
            if (activePollRef.current !== pollingJobId) return;

            readFailureCount += 1;
            setError("");
            setStatus(
              readFailureCount > 3
                ? "Connection interrupted — still reconnecting…"
                : "Connection interrupted — reconnecting…",
            );
            await wait(Math.min(8000, 750 * 2 ** Math.min(readFailureCount - 1, 4)));
            continue;
          }

          if (activePollRef.current !== pollingJobId) return;

          if (!response.ok) {
            if ([429, 502, 503, 504].includes(response.status)) {
              readFailureCount += 1;
              setError("");
              setStatus(
                readFailureCount > 3
                  ? "Cloud status check is delayed — still reconnecting…"
                  : "Cloud status check is delayed — retrying…",
              );
              await wait(Math.min(8000, 750 * 2 ** Math.min(readFailureCount - 1, 4)));
              continue;
            }

            throw new Error(result.detail || result.error || "Could not read CoOperative AI job.");
          }

          readFailureCount = 0;

          if (
            result.jobId &&
            result.jobId !== pollingJobId &&
            (result.status === "queued" || result.status === "running")
          ) {
            pollingJobId = result.jobId;
            activePollRef.current = pollingJobId;
            setActiveJobId(pollingJobId);
            window.localStorage.setItem(ACTIVE_JOB_KEY, pollingJobId);
          }

          if (result.profile === "fast" || result.profile === "quality") {
            setProfile(result.profile);
          }

          if (result.conversationId) {
            setConversationId(result.conversationId);
          }
          if (typeof result.partialText === "string") {
            setStreamingText(result.partialText);
          }

          const runningLabel =
            result.execution === "media"
              ? result.capability === "video"
                ? "Generating video…"
                : "Generating image…"
              : result.execution === "paid-ai"
                ? "Using funded high-quality AI…"
                : result.execution === "free-cloud-vision"
                  ? "Using free cloud vision…"
                  : result.execution === "free-cloud-text"
                    ? "Using free cloud reasoning…"
                    : result.capability === "vision"
                      ? "Using local vision…"
                      : "Using local AI…";

          if (result.status === "queued") {
            setStatus(
              result.execution === "media"
                ? result.capability === "video"
                  ? "Preparing video generation…"
                  : "Preparing image generation…"
                : result.execution === "paid-ai"
                  ? "Using funded high-quality AI…"
                  : result.execution === "free-cloud-vision"
                    ? "Using free cloud vision…"
                    : result.execution === "free-cloud-text"
                      ? "Using free cloud reasoning…"
                      : result.capability === "vision"
                        ? "Checking local vision capacity…"
                        : "Checking local reasoning capacity…",
            );
            await wait(1000);
            continue;
          }

          if (result.status === "running") {
            setStatus(runningLabel);
            await wait(650);
            continue;
          }

          if (result.status === "cancelled") {
            setStreamingText("");
            setStatus("Ready");
            window.localStorage.removeItem(ACTIVE_JOB_KEY);
            if (result.conversationId) {
              await loadConversation(result.conversationId);
              await refreshConversations();
            }
            break;
          }

          if (result.status === "completed") {
            if (result.conversationId) {
              await loadConversation(result.conversationId);
              await refreshConversations();
            } else {
              const persistedMessages = readMessages(result.messages);
              const baseMessages =
                persistedMessages.length > 0 ? persistedMessages : fallbackMessages;
              setMessages(
                result.text
                  ? [...baseMessages, { role: "assistant", content: result.text }]
                  : baseMessages,
              );
            }

            if (result.execution === "paid-ai") {
              await refreshBusinesses();
            }
            setStreamingText("");
            setMeta(resultMeta(result));
            setStatus("Ready");
            window.localStorage.removeItem(ACTIVE_JOB_KEY);
            break;
          }

          if (
            result.status === "failed" &&
            result.capability === "text" &&
            result.paidFallbackAllowed === true
          ) {
            setStreamingText("");
            setStatus("Using funded high-quality AI…");

            const paidResponse = await fetch("/api/local-ai/chat/paid-fallback", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jobId: pollingJobId }),
            });
            const paid = (await paidResponse.json()) as JobResult;

            if (paidResponse.status === 402 && paid.fundingRequired) {
              setStreamingText("");
              setStatus("Ready");
              window.localStorage.removeItem(ACTIVE_JOB_KEY);
              if (paid.conversationId) {
                await loadConversation(paid.conversationId);
              }
              await Promise.all([refreshConversations(), refreshBusinesses()]);
              break;
            }

            if (!paidResponse.ok) {
              throw new Error(
                paid.detail ||
                  paid.error ||
                  result.error ||
                  "Local AI failed and funded paid fallback was unavailable.",
              );
            }

            if (paid.status === "completed") {
              if (paid.conversationId) {
                await loadConversation(paid.conversationId);
              }
              await Promise.all([refreshConversations(), refreshBusinesses()]);
              setMeta(resultMeta(paid));
              setStatus("Ready");
              window.localStorage.removeItem(ACTIVE_JOB_KEY);
              break;
            }

            if (
              paid.jobId &&
              paid.jobId !== pollingJobId &&
              (paid.status === "running" || paid.status === "queued")
            ) {
              pollingJobId = paid.jobId;
              activePollRef.current = pollingJobId;
              setActiveJobId(pollingJobId);
              window.localStorage.setItem(ACTIVE_JOB_KEY, pollingJobId);
              continue;
            }

            throw new Error(
              paid.error || "Funded high-quality AI did not complete the request.",
            );
          }

          if (result.status === "failed") {
            setStreamingText("");
            setStatus("Recovery running in background…");

            try {
              await startBackgroundRecovery(
                pollingJobId,
                result.conversationId || null,
              );
              window.localStorage.removeItem(ACTIVE_JOB_KEY);
              setStatus("Ready");
              break;
            } catch (recoveryError) {
              throw new Error(
                recoveryError instanceof Error
                  ? recoveryError.message
                  : result.error ||
                      "CoOperative AI failed and Recovery Agent could not start.",
              );
            }
          }

          throw new Error(
            result.error ||
              `CoOperative AI job ended with status ${result.status || "unknown"}.`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "CoOperative AI request failed.");
        setStatus("Ready");
      } finally {
        if (activePollRef.current === pollingJobId) {
          activePollRef.current = null;
          setActiveJobId(null);
          setBusy(false);
        }
      }
    },
    [
      loadConversation,
      refreshBusinesses,
      refreshConversations,
      startBackgroundRecovery,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        await Promise.all([
          refreshBusinesses(),
          refreshOwnedNodes(),
          refreshProfileSettings(),
        ]);
        const threads = await refreshConversations();
        const onboarding = await refreshOnboarding();
        const params = new URLSearchParams(window.location.search);
        const resumeMediaFromQuery = params.get("resumeMediaJob");
        const pendingMediaResume =
          resumeMediaFromQuery ||
          window.localStorage.getItem(PENDING_MEDIA_RESUME_KEY);

        if (pendingMediaResume) {
          setStatus("Resuming funded media generation…");
          const mediaResponse = await fetch("/api/local-ai/chat/media-resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: pendingMediaResume }),
          });
          const media = (await mediaResponse.json()) as JobResult;

          if (
            mediaResponse.ok &&
            media.jobId &&
            (media.status === "running" || media.status === "queued")
          ) {
            window.localStorage.removeItem(PENDING_MEDIA_RESUME_KEY);
            window.history.replaceState(null, "", window.location.pathname);
            if (media.conversationId) {
              await loadConversation(media.conversationId);
            }
            window.localStorage.setItem(ACTIVE_JOB_KEY, media.jobId);
            await pollJob(media.jobId, []);
            return;
          }

          if (mediaResponse.ok && media.status === "completed") {
            window.localStorage.removeItem(PENDING_MEDIA_RESUME_KEY);
            window.history.replaceState(null, "", window.location.pathname);
            if (media.conversationId) {
              await loadConversation(media.conversationId);
            }
            await Promise.all([refreshConversations(), refreshBusinesses()]);
            setMeta(resultMeta(media));
            setStatus("Ready");
            return;
          }

          if (mediaResponse.status === 402) {
            if (media.conversationId) {
              await loadConversation(media.conversationId);
            }
            setStatus("Ready");
          } else {
            window.localStorage.removeItem(PENDING_MEDIA_RESUME_KEY);
          }
        }

        const resumeFromQuery = params.get(
          "resumePaidJob",
        );
        const pendingPaidResume =
          resumeFromQuery ||
          window.localStorage.getItem(PENDING_PAID_RESUME_KEY);

        if (pendingPaidResume) {
          setStatus("Resuming funded high-quality AI…");
          const paidResponse = await fetch("/api/local-ai/chat/paid-fallback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId: pendingPaidResume }),
          });
          const paid = (await paidResponse.json()) as JobResult;

          if (paidResponse.ok && paid.status === "completed") {
            window.localStorage.removeItem(PENDING_PAID_RESUME_KEY);
            window.history.replaceState(null, "", window.location.pathname);
            if (paid.conversationId) {
              await loadConversation(paid.conversationId);
            }
            await Promise.all([refreshConversations(), refreshBusinesses()]);
            setMeta(resultMeta(paid));
            setStatus("Ready");
            return;
          }

          if (paidResponse.status === 402) {
            if (paid.conversationId) {
              await loadConversation(paid.conversationId);
            }
            setStatus("Ready");
          } else {
            window.localStorage.removeItem(PENDING_PAID_RESUME_KEY);
          }
        }

        const savedJobId = window.localStorage.getItem(ACTIVE_JOB_KEY);

        if (savedJobId) {
          const activeResponse = await fetch(
            `/api/local-ai/chat?jobId=${encodeURIComponent(savedJobId)}`,
            { cache: "no-store" },
          );
          const active = (await activeResponse.json()) as JobResult;

          if (activeResponse.ok && active.jobId) {
            if (active.conversationId) {
              await loadConversation(active.conversationId);
            } else {
              const persistedMessages = readMessages(active.messages);
              if (persistedMessages.length > 0) setMessages(persistedMessages);
            }
            if (active.profile === "fast" || active.profile === "quality") {
              setProfile(active.profile);
            }
            await pollJob(active.jobId, readMessages(active.messages));
            return;
          }

          window.localStorage.removeItem(ACTIVE_JOB_KEY);
        }

        const activeResponse = await fetch("/api/local-ai/chat", { cache: "no-store" });
        if (!cancelled && activeResponse.status !== 204) {
          const active = (await activeResponse.json()) as JobResult;
          if (activeResponse.ok && active.jobId) {
            if (active.conversationId) {
              await loadConversation(active.conversationId);
            }
            window.localStorage.setItem(ACTIVE_JOB_KEY, active.jobId);
            await pollJob(active.jobId, readMessages(active.messages));
            return;
          }
        }

        if (
          !cancelled &&
          onboarding.status === "in_progress" &&
          onboarding.conversationId &&
          onboarding.phase !== "paused"
        ) {
          await loadConversation(onboarding.conversationId);
          return;
        }

        if (
          !cancelled &&
          threads.length === 0 &&
          onboarding.status === "not_started"
        ) {
          const startedOnboarding = await startOrResumeOnboarding();
          if (startedOnboarding) return;
        }

        if (!cancelled && threads[0]) {
          await loadConversation(threads[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load Local AI.");
          setStatus("Ready");
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      activePollRef.current = null;
    };
  }, [
    loadConversation,
    pollJob,
    refreshBusinesses,
    refreshConversations,
    refreshOwnedNodes,
    refreshProfileSettings,
    startOrResumeOnboarding,
  ]);

  async function removeAttachment(attachment: ImageAttachment) {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    try {
      await fetch(
        `/api/local-ai/attachments?id=${encodeURIComponent(attachment.id)}`,
        { method: "DELETE" },
      );
    } catch {
      // The server can clean an unattached upload later; keep the UI responsive.
    }
  }

  async function discardPendingAttachments() {
    const pending = [...attachments];
    setAttachments([]);
    await Promise.allSettled(
      pending.map((attachment) =>
        fetch(
          `/api/local-ai/attachments?id=${encodeURIComponent(attachment.id)}`,
          { method: "DELETE" },
        ),
      ),
    );
  }

  async function newChat() {
    if (busy) return;
    await discardPendingAttachments();

    try {
      const startedOnboarding = await startOrResumeOnboarding();
      if (startedOnboarding) {
        setInput("");
        setMeta("");
        setError("");
        setStatus("Ready");
        return;
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not start get-to-know-you chat.",
      );
    }

    setConversationId(null);
    setConversationTitle("New chat");
    setMessages([]);
    setInput("");
    setMeta("");
    setError("");
    setStatus("Ready");
    setModelMixer({
      ...DEFAULT_MODEL_MIXER_SETTINGS,
      agents: { ...DEFAULT_MODEL_MIXER_SETTINGS.agents },
    });
  }

  async function switchConversation(id: string) {
    if (busy) return;
    await discardPendingAttachments();
    await loadConversation(id);
  }

  async function deleteConversation() {
    if (!conversationId || busy) return;
    if (!window.confirm(`Delete “${conversationTitle}”?`)) return;

    try {
      await discardPendingAttachments();
      const response = await fetch(
        `/api/local-ai/conversations?id=${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as ConversationResult;
      if (!response.ok) {
        throw new Error(result.detail || result.error || "Could not delete conversation.");
      }

      const remaining = await refreshConversations();
      if (remaining[0]) {
        await loadConversation(remaining[0].id);
      } else {
        setConversationId(null);
        setConversationTitle("New chat");
        setMessages([]);
        setMeta("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete conversation.");
    }
  }

  async function cancelJob() {
    if (!activeJobId) return;

    setStatus("Stopping…");
    try {
      const response = await fetch("/api/local-ai/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string; detail?: string };
        throw new Error(result.detail || result.error || "Could not stop Local AI.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop Local AI.");
    }
  }

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setStatus("Copied");
      window.setTimeout(() => setStatus("Ready"), 1200);
    } catch {
      setError("Could not copy this message.");
    }
  }

  function openLocalReferencePicker() {
    const picker = fileInputRef.current;
    if (!picker) {
      setError("The local photo/file picker is not available yet.");
      return;
    }

    setError("");
    // Keep this synchronous with the user's tap. iOS can block a file picker
    // if the triggering element is unmounted or the click is deferred.
    picker.click();
    window.setTimeout(() => setAttachmentMenuOpen(false), 0);
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0 || busy) return;

    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    const selected = files.slice(0, remainingSlots);
    if (selected.length === 0) {
      setError("You can attach up to 4 images to one message.");
      return;
    }

    setUploadingImages(true);
    setError("");

    try {
      for (const file of selected) {
        if (!file.type.startsWith("image/")) {
          throw new Error("Only image files can be attached right now.");
        }

        const prepared = await prepareImage(file);
        const form = new FormData();
        form.append("file", prepared);

        const response = await fetch("/api/local-ai/attachments", {
          method: "POST",
          body: form,
        });
        const result = (await response.json()) as AttachmentResult;

        if (!response.ok || !result.attachment) {
          throw new Error(
            result.detail || result.error || "Could not upload image attachment.",
          );
        }

        setAttachments((current) => [...current, result.attachment!].slice(0, MAX_ATTACHMENTS));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach image.");
    } finally {
      setUploadingImages(false);
    }
  }

  async function recoverInterruptedSend(
    err: unknown,
    text: string,
    currentAttachments: ImageAttachment[],
    fallbackMessages: ChatMessage[],
  ) {
    const transportFailure =
      err instanceof TypeError ||
      (err instanceof Error &&
        /load failed|failed to fetch|network|connection/i.test(err.message));

    if (!transportFailure) return false;

    setError("");
    setStatus("Connection interrupted — checking whether the request arrived…");

    try {
      await wait(650);
      const activeResponse = await fetch("/api/local-ai/chat", {
        cache: "no-store",
      });

      if (activeResponse.status !== 204) {
        const active = (await activeResponse.json()) as JobResult;
        if (
          activeResponse.ok &&
          active.jobId &&
          (active.status === "queued" || active.status === "running")
        ) {
          if (active.conversationId) {
            setConversationId(active.conversationId);
          }
          window.localStorage.setItem(ACTIVE_JOB_KEY, active.jobId);
          await refreshConversations();
          await pollJob(active.jobId, fallbackMessages);
          return true;
        }
      }

      if (conversationId) {
        const reloaded = await loadConversation(conversationId);
        await refreshConversations();
        const persisted = (reloaded.messages || []).some(
          (message) =>
            message.role === "user" && message.content.trim() === text,
        );

        setStatus("Ready");
        setBusy(false);

        if (persisted) {
          setError(
            "The connection dropped after sending, but your request reached CoOperative. No active execution job is currently confirmed, so it was not submitted a second time.",
          );
          setAttachments([]);
          return true;
        }
      }
    } catch {
      // The original draft is restored below if recovery checks also lose connection.
    }

    setMessages(messages);
    setInput(text);
    setAttachments(currentAttachments);
    setError(
      "Connection interrupted before CoOperative could confirm the request. Your draft was restored so you can retry safely.",
    );
    setStatus("Ready");
    setBusy(false);
    return true;
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || uploadingImages) return;

    if (looksLikeCredentialText(text)) {
      setError(
        "For security, don't paste API keys into normal chat. Ask me to connect the provider and use the secure field I show you.",
      );
      return;
    }

    const currentAttachments = [...attachments];
    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      attachments: currentAttachments,
    };
    const fallbackMessages = [...messages, userMessage];

    setMessages(fallbackMessages);
    setInput("");
    setError("");
    setMeta("");
    setStreamingText("");
    setBusy(true);
    setStatus("Preparing context…");

    try {
      if (
        onboardingState?.status === "in_progress" &&
        onboardingState.conversationId &&
        onboardingState.conversationId === conversationId &&
        onboardingState.phase !== "paused"
      ) {
        setStatus("Saving intake answers…");
        const onboardingResponse = await fetch("/api/local-ai/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "answer",
            conversationId,
            message: text,
          }),
        });
        const onboarding = (await onboardingResponse.json()) as OnboardingResult;

        if (!onboardingResponse.ok || !onboarding.state) {
          throw new Error(
            onboarding.detail ||
              onboarding.error ||
              "Could not save get-to-know-you answers.",
          );
        }

        setOnboardingState(onboarding.state);
        if (onboarding.state.businessId) {
          setSelectedBusinessId(onboarding.state.businessId);
          window.localStorage.setItem(
            ACTIVE_BUSINESS_KEY,
            onboarding.state.businessId,
          );
          await refreshBusinesses();
        }
        if (onboarding.handled !== false) {
          await loadConversation(conversationId);
          await refreshConversations();
          setAttachments([]);
          setMeta("");
          setStatus("Ready");
          setBusy(false);
          return;
        }
      }

      setStatus("Selecting an execution path…");
      const queuedResponse = await fetch("/api/local-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          businessId: selectedBusinessId || undefined,
          message: text,
          attachmentIds: currentAttachments.map((attachment) => attachment.id),
          profile,
          maxTokens: profile === "quality" ? 1200 : 768,
          temperature: 0.2,
          nodeRouting,
          requiredNodeId: nodeRouting === "require-node" ? requiredNodeId : undefined,
          modelMixer: {
            preset: modelMixer.preset,
            maxSpendUsd: modelMixer.maxSpendUsd,
            agents: modelMixer.agents,
          },
        }),
      });

      const queued = (await queuedResponse.json()) as JobResult;
      if (!queuedResponse.ok) {
        throw new Error(queued.detail || queued.error || "Could not execute CoOperative request.");
      }

      if (
        typeof queued.modelMixerUpdate?.maxSpendUsd === "number" &&
        Number.isFinite(queued.modelMixerUpdate.maxSpendUsd)
      ) {
        setModelMixer((current) => ({
          ...current,
          preset: "custom",
          maxSpendUsd: Math.max(0, queued.modelMixerUpdate!.maxSpendUsd!),
        }));
      }

      setAttachments([]);
      if (queued.conversationId) {
        setConversationId(queued.conversationId);
      }
      if (queued.conversationTitle) {
        setConversationTitle(queued.conversationTitle);
      }
      if (queued.businessId) {
        setSelectedBusinessId(queued.businessId);
        window.localStorage.setItem(ACTIVE_BUSINESS_KEY, queued.businessId);
      }

      if (
        queued.execution === "code" &&
        queued.status === "completed" &&
        queued.conversationId
      ) {
        await loadConversation(queued.conversationId);
        await refreshConversations();
        setMeta(resultMeta(queued));
        setStatus("Ready");
        setBusy(false);
        return;
      }

      if (!queued.jobId) {
        throw new Error(queued.detail || queued.error || "Could not queue local AI job.");
      }

      await refreshConversations();
      window.localStorage.setItem(ACTIVE_JOB_KEY, queued.jobId);
      await pollJob(queued.jobId, fallbackMessages);
    } catch (err) {
      if (
        await recoverInterruptedSend(
          err,
          text,
          currentAttachments,
          fallbackMessages,
        )
      ) {
        return;
      }

      setError(err instanceof Error ? err.message : "Local AI request failed.");
      setStatus("Ready");
      setBusy(false);
      setAttachments(currentAttachments);
    }
  }

  useEffect(() => {
    if (chatMinimized) return;

    const frame = window.requestAnimationFrame(() => {
      const container = messageScrollRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [busy, chatMinimized, conversationId, messages, streamingText]);

  const activeBusiness =
    businesses.find((item) => item.id === selectedBusinessId) || null;

  const formatMoney = (cents?: number | null) =>
    typeof cents === "number"
      ? `${(cents / 100).toFixed(0)}/mo`
      : "Unknown";

  return (
    <section className="local-ai-layout">
      <div className="local-ai-contextbar card">
        <div className="field">
          <label>Active business / project context</label>
          <select
            value={selectedBusinessId}
            onChange={(event) => {
              const id = event.target.value;
              setSelectedBusinessId(id);
              if (id) {
                window.localStorage.setItem(ACTIVE_BUSINESS_KEY, id);
              } else {
                window.localStorage.removeItem(ACTIVE_BUSINESS_KEY);
              }
            }}
            disabled={busy || businesses.length === 0}
          >
            <option value="">
              {businesses.length === 0
                ? "Personal / no business profile yet"
                : "Personal / no business"}
            </option>
            {businesses.map((business) => (
              <option value={business.id} key={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </div>

        <label className="field">
          <span>Web access</span>
          <select
            value={webAccessMode}
            disabled={busy}
            onChange={(event) => {
              const mode = event.target.value as WebAccessMode;
              setError("");
              void updateWebAccessMode(mode).catch((err) => {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Could not update Web access mode.",
                );
                void refreshProfileSettings();
              });
            }}
          >
            <option value="off">Off</option>
            <option value="auto">Auto when current info is needed</option>
            <option value="always">Always</option>
          </select>
          <small>
            {webAccessMode === "off"
              ? "No external web access."
              : webAccessMode === "auto"
                ? "Code decides when current external information is needed."
                : "Eligible turns may use public web access; URL safety rules still apply."}
          </small>
        </label>

        {activeBusiness ? (
          <div className="local-ai-context-metrics">
            <span>
              <small>Known services</small>
              <strong>{formatMoney(activeBusiness.monthlyConnectedServiceCostCents)}</strong>
            </span>
            <span>
              <small>Hard budget</small>
              <strong>{formatMoney(activeBusiness.monthlyTechnologyBudgetCents)}</strong>
            </span>
            <span>
              <small>CoOperative ceiling</small>
              <strong>{formatMoney(activeBusiness.maxCooperativeManagedSpendCents)}</strong>
            </span>
            <span>
              <small>Target savings</small>
              <strong>
                {typeof activeBusiness.targetSavingsPercent === "number"
                  ? `${activeBusiness.targetSavingsPercent}%`
                  : "Unknown"}
              </strong>
            </span>
            <span>
              <small>Connections</small>
              <strong>
                {activeBusiness.connectedServicesCount} services · {activeBusiness.connectedAiCount} AI
              </strong>
            </span>
            <span>
              <small>Funded AI balance</small>
              <strong>
                {aiBalance ? "$" + aiBalance.availableUsd.toFixed(4) : "$0.0000"}
              </strong>
              <a className="local-ai-balance-link" href="/balance">Add / review</a>
            </span>
          </div>
        ) : (
          <p className="local-ai-context-empty">
            Run a <a href="/intake">Mission Briefing</a> to create a business profile,
            budget guardrails, and economic context for chat.
          </p>
        )}
      </div>

      <div className="local-ai-threadbar card">
        <label className="field local-ai-thread-select">
          <span>Conversation</span>
          <select
            value={conversationId || ""}
            onChange={(event) => {
              const id = event.target.value;
              if (!id) {
                void newChat();
              } else {
                void switchConversation(id);
              }
            }}
            disabled={busy || uploadingImages}
          >
            <option value="">New chat</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
        </label>
        <div className="local-ai-thread-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void newChat()}
            disabled={busy || uploadingImages}
          >
            New chat
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => void deleteConversation()}
            disabled={busy || !conversationId || uploadingImages}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="local-ai-toolbar card">
        <div>
          <strong>{conversationTitle}</strong>
          <p>Ask CoOperative what you need. Routing and model choice stay in the background.</p>
        </div>
        <div className="local-ai-toolbar-actions">
          <div className="local-ai-status">
            <span className={busy ? "status-dot active" : "status-dot"} />
            {executionStep(status, undefined, Boolean(streamingText))}
          </div>
          <ModelMixerTrigger
            active={modelMixerOpen}
            onClick={() => setModelMixerOpen((current) => !current)}
          />
        </div>
        <details className="local-ai-execution-details">
          <summary>Execution details</summary>
          <div className="local-ai-execution-panel">
            <label className="field">
              <span>Local model preference</span>
              <select
                value={profile}
                onChange={(event) => setProfile(event.target.value as Profile)}
                disabled={busy}
              >
                <option value="fast">Fast local model</option>
                <option value="quality">Higher-quality local model</option>
              </select>
            </label>
            <label className="field">
              <span>Owned-node routing</span>
              <select
                value={nodeRouting}
                onChange={(event) => setNodeRouting(event.target.value as NodeRouting)}
                disabled={busy}
              >
                <option value="prefer-owned">Prefer owned nodes</option>
                <option value="default">Normal local queue</option>
                <option value="require-node">Require this node</option>
              </select>
            </label>
            {nodeRouting === "require-node" ? (
              <label className="field">
                <span>Required Unison node</span>
                <select
                  value={requiredNodeId}
                  onChange={(event) => setRequiredNodeId(event.target.value)}
                  disabled={busy || !ownedNodes.some((node) => node.availableForText)}
                >
                  {ownedNodes.filter((node) => node.availableForText).length === 0 ? (
                    <option value="">No owned text node online</option>
                  ) : null}
                  {ownedNodes
                    .filter((node) => node.availableForText)
                    .map((node) => (
                      <option value={node.id} key={node.id}>
                        {node.displayName} · {node.state}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <small>
              Prefer owned nodes gives your fresh text-capable Unison nodes first claim for 15 seconds.
              Require this node prevents another worker from taking the job.
            </small>
            <small>
              Owned/local execution stays first. Platform-paid high-quality AI is eligible only when
              this profile has a funded AI balance and the estimated request cost fits inside it.
            </small>
            {meta ? <small>{meta}</small> : null}
          </div>
        </details>
      </div>

      {!chatMinimized ? (
        <div className="local-ai-chat local-ai-chat-dock card" aria-label="CoOperative AI chat">
          <div className="local-ai-chat-dock-head">
            <div className="local-ai-chat-dock-title">
              <strong>CoOperative AI</strong>
              <span>
                <i className={busy ? "status-dot active" : "status-dot"} />
                {conversationTitle} · {executionStep(status, undefined, Boolean(streamingText))}
              </span>
            </div>
            <div className="local-ai-chat-dock-actions">
              <button
                className="local-ai-dock-action"
                type="button"
                onClick={() => setModelMixerOpen(true)}
              >
                Settings
              </button>
              <button
                className="local-ai-dock-action icon"
                type="button"
                onClick={() => {
                  setChatMinimized(true);
                  setModelMixerOpen(false);
                }}
                aria-label="Minimize chat"
                title="Minimize chat"
              >
                —
              </button>
            </div>
          </div>

          <div className="local-ai-messages" ref={messageScrollRef}>
          {messages.length === 0 ? (
            <div className="local-ai-empty">
              <strong>CoOperative</strong>
              <p>
                Ask anything about the active business or project, or attach an image.
                CoOperative will choose the appropriate execution path behind the scenes.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
                key={message.id || `${message.role}-${index}`}
              >
                <div className="chat-bubble-head">
                  <span>{message.role === "user" ? "You" : "CoOperative AI"}</span>
                  {message.content ? (
                    <button
                      className="message-action"
                      type="button"
                      onClick={() => void copyMessage(message.content)}
                      aria-label="Copy message"
                    >
                      Copy
                    </button>
                  ) : null}
                </div>
                {message.attachments && message.attachments.length > 0 ? (
                  <div className="chat-attachments">
                    {message.attachments.map((attachment) => (
                      <img
                        key={attachment.id}
                        src={attachment.previewUrl}
                        alt={attachment.fileName}
                        loading="lazy"
                      />
                    ))}
                  </div>
                ) : null}
                {message.content ? (() => {
                  const oauthConnect = oauthServiceConnectDirective(message.content);
                  if (oauthConnect) {
                    return (
                      <>
                        {oauthConnect.text ? <div>{oauthConnect.text}</div> : null}
                        <OAuthServiceConnectCard
                          providerKey={oauthConnect.providerKey}
                          conversationId={conversationId}
                          onConnected={async () => {
                            setServiceConnectionRevision((current) => current + 1);
                            await refreshBusinesses();
                            if (conversationId) {
                              await loadConversation(conversationId);
                              await refreshConversations();
                            }
                          }}
                        />
                      </>
                    );
                  }

                  const fundingRequired = fundingRequiredDirective(message.content);
                  if (fundingRequired) {
                    return (
                      <>
                        {fundingRequired.text ? <div>{fundingRequired.text}</div> : null}
                        <FundingRequiredCard
                          resumeKind={fundingRequired.resumeKind}
                          sourceJobId={fundingRequired.sourceJobId}
                          estimatedCostUsd={fundingRequired.estimatedCostUsd}
                          minimumBalanceUsd={fundingRequired.minimumBalanceUsd}
                          availableBalanceUsd={fundingRequired.availableBalanceUsd}
                          topUpOptionId={fundingRequired.topUpOptionId}
                          topUpUsd={fundingRequired.topUpUsd}
                          onResumed={async (payload) => {
                            if (payload.conversationId) {
                              await loadConversation(payload.conversationId);
                            } else if (conversationId) {
                              await loadConversation(conversationId);
                            }
                            await Promise.all([
                              refreshConversations(),
                              refreshBusinesses(),
                            ]);
                            if (
                              fundingRequired.resumeKind === "media" &&
                              payload.jobId &&
                              (payload.status === "running" ||
                                payload.status === "queued")
                            ) {
                              window.localStorage.setItem(
                                ACTIVE_JOB_KEY,
                                payload.jobId,
                              );
                              await pollJob(payload.jobId, []);
                            } else {
                              setMeta(resultMeta(payload));
                              setStatus("Ready");
                            }
                          }}
                        />
                      </>
                    );
                  }

                  const sandboxCodeTask = sandboxCodeTaskDirective(message.content);
                  if (sandboxCodeTask) {
                    return (
                      <>
                        {sandboxCodeTask.text ? <div>{sandboxCodeTask.text}</div> : null}
                        <SandboxCodeTaskCard taskId={sandboxCodeTask.taskId} />
                      </>
                    );
                  }

                  const connectorBuild = connectorBuildDirective(message.content);
                  if (connectorBuild) {
                    return (
                      <>
                        {connectorBuild.text ? <div>{connectorBuild.text}</div> : null}
                        <ConnectorBuildStatusCard taskId={connectorBuild.taskId} />
                      </>
                    );
                  }

                  const recovery = recoveryStatusDirective(message.content);
                  if (recovery) {
                    return (
                      <>
                        {recovery.text ? <div>{recovery.text}</div> : null}
                        <RecoveryStatusCard
                          incidentId={recovery.incidentId}
                          onSuggestion={(value) => setInput(value)}
                          onCapChange={(value) =>
                            setModelMixer((current) => ({
                              ...current,
                              preset: "custom",
                              maxSpendUsd: value,
                            }))
                          }
                          onConversationChanged={async () => {
                            if (conversationId) {
                              await loadConversation(conversationId);
                              await refreshConversations();
                            }
                          }}
                        />
                      </>
                    );
                  }

                  const mediaRecommendations =
                    mediaRecommendationsDirective(message.content);
                  if (mediaRecommendations) {
                    return (
                      <>
                        {mediaRecommendations.text ? (
                          <div>{mediaRecommendations.text}</div>
                        ) : null}
                        <MediaRecommendationChoices
                          options={mediaRecommendations.options}
                          currentCapUsd={mediaRecommendations.currentCapUsd}
                          onChoose={(option) => {
                            const mediaLevel =
                              option.tier === "high-end"
                                ? 4
                                : option.tier === "balanced"
                                  ? 2
                                  : 1;
                            setModelMixer((current) => ({
                              ...current,
                              preset: "custom",
                              maxSpendUsd: option.capUsd,
                              agents: {
                                ...current.agents,
                                media: mediaLevel,
                              },
                            }));
                            setInput(
                              `Use the ${option.label} media recommendation exactly as quoted.`,
                            );
                          }}
                        />
                      </>
                    );
                  }

                  const budgetFollowup = budgetFollowupDirective(message.content);
                  if (budgetFollowup) {
                    return (
                      <>
                        {budgetFollowup.text ? <div>{budgetFollowup.text}</div> : null}
                        <BudgetFollowups
                          onSuggestion={(value) => setInput(value)}
                          suggestedCap={budgetFollowup.suggestedCap}
                          onCapChange={(value) =>
                            setModelMixer((current) => ({
                              ...current,
                              preset: "custom",
                              maxSpendUsd: value,
                            }))
                          }
                        />
                      </>
                    );
                  }

                  const serviceConnect = serviceConnectDirective(message.content);
                  if (serviceConnect) {
                    return (
                      <>
                        {serviceConnect.text ? <div>{serviceConnect.text}</div> : null}
                        <SecureServiceConnectCard
                          providerKey={serviceConnect.providerKey}
                          conversationId={conversationId}
                          onConnected={async () => {
                            setServiceConnectionRevision((current) => current + 1);
                            await refreshBusinesses();
                            if (conversationId) {
                              await loadConversation(conversationId);
                              await refreshConversations();
                            }
                          }}
                        />
                      </>
                    );
                  }

                  const media = generatedMedia(message.content);
                  if (!media) return <div>{message.content}</div>;
                  const viewerMedia: FullscreenMedia = {
                    kind: media.kind,
                    url: media.url,
                    jobId: message.jobId || null,
                    label:
                      media.kind === "video"
                        ? "Generated video"
                        : "Generated image",
                  };
                  return (
                    <>
                      {media.text ? <div>{media.text}</div> : null}
                      {media.kind === "image" ? (
                        <button
                          className="generated-media-open"
                          type="button"
                          onClick={() => setFullscreenMedia(viewerMedia)}
                          aria-label="Open generated image full screen"
                        >
                          <img
                            className="generated-media-image"
                            src={media.url}
                            alt="Generated by CoOperative"
                            loading="lazy"
                          />
                        </button>
                      ) : (
                        <button
                          className="generated-media-open"
                          type="button"
                          onClick={() => setFullscreenMedia(viewerMedia)}
                          aria-label="Open generated video full screen"
                        >
                          <video
                            className="generated-media-video"
                            src={media.url}
                            muted
                            playsInline
                            preload="metadata"
                          />
                          <span className="generated-media-play">▶</span>
                        </button>
                      )}
                    </>
                  );
                })() : null}
              </div>
            ))
          )}

          {busy ? (
            <div className="chat-bubble assistant pending">
              <div className="chat-bubble-head">
                <span>CoOperative</span>
              </div>
              <div className="execution-trace">
                <span className="execution-trace-dot" />
                <span>{executionStep(status, undefined, Boolean(streamingText))}</span>
              </div>
              {streamingText ? (
                <div className="streaming-response">{streamingText}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="local-ai-composer">
          {attachments.length > 0 ? (
            <div className="pending-attachments">
              {attachments.map((attachment, index) => (
                <div className="pending-attachment" key={attachment.id}>
                  <img src={attachment.previewUrl} alt={attachment.fileName} />
                  <span className="pending-attachment-reference">
                    Reference {index + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeAttachment(attachment)}
                    disabled={busy}
                    aria-label={`Remove ${attachment.fileName}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              attachments.length > 0
                ? "Ask about the attached image…"
                : "Ask CoOperative AI…"
            }
            disabled={busy}
            maxLength={16000}
          />

          <input
            id="cooperative-reference-image-input"
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
            aria-label="Choose reference images"
            multiple
            onChange={(event) => void uploadImages(event)}
            disabled={busy || uploadingImages || attachments.length >= MAX_ATTACHMENTS}
          />

          {attachmentMenuOpen ? (
            <div className="attachment-source-menu">
              <button
                type="button"
                onClick={openLocalReferencePicker}
                disabled={busy || uploadingImages || attachments.length >= MAX_ATTACHMENTS}
              >
                Photos / Files
              </button>
              <button
                type="button"
                onClick={() => {
                  setAttachmentMenuOpen(false);
                  setCloudPickerOpen(true);
                }}
                disabled={busy || attachments.length >= MAX_ATTACHMENTS}
              >
                CoOp Cloud
              </button>
            </div>
          ) : null}

          <div className="local-ai-actions">
            <button
              className="primary"
              type="button"
              onClick={() => void send()}
              disabled={
                busy ||
                uploadingImages ||
                (!input.trim() && attachments.length === 0)
              }
            >
              {busy ? "Working…" : "Send"}
            </button>
            {busy ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void cancelJob()}
                disabled={!activeJobId}
              >
                Stop
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => setAttachmentMenuOpen((current) => !current)}
              disabled={busy || uploadingImages || attachments.length >= MAX_ATTACHMENTS}
              aria-expanded={attachmentMenuOpen}
            >
              {uploadingImages ? "Uploading…" : "＋ Reference"}
            </button>
            <ModelMixerTrigger
              active={modelMixerOpen}
              onClick={() => setModelMixerOpen((current) => !current)}
            />
            <button
              className="text-button"
              type="button"
              onClick={() => void newChat()}
              disabled={busy || uploadingImages}
            >
              New conversation
            </button>
          </div>
          <small className="local-ai-attachment-note">
            Up to 4 reference images. For image creation/editing, CoOperative passes them to a reference-capable model; for normal chat, they are vision attachments. Large photos are compressed on your device first.
          </small>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {meta ? (
          <details className="local-ai-response-details">
            <summary>Response details</summary>
            <p className="local-ai-meta">{meta}</p>
          </details>
        ) : null}
        </div>
      ) : (
        <button
          className="local-ai-chat-launcher"
          type="button"
          onClick={() => setChatMinimized(false)}
          aria-label="Open CoOperative AI chat"
          title="Open CoOperative AI chat"
        >
          <span className={busy ? "status-dot active" : "status-dot"} />
          <strong>AI</strong>
        </button>
      )}

      <MediaFullscreenViewer
        media={fullscreenMedia}
        onClose={() => setFullscreenMedia(null)}
      />

      <MediaCloudPicker
        open={cloudPickerOpen}
        disabled={busy || attachments.length >= MAX_ATTACHMENTS}
        onClose={() => setCloudPickerOpen(false)}
        onAttached={(attachment) => {
          setAttachments((current) =>
            [...current, attachment].slice(0, MAX_ATTACHMENTS),
          );
          setError("");
        }}
      />

      <ModelMixer
        open={modelMixerOpen}
        settings={modelMixer}
        paidAiEligible={Boolean(aiBalance?.paidAiEligible)}
        refreshKey={serviceConnectionRevision}
        onChange={setModelMixer}
        onClose={() => setModelMixerOpen(false)}
      />
    </section>
  );
}
