import { Sandbox } from "@vercel/sandbox";
import { getVercelOidcToken } from "@vercel/oidc";

import { createAdminClient } from "@/lib/supabase/admin";

const HERMES_BASE_NAME = "cooperative-hermes-runtime-v2026-9-14";
const MODEL = "alibaba/qwen3.5-flash";
const PROVIDER = "ai-gateway";
const MIN_HERMES_CONTEXT_WINDOW = 64_000;

interface HermesModelSmokeInput {
  taskId: string;
  organizationId: string;
  maxSpendMicrounits: number;
  compatibilityReview: {
    ruleIds: string[];
    brief: string;
  };
}

interface HermesUsageReport {
  estimated_cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  api_calls?: number;
  model?: string;
  provider?: string;
  completed?: boolean;
  failed?: boolean;
  total_including_auxiliary?: {
    estimated_cost_usd?: number;
    total_tokens?: number;
    api_calls?: number;
  };
}

interface ModelSmokeEvidence {
  sandboxName: string;
  model: string;
  provider: string;
  output: string;
  stderrTail: string;
  durationMs: number;
  usage: HermesUsageReport;
  costMicrounits: number;
}

function tail(value: string, limit = 2500) {
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

function usageCostMicrounits(usage: HermesUsageReport): number {
  const usd =
    usage.total_including_auxiliary?.estimated_cost_usd ??
    usage.estimated_cost_usd;

  if (typeof usd !== "number" || !Number.isFinite(usd) || usd < 0) {
    throw new Error("Hermes usage report did not provide a valid cost estimate.");
  }

  return Math.ceil(usd * 1_000_000);
}

async function recordProgress(
  input: HermesModelSmokeInput,
  stage:
    | "authenticating_gateway"
    | "starting_hermes"
    | "reasoning"
    | "verifying"
    | "completed"
    | "failed",
  detail: Record<string, unknown> = {},
) {
  "use step";

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: task, error: taskError } = await admin
    .from("operative_tasks")
    .select("result")
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .single();

  if (taskError) throw taskError;

  const current =
    task.result && typeof task.result === "object" && !Array.isArray(task.result)
      ? (task.result as Record<string, unknown>)
      : {};

  const result = {
    ...current,
    executionMode: "workflow",
    progress: {
      stage,
      at: now,
      ...detail,
    },
  };

  const { error: updateError } = await admin
    .from("operative_tasks")
    .update({ result, updated_at: now })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId);

  if (updateError) throw updateError;

  const { error: eventError } = await admin.from("task_events").insert({
    task_id: input.taskId,
    organization_id: input.organizationId,
    event_type: "note",
    actor: "system",
    detail: {
      type: "workflow_progress",
      stage,
      ...detail,
    },
  });

  if (eventError) throw eventError;
}

