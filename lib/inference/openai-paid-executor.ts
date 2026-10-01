import type { TextInferenceMessage } from "@/lib/inference/contracts";
import type {
  EscalationEvidence,
  PaidExecutorCandidate,
} from "@/lib/inference/escalation-evaluator";

type OpenAiResponsesPayload = {
  id?: string;
  model?: string;
  status?: string;
  error?: { message?: string } | null;
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type PaidTextExecutionResult = {
  text: string;
  provider: "openai";
  model: string;
  responseId?: string;
  promptTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
};

function envNumber(name: string) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function envBool(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function estimatedInputTokens(messages: TextInferenceMessage[]) {
  const characters = messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  return Math.max(1, Math.ceil(characters / 4));
}

function estimateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputUsdPerMillion: number | undefined,
  outputUsdPerMillion: number | undefined,
) {
  if (
    typeof inputUsdPerMillion !== "number" ||
    typeof outputUsdPerMillion !== "number"
  ) {
    return undefined;
  }

  return (
    (inputTokens / 1_000_000) * inputUsdPerMillion +
    (outputTokens / 1_000_000) * outputUsdPerMillion
  );
}

export function configuredOpenAiCandidate(
  evidence: EscalationEvidence,
): PaidExecutorCandidate | null {
  if (!envBool("OPENAI_ESCALATION_ENABLED")) return null;

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_ESCALATION_MODEL_ID;
  if (!apiKey || !model) return null;

  const inputUsdPerMillion = envNumber(
    "OPENAI_ESCALATION_INPUT_USD_PER_MILLION",
  );
  const outputUsdPerMillion = envNumber(
    "OPENAI_ESCALATION_OUTPUT_USD_PER_MILLION",
  );
  const benchmarkSuccessRate = envNumber(
    "OPENAI_ESCALATION_BENCHMARK_SUCCESS_RATE",
  );
  const maxInputCharacters = envNumber(
    "OPENAI_ESCALATION_MAX_INPUT_CHARACTERS",
  );

  const estimatedMarginalCostUsd = estimateCostUsd(
    estimatedInputTokens(evidence.messages),
    evidence.requestedOutputTokens,
    inputUsdPerMillion,
    outputUsdPerMillion,
  );

  return {
    id: "openai-escalation",
    provider: "openai",
    model,
    available: true,
    qualified:
      envBool("OPENAI_ESCALATION_QUALIFIED") &&
      typeof benchmarkSuccessRate === "number",
    businessOwned: envBool("OPENAI_ESCALATION_BUSINESS_OWNED"),
    supportedTaskClasses: [
      "general",
      "summary",
      "planning",
      "coding",
      "debugging",
      "reasoning",
      "long-context",
    ],
    maxInputCharacters:
      typeof maxInputCharacters === "number"
        ? Math.max(1, Math.round(maxInputCharacters))
        : undefined,
    benchmarkSuccessRate:
      typeof benchmarkSuccessRate === "number"
        ? Math.min(1, Math.max(0, benchmarkSuccessRate))
        : undefined,
    estimatedMarginalCostUsd,
  };
}

function collectOutputText(payload: OpenAiResponsesPayload) {
  const parts: string[] = [];

  for (const item of payload.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

export async function executeOpenAiPaidText(
  evidence: EscalationEvidence,
): Promise<PaidTextExecutionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_ESCALATION_MODEL_ID;

  if (!envBool("OPENAI_ESCALATION_ENABLED") || !apiKey || !model) {
    throw new Error("OpenAI escalation executor is not configured.");
  }

  const instructions = evidence.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();

  const input = evidence.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  if (input.length === 0) {
    throw new Error("Paid escalation requires at least one non-system message.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...(instructions ? { instructions } : {}),
        input,
        max_output_tokens: evidence.requestedOutputTokens,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: OpenAiResponsesPayload | null = null;

    try {
      payload = raw ? (JSON.parse(raw) as OpenAiResponsesPayload) : null;
    } catch {
      payload = null;
    }

    if (!response.ok || !payload) {
      const detail =
        payload?.error?.message ||
        raw.slice(0, 800) ||
        `OpenAI Responses API returned HTTP ${response.status}.`;
      throw new Error(detail);
    }

    const text = collectOutputText(payload);
    if (!text) {
      throw new Error("OpenAI Responses API returned no output text.");
    }

    const promptTokens =
      typeof payload.usage?.input_tokens === "number"
        ? Math.max(0, Math.round(payload.usage.input_tokens))
        : undefined;
    const outputTokens =
      typeof payload.usage?.output_tokens === "number"
        ? Math.max(0, Math.round(payload.usage.output_tokens))
        : undefined;

    const estimatedCostUsd =
      typeof promptTokens === "number" && typeof outputTokens === "number"
        ? estimateCostUsd(
            promptTokens,
            outputTokens,
            envNumber("OPENAI_ESCALATION_INPUT_USD_PER_MILLION"),
            envNumber("OPENAI_ESCALATION_OUTPUT_USD_PER_MILLION"),
          )
        : undefined;

    return {
      text,
      provider: "openai",
      model: payload.model || model,
      responseId: payload.id,
      promptTokens,
      outputTokens,
      estimatedCostUsd,
    };
  } finally {
    clearTimeout(timeout);
  }
}
