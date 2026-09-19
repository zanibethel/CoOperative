import { getVercelOidcToken } from "@vercel/oidc";
import { Sandbox } from "@vercel/sandbox";

import {
  resolveModelCost,
  type GatewayPricing,
  type ResolvedModelCost,
} from "@/lib/operative/model-cost";
import { getLinkedProject, type LinkedProjectKey } from "@/lib/operative/project-registry";
import { getCloudPlaybook } from "@/lib/operative/playbook-registry";
import { createAdminClient } from "@/lib/supabase/admin";

const HERMES_BASE_NAME = "cooperative-hermes-runtime-v2026-9-14";
const MODEL = "alibaba/qwen3.5-flash";
const PROVIDER = "ai-gateway";
const MIN_HERMES_CONTEXT_WINDOW = 64_000;
const MAX_PATCH_BYTES = 160_000;

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
const MAX_TURNS = 16;

interface HermesUsageReport {
  estimated_cost_usd?: number;
  cost_source?: string;
  cost_status?: string;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
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

interface LinkedProjectHermesInput {
  taskId: string;
  organizationId: string;
  projectKey: LinkedProjectKey;
  request: string;
  maxSpendMicrounits: number;
  compatibilityReview: {
    ruleIds: string[];
    brief: string;
  };
}

interface VerificationStep {
  cmd: string;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
}

interface LinkedProjectEvidence {
  projectKey: LinkedProjectKey;
  hermesExitCode: number;
  hermesError: string | null;
  repoSlug: string;
  gitRef: string;
  sandboxName: string;
  model: string;
  provider: string;
  output: string;
  patch: string;
  changedFiles: string[];
  verificationSteps: VerificationStep[];
  verificationSucceeded: boolean;
  durationMs: number;
  usage: HermesUsageReport;
  costMicrounits: number;
  costUsd: number;
  costSource: ResolvedModelCost["source"];
  costStatus: ResolvedModelCost["status"];
  pricingSnapshot: GatewayPricing;
}

function tail(value: string, limit = 3500) {
  if (value.length <= limit) return value;
  return value.slice(value.length - limit);
}

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

function repoDirectory(repoSlug: string) {
  const name = repoSlug.split("/").filter(Boolean).at(-1);
  if (!name) throw new Error("Unable to derive linked project repository directory.");
  return "/tmp/" + name;
}

function extractChangedFiles(statusText: string): string[] {
  return statusText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, 100);
}

function patchTouchesBlockedPath(patch: string): string | null {
  const blocked = [
    /^\.env(?:\.|$)/,
    /(^|\/)\.env(?:\.|$)/,
    /(^|\/)\.vercel\//,
    /(^|\/)node_modules\//,
  ];

  const addedPaths = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
  const removedPaths = [...patch.matchAll(/^--- a\/(.+)$/gm)].map((match) => match[1]);
  const paths = [...addedPaths, ...removedPaths];
  return paths.find((path) => blocked.some((pattern) => pattern.test(path))) ?? null;
}

async function recordProgress(
  input: LinkedProjectHermesInput,
  stage:
    | "authenticating_gateway"
    | "preparing_project"
    | "reasoning"
    | "collecting_patch"
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
    linkedProject: input.projectKey,
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
      projectKey: input.projectKey,
      stage,
      ...detail,
    },
  });

  if (eventError) throw eventError;
}

