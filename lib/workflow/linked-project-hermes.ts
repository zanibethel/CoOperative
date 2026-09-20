import { getVercelOidcToken } from "@vercel/oidc";
import { Sandbox } from "@vercel/sandbox";
import { FatalError, sleep } from "workflow";

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
const MAX_TURNS = 4;
const HERMES_COMMAND_TIMEOUT_SECONDS = 420;

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

interface LinkedProjectFailureAdvice {
  title: string;
  summary: string;
  cause: string;
  retrySafety: "do-not-blind-retry" | "safe-after-fix" | "review-first";
  costStatus: "known" | "unresolved";
  recommendedAction: string;
  suggestedPrompt?: string;
  executablePrompt?: string;
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

function firstRecoveryPhasePrompt(request: string): string {
  const compact = request.trim().replace(/\s+/g, " ");
  return [
    "Implement only Phase 1 of the failed linked-project request.",
    "Scope this run to the first independently verifiable source-code capability in the original request, plus only the directly coupled types/tests needed for that capability.",
    "Do not plan or implement downstream phases in this run.",
    "Do not deploy, push, touch secrets, change production, or change the database.",
    "Original request for context:",
    compact,
  ].join("\n");
}

function failureAdviceFor(
  message: string,
  request = "",
): LinkedProjectFailureAdvice {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("execution window") ||
    normalized.includes("required usage report") ||
    normalized.includes("timed out")
  ) {
    const alreadyBounded =
      request.includes("Implement only Phase 1") ||
      request.includes("first independently verifiable source-code capability");

    if (alreadyBounded) {
      return {
        title: "Fix the Hermes worker before another paid run",
        summary:
          "A deliberately small Phase 1 still consumed the full execution window, so further scope splitting is no longer the right recovery.",
        cause:
          "The linked-project worker previously allowed too many Hermes iterations inside too little command headroom. The governed worker now uses four iterations with a 420-second command window so it can terminate and flush usage evidence before the outer sandbox timeout.",
        retrySafety: "safe-after-fix",
        costStatus: "unresolved",
        recommendedAction:
          "Do not split the Phase 1 request again. Verify the worker-budget fix first, then rerun this same bounded Phase 1 once.",
        suggestedPrompt:
          "Verify the linked-project Hermes worker uses the bounded four-iteration budget and passes CI. Then rerun this same bounded Phase 1 once; do not recursively split it again.",
        executablePrompt: request.trim(),
      };
    }

    return {
      title: "Split this request before another paid run",
      summary:
        "Hermes did not finish cleanly enough to emit the required usage/cost report.",
      cause:
        "The linked-project worker has a bounded execution window. A broad coding request can reach that limit before Hermes finalizes its usage file.",
      retrySafety: "do-not-blind-retry",
      costStatus: "unresolved",
      recommendedAction:
        "Break the request into smaller governed phases and run only the first phase. Do not use the blind Retry button for this failure.",
      suggestedPrompt:
        "Split the failed linked-project request into 3–5 small implementation phases. Prepare only Phase 1 as a new governed Hermes patch request, keeping the same safety gates. Do not retry the entire original request.",
      executablePrompt: firstRecoveryPhasePrompt(request),
    };
  }

  if (normalized.includes("buffer is not defined")) {
    return {
      title: "Fix the deterministic workflow runtime first",
      summary: "This is a CoOperative workflow compatibility failure, not a project-code failure.",
      cause: "Node-specific runtime code was used inside a Workflow runtime that did not guarantee it.",
      retrySafety: "safe-after-fix",
      costStatus: "unresolved",
      recommendedAction:
        "Apply the known deterministic runtime fix and verify CI before another Hermes run.",
      suggestedPrompt:
        "Apply the known Workflow runtime compatibility fix from the Integration Compatibility Registry, verify CI, and only then prepare a new Hermes patch run.",
    };
  }

  if (normalized.includes("without producing source changes")) {
    return {
      title: "Clarify the patch scope before retrying",
      summary: "Hermes finished but produced no source changes.",
      cause:
        "The request was not converted into a valid source patch, so repository health alone cannot count as success.",
      retrySafety: "review-first",
      costStatus: "known",
      recommendedAction:
        "Narrow the requested change to one concrete source outcome and retry only that phase.",
      suggestedPrompt:
        "Rewrite this failed request as one concrete source-change phase with explicit files/behavior to produce, then prepare a governed Hermes patch for that phase only.",
    };
  }