async function runModelSmoke(
  input: HermesModelSmokeInput,
): Promise<ModelSmokeEvidence> {
  "use step";

  if (
    !input.compatibilityReview ||
    input.compatibilityReview.ruleIds.length === 0 ||
    !input.compatibilityReview.brief.trim()
  ) {
    throw new Error(
      "Compatibility knowledge review is required before Hermes model execution.",
    );
  }

  const oidcToken = (await getVercelOidcToken())?.trim();
  if (!oidcToken) {
    throw new Error("Vercel OIDC helper did not return a token in this Workflow step.");
  }

  const startedAt = Date.now();

  const catalogResponse = await fetch("https://ai-gateway.vercel.sh/v1/models", {
    cache: "no-store",
  });
  if (!catalogResponse.ok) {
    throw new Error("Unable to verify AI Gateway model metadata before Hermes execution.");
  }

  const catalog = (await catalogResponse.json()) as {
    data?: Array<{ id?: string; context_window?: number }>;
  };
  const selectedModel = catalog.data?.find((model) => model.id === MODEL);
  if (!selectedModel) {
    throw new Error("Selected AI Gateway model is not available: " + MODEL);
  }
  if (
    typeof selectedModel.context_window !== "number" ||
    selectedModel.context_window < MIN_HERMES_CONTEXT_WINDOW
  ) {
    throw new Error(
      "Selected model " +
        MODEL +
        " reports a context window below Hermes minimum " +
        MIN_HERMES_CONTEXT_WINDOW +
        ".",
    );
  }

  // Fail fast if the prepared runtime disappeared instead of silently paying
  // for another cold installation in the model-backed smoke test.
  await Sandbox.get({ name: HERMES_BASE_NAME, resume: false });

  const sandbox = await Sandbox.fork({
    sourceSandbox: HERMES_BASE_NAME,
    persistent: false,
    timeout: 2 * 60 * 1000,
    env: {
      // Short-lived deployment identity only. No long-lived provider key is
      // stored in CoOperative or baked into the prepared Hermes snapshot.
      AI_GATEWAY_API_KEY: oidcToken,
    },
  });

  const prompt = [
    "You are running a governed Cloud Hermes model smoke test.",
    "The following version-aware compatibility knowledge was reviewed before execution:",
    input.compatibilityReview.brief,
    "Apply those known-good patterns and do not retry any listed avoid-pattern.",
    "Do not call tools. Do not modify files. Do not access the network beyond the model request.",
    "Return one compact JSON object only, with these keys:",
    'runtime: "hermes-cloud-operative",',
    'provider: "ai-gateway",',
    'answer: the integer result of 17 * 23,',
    'whyDeterministic: a sentence of 12 words or fewer explaining why deterministic code is normally better for arithmetic.',
  ].join("\n");

  try {
    await sandbox.writeFiles([
      {
        path: "/tmp/cooperative-model-smoke.md",
        content: Buffer.from(prompt, "utf8"),
      },
    ]);

    // --usage-file is only honored by Hermes' top-level -z/--oneshot path.
    // Keep the fixed smoke prompt as one safely quoted argv value so Hermes
    // performs exactly one scripted request and always emits usage accounting.
    const hermesArgs = [
      "--usage-file",
      "/tmp/hermes-usage.json",
      "--provider",
      "ai-gateway",
      "--model",
      MODEL,
      "--reasoning",
      "none",
      "--safe-mode",
      "--ignore-user-config",
      "--ignore-rules",
      "-z",
      prompt,
    ];

    const quotedArgs = hermesArgs
      .map((value) => "'" + value.replaceAll("'", "'\\''") + "'")
      .join(" ");

    const command = [
      'set -e',
      'HERMES_BIN="$HOME/.local/bin/hermes"',
      'if [ ! -x "$HERMES_BIN" ]; then HERMES_BIN=/usr/local/bin/hermes; fi',
      'test -x "$HERMES_BIN"',
      'exec timeout 75s "$HERMES_BIN" ' + quotedArgs,
    ].join("; ");

    const result = await sandbox.runCommand("bash", ["-lc", command]);

    const stdout = (await result.stdout()).trim();
    const stderr = (await result.stderr()).trim();

    const usageResult = await sandbox.runCommand("bash", [
      "-lc",
      "test -s /tmp/hermes-usage.json && cat /tmp/hermes-usage.json || true",
    ]);
    const usageText = (await usageResult.stdout()).trim();

    if (!usageText) {
      throw new Error(
        "Hermes model call did not produce the required usage report. " +
          tail(stderr || stdout),
      );
    }

    let usage: HermesUsageReport;
    try {
      usage = JSON.parse(usageText) as HermesUsageReport;
    } catch {
      throw new Error("Hermes usage report was not valid JSON.");
    }

    const costMicrounits = usageCostMicrounits(usage);

    if (costMicrounits > input.maxSpendMicrounits) {
      throw new Error(
        `Cost Governor violation: Hermes reported ${costMicrounits} microunits against a ${input.maxSpendMicrounits} microunit cap.`,
      );
    }

    if (result.exitCode !== 0) {
      throw new Error(
        "Hermes model-backed smoke command failed: " + tail(stderr || stdout),
      );
    }

    if (!stdout.includes("391")) {
      throw new Error(
        "Hermes returned a model response, but the fixed arithmetic verification did not pass.",
      );
    }

    return {
      sandboxName: sandbox.name,
      model: usage.model || MODEL,
      provider: usage.provider || PROVIDER,
      output: tail(stdout, 4000),
      stderrTail: tail(stderr),
      durationMs: Date.now() - startedAt,
      usage,
      costMicrounits,
    };
  } finally {
    await sandbox.stop();
  }
}