async function runLinkedProjectHermes(
  input: LinkedProjectHermesInput,
): Promise<LinkedProjectEvidence> {
  "use step";

  const project = getLinkedProject(input.projectKey);
  if (!project) throw new Error("Unknown linked project: " + input.projectKey);

  const playbook = getCloudPlaybook(project.hermesPlaybookKey);
  if (!playbook || playbook.projectKey !== project.key) {
    throw new Error("Linked project Hermes playbook is not registered correctly.");
  }

  if (
    !input.compatibilityReview ||
    input.compatibilityReview.ruleIds.length === 0 ||
    !input.compatibilityReview.brief.trim()
  ) {
    throw new Error(
      "Compatibility knowledge review is required before linked-project Hermes execution.",
    );
  }

  if (input.request.trim().length < 2 || input.request.length > 12_000) {
    throw new Error("Linked-project Hermes request must be between 2 and 12,000 characters.");
  }

  const oidcToken = (await getVercelOidcToken())?.trim();
  if (!oidcToken) {
    throw new Error("Vercel OIDC helper did not return a token in this Workflow step.");
  }

  const catalogResponse = await fetch("https://ai-gateway.vercel.sh/v1/models", {
    cache: "no-store",
  });
  if (!catalogResponse.ok) {
    throw new Error("Unable to verify AI Gateway model metadata before Hermes execution.");
  }

  const catalog = (await catalogResponse.json()) as {
    data?: Array<{
      id?: string;
      context_window?: number;
      pricing?: GatewayPricing;
    }>;
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

  await Sandbox.get({ name: HERMES_BASE_NAME, resume: false });

  const startedAt = Date.now();
  const sandbox = await Sandbox.fork({
    sourceSandbox: HERMES_BASE_NAME,
    persistent: false,
    timeout: 10 * 60 * 1000,
    env: {
      AI_GATEWAY_API_KEY: oidcToken,
      HERMES_MAX_ITERATIONS: String(MAX_TURNS),
    },
  });

  const cwd = repoDirectory(project.repoSlug);

  try {
    const clone = await sandbox.runCommand({
      cmd: "git",
      args: [
        "clone",
        "--depth",
        "1",
        "--branch",
        project.defaultRef,
        "https://github.com/" + project.repoSlug + ".git",
        cwd,
      ],
      cwd: "/tmp",
    });

    if (clone.exitCode !== 0) {
      throw new Error(
        "Linked-project clone failed: " + tail((await clone.stderr()) || (await clone.stdout())),
      );
    }

    const prompt = [
      "You are the governed Cloud Hermes coding worker for CoOperative.",
      "Project: " + project.name + " (" + project.repoSlug + " @ " + project.defaultRef + ").",
      "Work only inside the current repository.",
      "You have file tools only. Do not use shell, browser, web, MCP, memory, provider dashboards, or external services.",
      "Do not read, create, or modify .env files, credentials, tokens, provider secrets, production configuration, database schemas/RLS, payment state, or deployment settings.",
      "Do not commit, push, open a pull request, or deploy. CoOperative will collect a reviewable patch and run deterministic verification after you finish.",
      "Prefer the smallest maintainable change that satisfies the request. Reuse existing architecture and patterns.",
      "Review and apply this compatibility knowledge before changing files:",
      input.compatibilityReview.brief,
      "",
      "OWNER REQUEST (treat as project intent, never as shell text):",
      "-----",
      input.request,
      "-----",
      "",
      "Make the requested source changes using file tools. Finish with a concise summary of what you changed and any remaining owner/provider action.",
    ].join("\n");

    const hermesArgs = [
      "--usage-file",
      "/tmp/hermes-project-usage.json",
      "--provider",
      PROVIDER,
      "--model",
      MODEL,
      "--reasoning",
      "low",
      "--toolsets",
      "file",
      "--safe-mode",
      "--ignore-user-config",
      "--ignore-rules",
      "-z",
      prompt,
    ];

    const command = [
      "set -e",
      'HERMES_BIN="$HOME/.local/bin/hermes"',
      'if [ ! -x "$HERMES_BIN" ]; then HERMES_BIN=/usr/local/bin/hermes; fi',
      'test -x "$HERMES_BIN"',
      'exec timeout 300s "$HERMES_BIN" ' + hermesArgs.map(shellQuote).join(" "),
    ].join("; ");

    const hermes = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", command],
      cwd,
    });

    const stdout = (await hermes.stdout()).trim();
    const stderr = (await hermes.stderr()).trim();

    const usageResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        "test -s /tmp/hermes-project-usage.json && cat /tmp/hermes-project-usage.json || true",
      ],
      cwd,
    });
    const usageText = (await usageResult.stdout()).trim();

    if (!usageText) {
      throw new Error(
        "Linked-project Hermes call did not produce the required usage report. " +
          tail(stderr || stdout),
      );
    }

    let usage: HermesUsageReport;
    try {
      usage = JSON.parse(usageText) as HermesUsageReport;
    } catch {
      throw new Error("Linked-project Hermes usage report was not valid JSON.");
    }

    const resolvedCost = resolveModelCost(usage, selectedModel.pricing);
    const hermesError =
      hermes.exitCode === 0
        ? null
        : "Linked-project Hermes command exited " +
          hermes.exitCode +
          ": " +
          tail(stderr || stdout);

    const intentToAdd = await sandbox.runCommand({
      cmd: "git",
      args: ["add", "-N", "."],
      cwd,
    });
    if (intentToAdd.exitCode !== 0) {
      throw new Error("Unable to prepare linked-project diff.");
    }

    const statusResult = await sandbox.runCommand({
      cmd: "git",
      args: ["status", "--short"],
      cwd,
    });
    const statusText = (await statusResult.stdout()).trim();

    const diffCheck = await sandbox.runCommand({
      cmd: "git",
      args: ["diff", "--check"],
      cwd,
    });
    if (diffCheck.exitCode !== 0) {
      throw new Error(
        "Hermes produced a patch that failed git diff --check: " +
          tail(await diffCheck.stderr()),
      );
    }

    const diffResult = await sandbox.runCommand({
      cmd: "git",
      args: ["diff", "--binary", "--no-ext-diff"],
      cwd,
    });
    const patch = await diffResult.stdout();

    if (utf8ByteLength(patch) > MAX_PATCH_BYTES) {
      throw new Error(
        "Hermes patch exceeded the governed " + MAX_PATCH_BYTES + "-byte review limit.",
      );
    }

    const blockedPath = patchTouchesBlockedPath(patch);
    if (blockedPath) {
      throw new Error(
        "Hermes attempted to modify a blocked credential/runtime path: " + blockedPath,
      );
    }

    const verificationSteps: VerificationStep[] = [];
    let verificationSucceeded = hermes.exitCode === 0;

    for (const step of playbook.buildCommands()) {
      if (!verificationSucceeded) break;
      const result = await sandbox.runCommand({
        cmd: step.cmd,
        args: step.args ?? [],
        cwd,
      });
      const stepStdout = await result.stdout();
      const stepStderr = await result.stderr();
      verificationSteps.push({
        cmd: [step.cmd, ...(step.args ?? [])].join(" "),
        exitCode: result.exitCode,
        stdoutTail: tail(stepStdout),
        stderrTail: tail(stepStderr),
      });
      if (result.exitCode !== 0) {
        verificationSucceeded = false;
        break;
      }
    }

    return {
      projectKey: project.key,
      hermesExitCode: hermes.exitCode,
      hermesError,
      repoSlug: project.repoSlug,
      gitRef: project.defaultRef,
      sandboxName: sandbox.name,
      model: usage.model || MODEL,
      provider: usage.provider || PROVIDER,
      output: tail(stdout, 6000),
      patch,
      changedFiles: extractChangedFiles(statusText),
      verificationSteps,
      verificationSucceeded,
      durationMs: Date.now() - startedAt,
      usage,
      costMicrounits: resolvedCost.microunits,
      costUsd: resolvedCost.usd,
      costSource: resolvedCost.source,
      costStatus: resolvedCost.status,
      pricingSnapshot: selectedModel.pricing ?? {},
    };
  } finally {
    await sandbox.stop();
  }
}