  if (normalized.includes("verification failed") || normalized.includes("failed git diff")) {
    return {
      title: "Repair the patch before another model run",
      summary: "Hermes produced work, but deterministic verification rejected it.",
      cause: "A source patch exists, but one of CoOperative's verification gates failed.",
      retrySafety: "review-first",
      costStatus: "known",
      recommendedAction:
        "Use the failing verification output to prepare a focused repair instead of rerunning the original request.",
      suggestedPrompt:
        "Inspect the preserved patch and failing deterministic verification step. Prepare the smallest safe repair needed to make verification pass; do not redo unrelated work.",
    };
  }

  return {
    title: "Review the failure before retrying",
    summary: "CoOperative stopped the task without applying project changes.",
    cause: message,
    retrySafety: "review-first",
    costStatus: "unresolved",
    recommendedAction:
      "Use Ask CoOperative to explain/fix the captured failure before starting another paid Hermes run.",
    suggestedPrompt:
      "Diagnose this failed linked-project task from its canonical events and logs, then recommend the smallest safe next action before any paid retry.",
  };
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


interface DetachedHermesHandle {
  sandboxName: string;
  cwd: string;
  startedAt: number;
  deadlineAt: number;
  pricingSnapshot: GatewayPricing;
}

interface DetachedHermesPoll {
  state: "running" | "finished";
  exitCode: number | null;
}

type LinkedProjectPatchEvidence = Omit<
  LinkedProjectEvidence,
  "verificationSteps" | "verificationSucceeded"
>;

async function startLinkedProjectHermesDetached(
  input: LinkedProjectHermesInput,
): Promise<DetachedHermesHandle> {
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
    await sandbox.stop();
    throw new Error(
      "Linked-project clone failed: " +
        tail((await clone.stderr()) || (await clone.stdout())),
    );
  }

  const prompt = [
    "You are the governed Cloud Hermes coding worker for CoOperative.",
    "Project: " + project.name + " (" + project.repoSlug + " @ " + project.defaultRef + ").",
    "Repository root: " + cwd + ".",
    "Use file tools against this repository root. Prefer absolute paths under " + cwd + " so edits cannot drift into the Hermes runtime directory.",
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

  const statusDir = "/tmp/cooperative-hermes-detached";
  const runner = [
    "set +e",
    "mkdir -p " + shellQuote(statusDir),
    "rm -f " +
      [
        statusDir + "/state",
        statusDir + "/exit-code",
        statusDir + "/stdout.log",
        statusDir + "/stderr.log",
      ].map(shellQuote).join(" "),
    "echo running > " + shellQuote(statusDir + "/state"),
    'HERMES_BIN="$HOME/.local/bin/hermes"',
    'if [ ! -x "$HERMES_BIN" ]; then HERMES_BIN=/usr/local/bin/hermes; fi',
    'if [ ! -x "$HERMES_BIN" ]; then echo 127 > ' +
      shellQuote(statusDir + "/exit-code") +
      "; echo missing-hermes-binary > " +
      shellQuote(statusDir + "/stderr.log") +
      "; echo finished > " +
      shellQuote(statusDir + "/state") +
      "; exit 0; fi",
    "export TERMINAL_CWD=" + shellQuote(cwd),
    'if [ ! -f "$TERMINAL_CWD/package.json" ]; then echo 2 > ' +
      shellQuote(statusDir + "/exit-code") +
      "; echo missing-package-json > " +
      shellQuote(statusDir + "/stderr.log") +
      "; echo finished > " +
      shellQuote(statusDir + "/state") +
      "; exit 0; fi",
    "timeout " +
      HERMES_COMMAND_TIMEOUT_SECONDS +
      's "$HERMES_BIN" ' +
      hermesArgs.map(shellQuote).join(" ") +
      " > " +
      shellQuote(statusDir + "/stdout.log") +
      " 2> " +
      shellQuote(statusDir + "/stderr.log"),
    "code=$?",
    "echo \"$code\" > " + shellQuote(statusDir + "/exit-code"),
    "echo finished > " + shellQuote(statusDir + "/state"),
    "exit 0",
  ].join("; ");

  await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", runner],
    cwd,
    detached: true,
  });

  return {
    sandboxName: sandbox.name,
    cwd,
    startedAt,
    deadlineAt: startedAt + 9 * 60 * 1000,
    pricingSnapshot: selectedModel.pricing ?? {},
  };
}

startLinkedProjectHermesDetached.maxRetries = 0;

