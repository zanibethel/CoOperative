export type HermesReasoningClass = "standard" | "advanced";

export interface HermesModelRoute {
  reasoningClass: HermesReasoningClass;
  candidates: string[];
  reason: string;
}

const DEFAULT_STANDARD_MODELS = [
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol",
];

const DEFAULT_ADVANCED_MODELS = [
  "openai/gpt-5.6-sol",
];

function parseModelList(value: string | undefined, fallback: string[]): string[] {
  const models = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const unique = [...new Set(models.length > 0 ? models : fallback)];

  if (unique.some((model) => !/^[a-z0-9._/-]+$/i.test(model))) {
    throw new Error("Configured Hermes model IDs contain unsupported characters.");
  }

  return unique;
}

/**
 * CoOperative chooses the ordered model candidates before Hermes starts.
 * Environment configuration can change the approved ladder without a code
 * deploy, while the defaults keep the bootstrap deterministic.
 */
export function routeHermesModels(
  reasoningClass: HermesReasoningClass,
): HermesModelRoute {
  if (reasoningClass === "advanced") {
    return {
      reasoningClass,
      candidates: parseModelList(
        process.env.COOPERATIVE_HERMES_ADVANCED_MODELS,
        DEFAULT_ADVANCED_MODELS,
      ),
      reason:
        "Advanced task: preserve the stronger quality floor; do not silently downgrade to a standard-only model.",
    };
  }

  return {
    reasoningClass,
    candidates: parseModelList(
      process.env.COOPERATIVE_HERMES_STANDARD_MODELS,
      DEFAULT_STANDARD_MODELS,
    ),
    reason:
      "Standard task: prefer the lowest-cost approved model and fall back only when that model is unavailable.",
  };
}

export function isHermesModelAvailabilityFailure(value: string): boolean {
  const message = value.toLowerCase();
  return (
    message.includes("http 503") ||
    message.includes("status 503") ||
    message.includes("temporarily unavailable") ||
    message.includes("no price is registered") ||
    message.includes("no price registered") ||
    message.includes("model unavailable")
  );
}