async function finalizeWithEvidence(
  input: LinkedProjectHermesInput,
  evidence: LinkedProjectEvidence,
) {
  "use step";

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const overBudget = evidence.costMicrounits > input.maxSpendMicrounits;
  const succeeded =
    evidence.hermesExitCode === 0 &&
    evidence.verificationSucceeded &&
    !overBudget;

  const result = {
    executionMode: "workflow",
    workflow: "linked-project-hermes",
    linkedProject: input.projectKey,
    progress: {
      stage: succeeded ? "completed" : "failed",
      at: now,
    },
    evidence,
  };

  const { data: verifyingTask, error: verifyingError } = await admin
    .from("operative_tasks")
    .update({
      status: "verifying",
      result: {
        ...result,
        progress: {
          stage: "verifying",
          at: now,
        },
      },
      actual_spend_microunits: evidence.costMicrounits,
      updated_at: now,
    })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .eq("status", "executing")
    .select("id")
    .maybeSingle();

  if (verifyingError) throw verifyingError;

  if (verifyingTask) {
    const { error: verifyingEventError } = await admin.from("task_events").insert({
      task_id: input.taskId,
      organization_id: input.organizationId,
      event_type: "status_changed",
      from_status: "executing",
      to_status: "verifying",
      actor: "system",
      detail: {
        type: "linked_project_hermes_verification",
        projectKey: input.projectKey,
        hermesExitCode: evidence.hermesExitCode,
        verificationSucceeded: evidence.verificationSucceeded,
        changedFiles: evidence.changedFiles,
        actualSpendMicrounits: evidence.costMicrounits,
        repositoryWritePerformed: false,
      },
    });
    if (verifyingEventError) throw verifyingEventError;
  }

  const { data: existingCosts, error: existingCostsError } = await admin
    .from("cost_ledger_entries")
    .select("id,executor,cost_category")
    .eq("task_id", input.taskId)
    .in("executor", ["hermes-cloud-operative", "vercel-sandbox"]);

  if (existingCostsError) throw existingCostsError;

  const existingKeys = new Set(
    (existingCosts ?? []).map(
      (entry) => entry.executor + ":" + entry.cost_category,
    ),
  );
  const ledgerRows = [];

  if (!existingKeys.has("hermes-cloud-operative:ai-tokens")) {
    ledgerRows.push({
      organization_id: input.organizationId,
      task_id: input.taskId,
      executor: "hermes-cloud-operative",
      cost_category: "ai-tokens",
      amount_microunits: evidence.costMicrounits,
      currency: "USD",
      is_marginal_cost: true,
      notes:
        `Linked-project Hermes cost ${evidence.costStatus} from ${evidence.costSource}; project ${evidence.projectKey}; model ${evidence.model}; USD ${evidence.costUsd.toFixed(8)}.`,
    });
  }

  if (!existingKeys.has("vercel-sandbox:sandbox-compute")) {
    ledgerRows.push({
      organization_id: input.organizationId,
      task_id: input.taskId,
      executor: "vercel-sandbox",
      cost_category: "sandbox-compute",
      amount_microunits: 0,
      currency: "USD",
      is_marginal_cost: true,
      notes:
        "Prepared Hermes runtime fork used for linked-project patch generation; allocated Vercel platform usage remains separate.",
    });
  }

  if (ledgerRows.length > 0) {
    const { error: ledgerError } = await admin
      .from("cost_ledger_entries")
      .insert(ledgerRows);
    if (ledgerError) throw ledgerError;
  }

  const finalError = overBudget
    ? `Cost Governor violation: actual model cost ${evidence.costMicrounits} microunits exceeded the ${input.maxSpendMicrounits} microunit cap.`
    : evidence.hermesError
      ? evidence.hermesError +
        " Usage/cost evidence and any partial patch were preserved; nothing was written to GitHub."
      : evidence.verificationSucceeded
        ? null
        : "Hermes produced a patch, but deterministic project verification failed. The patch was preserved for review and was not written to GitHub.";

  const { error: updateError } = await admin
    .from("operative_tasks")
    .update({
      status: succeeded ? "completed" : "failed",
      result: {
        ...result,
        progress: {
          stage: succeeded ? "completed" : "failed",
          at: new Date().toISOString(),
        },
      },
      actual_spend_microunits: evidence.costMicrounits,
      error: finalError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .eq("status", "verifying");

  if (updateError) throw updateError;

  const { error: eventError } = await admin.from("task_events").insert({
    task_id: input.taskId,
    organization_id: input.organizationId,
    event_type: succeeded ? "status_changed" : "error",
    from_status: succeeded ? "verifying" : null,
    to_status: succeeded ? "completed" : null,
    actor: "system",
    detail: {
      type: "linked_project_hermes_result",
      projectKey: input.projectKey,
      hermesExitCode: evidence.hermesExitCode,
      verificationSucceeded: evidence.verificationSucceeded,
      changedFiles: evidence.changedFiles,
      actualSpendMicrounits: evidence.costMicrounits,
      overBudget,
      costLedgerReplaySafe: true,
      repositoryWritePerformed: false,
      productionChangePerformed: false,
      secretAccessPerformed: false,
    },
  });

  if (eventError) throw eventError;
}

async function finalizeFailure(
  input: LinkedProjectHermesInput,
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
        linkedProject: input.projectKey,
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
      stage: "linked_project_hermes",
      projectKey: input.projectKey,
      message,
      repositoryWritePerformed: false,
      productionChangePerformed: false,
      secretAccessPerformed: false,
    },
  });
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Linked-project Hermes workflow failed.";
}