async function pollLinkedProjectHermesDetached(
  handle: DetachedHermesHandle,
): Promise<DetachedHermesPoll> {
  "use step";

  const sandbox = await Sandbox.get({ name: handle.sandboxName });
  const statusDir = "/tmp/cooperative-hermes-detached";
  const status = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "state=$(cat " +
        shellQuote(statusDir + "/state") +
        " 2>/dev/null || echo missing); " +
        "code=$(cat " +
        shellQuote(statusDir + "/exit-code") +
        " 2>/dev/null || true); " +
        'printf "%s\\n%s\\n" "$state" "$code"',
    ],
    cwd: handle.cwd,
  });

  const lines = (await status.stdout()).trim().split("\n");
  const state = lines[0] ?? "missing";
  const exitCodeText = lines[1] ?? "";

  if (state === "finished") {
    const parsed = Number.parseInt(exitCodeText, 10);
    return {
      state: "finished",
      exitCode: Number.isFinite(parsed) ? parsed : null,
    };
  }

  if (Date.now() > handle.deadlineAt) {
    throw new FatalError(
      "Detached Cloud Hermes exceeded its nine-minute orchestration deadline.",
    );
  }

  return { state: "running", exitCode: null };
}

async function collectLinkedProjectHermesPatch(
  input: LinkedProjectHermesInput,
  handle: DetachedHermesHandle,
  hermesExitCode: number,
): Promise<LinkedProjectPatchEvidence> {
  "use step";

  const project = getLinkedProject(input.projectKey);
  if (!project) throw new Error("Unknown linked project: " + input.projectKey);

  const sandbox = await Sandbox.get({ name: handle.sandboxName });
  const statusDir = "/tmp/cooperative-hermes-detached";

  const logs = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "printf '%s\\n' '---STDOUT---'; cat " +
        shellQuote(statusDir + "/stdout.log") +
        " 2>/dev/null || true; printf '%s\\n' '---STDERR---'; cat " +
        shellQuote(statusDir + "/stderr.log") +
        " 2>/dev/null || true",
    ],
    cwd: handle.cwd,
  });
  const combinedLogs = await logs.stdout();
  const [stdoutPart = "", stderrPart = ""] = combinedLogs.split("---STDERR---");
  const stdout = stdoutPart.replace("---STDOUT---", "").trim();
  const stderr = stderrPart.trim();

  const usageResult = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      "test -s /tmp/hermes-project-usage.json && cat /tmp/hermes-project-usage.json || true",
    ],
    cwd: handle.cwd,
  });
  const usageText = (await usageResult.stdout()).trim();

  if (!usageText) {
    const timedOut = hermesExitCode === 124;
    const terminalMessage = timedOut
      ? "Cloud Hermes reached its " +
        HERMES_COMMAND_TIMEOUT_SECONDS +
        "-second execution window before writing the required usage report. Cost is unresolved; do not blind-retry this request."
      : "Linked-project Hermes finished without the required usage report. Cost is unresolved; do not blind-retry until this failure is diagnosed. " +
        tail(stderr || stdout);
    throw new FatalError(terminalMessage);
  }

  let usage: HermesUsageReport;
  try {
    usage = JSON.parse(usageText) as HermesUsageReport;
  } catch {
    throw new FatalError("Linked-project Hermes usage report was not valid JSON.");
  }

  const resolvedCost = resolveModelCost(usage, handle.pricingSnapshot);
  const hermesError =
    hermesExitCode === 0
      ? null
      : "Linked-project Hermes command exited " +
        hermesExitCode +
        ": " +
        tail(stderr || stdout);

  const intentToAdd = await sandbox.runCommand({
    cmd: "git",
    args: ["add", "-N", "."],
    cwd: handle.cwd,
  });
  if (intentToAdd.exitCode !== 0) {
    throw new Error("Unable to prepare linked-project diff.");
  }

  const statusResult = await sandbox.runCommand({
    cmd: "git",
    args: ["status", "--short"],
    cwd: handle.cwd,
  });
  const statusText = (await statusResult.stdout()).trim();

  const diffCheck = await sandbox.runCommand({
    cmd: "git",
    args: ["diff", "--check"],
    cwd: handle.cwd,
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
    cwd: handle.cwd,
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

  return {
    projectKey: project.key,
    hermesExitCode,
    hermesError,
    repoSlug: project.repoSlug,
    gitRef: project.defaultRef,
    sandboxName: handle.sandboxName,
    model: usage.model || MODEL,
    provider: usage.provider || PROVIDER,
    output: tail(stdout, 6000),
    patch,
    changedFiles: extractChangedFiles(statusText),
    durationMs: Date.now() - handle.startedAt,
    usage,
    costMicrounits: resolvedCost.microunits,
    costUsd: resolvedCost.usd,
    costSource: resolvedCost.source,
    costStatus: resolvedCost.status,
    pricingSnapshot: handle.pricingSnapshot,
  };
}

async function runLinkedProjectVerificationStep(
  handle: DetachedHermesHandle,
  step: { cmd: string; args?: string[] },
): Promise<VerificationStep> {
  "use step";

  const sandbox = await Sandbox.get({ name: handle.sandboxName });
  const result = await sandbox.runCommand({
    cmd: step.cmd,
    args: step.args ?? [],
    cwd: handle.cwd,
  });

  return {
    cmd: [step.cmd, ...(step.args ?? [])].join(" "),
    exitCode: result.exitCode,
    stdoutTail: tail(await result.stdout()),
    stderrTail: tail(await result.stderr()),
  };
}

async function stopLinkedProjectHermesSandbox(
  sandboxName: string,
) {
  "use step";

  try {
    const sandbox = await Sandbox.get({ name: sandboxName });
    await sandbox.stop();
  } catch {
    // Best-effort cleanup only. The Sandbox also has its own hard session timeout.
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
  const sourceChangesProduced = evidence.changedFiles.length > 0;
  const succeeded =
    evidence.hermesExitCode === 0 &&
    evidence.verificationSucceeded &&
    sourceChangesProduced &&
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
      : !sourceChangesProduced
        ? "Hermes completed without producing source changes, so this governed patch task is incomplete. Nothing was written to GitHub."
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
      sourceChangesProduced,
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
    .select("result,error,status")
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const current =
    task?.result && typeof task.result === "object" && !Array.isArray(task.result)
      ? (task.result as Record<string, unknown>)
      : {};
  const existingAdvice =
    current.failureAdvice &&
    typeof current.failureAdvice === "object" &&
    !Array.isArray(current.failureAdvice)
      ? current.failureAdvice
      : null;
  const existingPreciseError =
    typeof task?.error === "string" &&
    task.error.trim() &&
    task.error !== "Linked-project Hermes workflow failed."
      ? task.error
      : null;
  const effectiveMessage = existingPreciseError || message;
  const failureAdvice =
    existingAdvice ?? failureAdviceFor(effectiveMessage, input.request);

  await admin
    .from("operative_tasks")
    .update({
      status: "failed",
      error: effectiveMessage,
      result: {
        ...current,
        executionMode: "workflow",
        linkedProject: input.projectKey,
        progress: {
          stage: "failed",
          at: now,
          message: effectiveMessage,
        },
        failureAdvice,
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
      commandTimeoutSeconds: HERMES_COMMAND_TIMEOUT_SECONDS,
      executionMode: "detached-sandbox-process",
      maxSpendMicrounits: input.maxSpendMicrounits,
      toolsets: ["file"],
      compatibilityRuleIds: input.compatibilityReview.ruleIds,
    });

    const handle = await startLinkedProjectHermesDetached(input);

    try {
      let poll: DetachedHermesPoll = { state: "running", exitCode: null };
      while (poll.state === "running") {
        await sleep("10s");
        poll = await pollLinkedProjectHermesDetached(handle);
      }

      if (poll.exitCode === null) {
        throw new FatalError("Detached Cloud Hermes finished without an exit code.");
      }

      const patchEvidence = await collectLinkedProjectHermesPatch(
        input,
        handle,
        poll.exitCode,
      );

      await recordProgress(input, "collecting_patch", {
        changedFiles: patchEvidence.changedFiles,
        patchBytes: utf8ByteLength(patchEvidence.patch),
        repositoryWritePerformed: false,
      });

      const projectPlaybook = getCloudPlaybook(project.hermesPlaybookKey);
      if (!projectPlaybook) {
        throw new Error("Linked-project verification playbook is unavailable.");
      }

      const verificationSteps: VerificationStep[] = [];
      let verificationSucceeded = patchEvidence.hermesExitCode === 0;

      for (const step of projectPlaybook.buildCommands()) {
        if (!verificationSucceeded) break;
        const verification = await runLinkedProjectVerificationStep(handle, step);
        verificationSteps.push(verification);
        if (verification.exitCode !== 0) {
          verificationSucceeded = false;
        }
      }

      const evidence: LinkedProjectEvidence = {
        ...patchEvidence,
        verificationSteps,
        verificationSucceeded,
      };

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
          evidence.changedFiles.length > 0 &&
          evidence.costMicrounits <= input.maxSpendMicrounits,
        evidence,
      };
    } finally {
      await stopLinkedProjectHermesSandbox(handle.sandboxName);
    }
  } catch (error) {
    const message = readableError(error);
    await finalizeFailure(input, message);
    throw error;
  }
}
