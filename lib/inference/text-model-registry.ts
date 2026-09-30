import type { TextInferenceMessage } from "@/lib/inference/contracts";

export type LocalTextProfile = "fast" | "quality";
export type TextRouteMode = "auto" | "local-fast" | "local-quality";
export type TextTaskClass =
  | "general"
  | "summary"
  | "planning"
  | "coding"
  | "debugging"
  | "reasoning"
  | "long-context";

export const TEXT_MODEL_REGISTRY_REVISION = "2026-09-30.1";

export const TEXT_MODEL_REGISTRY = {
  fast: {
    profile: "fast",
    runtime: "mlx",
    defaultModelId: "mlx-community/Qwen3-4B-Instruct-2507-4bit",
    overrideEnv: "TEXT_FAST_MODEL_ID",
    purpose: "Interactive local chat, summaries, routine planning, and first-pass coding.",
  },
  quality: {
    profile: "quality",
    runtime: "mlx",
    defaultModelId: "mlx-community/Qwen2.5-7B-Instruct-4bit",
    overrideEnv: "TEXT_QUALITY_MODEL_ID",
    purpose: "Harder coding, debugging, reasoning, and longer-context work.",
  },
} as const;

export type TextRouteDecision = {
  profile: LocalTextProfile;
  reason: string;
  registryRevision: string;
  paidFallbackAllowed: boolean;
  humanApprovalRequired: boolean;
};

type RouteInput = {
  mode: TextRouteMode;
  taskClass: TextTaskClass;
  messages: TextInferenceMessage[];
  maxTokens: number;
  allowPaidFallback: boolean;
  humanApprovalRequired: boolean;
};

const QUALITY_TASKS = new Set<TextTaskClass>([
  "coding",
  "debugging",
  "reasoning",
  "long-context",
]);

function estimatedInputCharacters(messages: TextInferenceMessage[]) {
  return messages.reduce((total, message) => total + message.content.length, 0);
}

export function routeTextRequest(input: RouteInput): TextRouteDecision {
  if (input.mode === "local-fast") {
    return {
      profile: "fast",
      reason: "Manual Local Fast selection.",
      registryRevision: TEXT_MODEL_REGISTRY_REVISION,
      paidFallbackAllowed: false,
      humanApprovalRequired: input.humanApprovalRequired,
    };
  }

  if (input.mode === "local-quality") {
    return {
      profile: "quality",
      reason: "Manual Local Quality selection.",
      registryRevision: TEXT_MODEL_REGISTRY_REVISION,
      paidFallbackAllowed: false,
      humanApprovalRequired: input.humanApprovalRequired,
    };
  }

  const inputCharacters = estimatedInputCharacters(input.messages);
  const useQuality =
    QUALITY_TASKS.has(input.taskClass) ||
    input.maxTokens > 1024 ||
    inputCharacters > 12000;

  return {
    profile: useQuality ? "quality" : "fast",
    reason: useQuality
      ? "Auto route selected Local Quality for a harder or larger request."
      : "Auto route selected Local Fast for a routine request.",
    registryRevision: TEXT_MODEL_REGISTRY_REVISION,
    paidFallbackAllowed: input.allowPaidFallback,
    humanApprovalRequired: input.humanApprovalRequired,
  };
}

export function publicTextModelRegistry() {
  return {
    revision: TEXT_MODEL_REGISTRY_REVISION,
    profiles: Object.values(TEXT_MODEL_REGISTRY),
    policy: {
      localFirst: true,
      manualLocalFallback: "never-paid",
      automaticPaidFallback: false,
      note:
        "allowPaidFallback records permission for future escalation logic; this router does not execute a hosted fallback.",
    },
  };
}