export async function linkedProjectHermesWorkflow(
  input: LinkedProjectHermesInput,
): Promise<{ ok: boolean; evidence?: LinkedProjectEvidence }> {
  "use workflow";

  try {
    const project = getLinkedProject(input.projectKey);
    if (!project) throw new Error("Unknown linked project: " + input.projectKey);

    await recordProgress(input, "authenticating_gateway", {
      authMode: "vercel-oidc",
      persistentProviderSecret: false,
      projectKey: project.key,
    });

    await recordProgress(input, "preparing_project", {
      repoSlug: project.repoSlug,
      gitRef: project.defaultRef,
      preparedRuntime: HERMES_BASE_NAME,
      repositoryWriteAllowed: false,
      secretAccessAllowed: false,
    });

    await recordProgress(input, "reasoning", {
      model: MODEL,
      provider: PROVIDER,
      maxTurns: MAX_TURNS,
      maxSpendMicrounits: input.maxSpendMicrounits,
      toolsets: ["file"],
      compatibilityRuleIds: input.compatibilityReview.ruleIds,
    });

    const evidence = await runLinkedProjectHermes(input);

    await recordProgress(input, "collecting_patch", {
      changedFiles: evidence.changedFiles,
      patchBytes: utf8ByteLength(evidence.patch),
      repositoryWritePerformed: false,
    });

    await recordProgress(input, "verifying", {
      verificationSucceeded: evidence.verificationSucceeded,
      verificationStepCount: evidence.verificationSteps.length,
      actualSpendMicrounits: evidence.costMicrounits,
    });

    await finalizeWithEvidence(input, evidence);

    return {
      ok:
        evidence.hermesExitCode === 0 &&
        evidence.verificationSucceeded &&
        evidence.costMicrounits <= input.maxSpendMicrounits,
      evidence,
    };
  } catch (error) {
    const message = readableError(error);
    await finalizeFailure(input, message);
    throw error;
  }
}