async function finalizeSuccess(
  input: HermesModelSmokeInput,
  evidence: ModelSmokeEvidence,
) {
  "use step";

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const result = {
    executionMode: "workflow",
    workflow: "hermes-model-smoke",
    progress: {
      stage: "completed",
      at: now,
    },
    evidence,
  };

  const { error: verifyingError } = await admin
    .from("operative_tasks")
    .update({
      status: "verifying",
      result,
      actual_spend_microunits: evidence.costMicrounits,
      updated_at: now,
    })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .eq("status", "executing");

  if (verifyingError) throw verifyingError;

  await admin.from("task_events").insert({
    task_id: input.taskId,
    organization_id: input.organizationId,
    event_type: "status_changed",
    from_status: "executing",
    to_status: "verifying",
    actor: "system",
    detail: {
      verification: "Hermes completed one bounded model-backed turn through Vercel AI Gateway.",
      model: evidence.model,
      provider: evidence.provider,
      actualSpendMicrounits: evidence.costMicrounits,
    },
  });

  const { error: completeError } = await admin
    .from("operative_tasks")
    .update({
      status: "completed",
      result,
      actual_spend_microunits: evidence.costMicrounits,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .eq("status", "verifying");

  if (completeError) throw completeError;

  await admin.from("task_events").insert({
    task_id: input.taskId,
    organization_id: input.organizationId,
    event_type: "status_changed",
    from_status: "verifying",
    to_status: "completed",
    actor: "system",
    detail: {
      verification: "First governed model-backed Cloud Hermes smoke test completed.",
      model: evidence.model,
      provider: evidence.provider,
      actualSpendMicrounits: evidence.costMicrounits,
    },
  });

  await admin.from("cost_ledger_entries").insert([
    {
      organization_id: input.organizationId,
      task_id: input.taskId,
      executor: "hermes-cloud-operative",
      cost_category: "ai-tokens",
      amount_microunits: evidence.costMicrounits,
      currency: "USD",
      is_marginal_cost: true,
      notes:
        `Hermes usage-file estimate via Vercel AI Gateway; model ${evidence.model}; provider ${evidence.provider}.`,
    },
    {
      organization_id: input.organizationId,
      task_id: input.taskId,
      executor: "vercel-sandbox",
      cost_category: "sandbox-compute",
      amount_microunits: 0,
      currency: "USD",
      is_marginal_cost: true,
      notes:
        "Prepared-runtime fork used for the model smoke test; allocated Vercel platform usage remains separate.",
    },
  ]);
}

async function finalizeFailure(
  input: HermesModelSmokeInput,
  message: string,
) {
  "use step";

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: task } = await admin
    .from("operative_tasks")
    .select("result")
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const current =
    task?.result && typeof task.result === "object" && !Array.isArray(task.result)
      ? (task.result as Record<string, unknown>)
      : {};

  await admin
    .from("operative_tasks")
    .update({
      status: "failed",
      error: message,
      result: {
        ...current,
        executionMode: "workflow",
        progress: {
          stage: "failed",
          at: now,
          message,
        },
      },
      updated_at: now,
    })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId);

  await admin.from("task_events").insert({
    task_id: input.taskId,
    organization_id: input.organizationId,
    event_type: "error",
    actor: "system",
    detail: {
      stage: "workflow_hermes_model_smoke",
      message,
    },
  });
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();

  if (error && typeof error === "object") {
    const record = error as { name?: unknown; message?: unknown; cause?: unknown };
    const name = typeof record.name === "string" && record.name ? record.name + ": " : "";
    if (typeof record.message === "string" && record.message.trim()) {
      return name + record.message.trim();
    }
    if (record.cause instanceof Error && record.cause.message) {
      return name + record.cause.message;
    }
  }

  return "Cloud Hermes model smoke test failed.";
}

export async function hermesModelSmokeWorkflow(
  input: HermesModelSmokeInput,
): Promise<{ ok: true; evidence: ModelSmokeEvidence }> {
  "use workflow";

  try {
    await recordProgress(input, "authenticating_gateway", {
      authMode: "vercel-oidc",
      persistentProviderSecret: false,
    });

    await recordProgress(input, "starting_hermes", {
      preparedRuntime: HERMES_BASE_NAME,
      model: MODEL,
      provider: PROVIDER,
    });

    await recordProgress(input, "reasoning", {
      maxTurns: 1,
      maxSpendMicrounits: input.maxSpendMicrounits,
      compatibilityRuleIds: input.compatibilityReview.ruleIds,
    });

    const evidence = await runModelSmoke(input);

    await recordProgress(input, "verifying", {
      model: evidence.model,
      provider: evidence.provider,
      actualSpendMicrounits: evidence.costMicrounits,
    });

    await finalizeSuccess(input, evidence);
    return { ok: true, evidence };
  } catch (error) {
    const message = readableError(error);
    await finalizeFailure(input, message);
    throw error;
  }
}
