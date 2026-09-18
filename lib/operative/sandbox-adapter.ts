import { Sandbox } from "@vercel/sandbox";

/**
 * Execution-workspace adapter for Vercel Sandbox.
 *
 * Synchronous playbooks are intentionally small. Longer work uses a named
 * persistent Sandbox plus a detached runner so the owner's browser/API request
 * never has to remain open for the lifetime of the command.
 */

export interface SandboxTaskSpec {
  taskId: string;
  repoSlug: string;
  gitRef: string;
  commands: { cmd: string; args?: string[] }[];
  timeoutMs?: number;
}

export interface SandboxRunResult {
  taskId: string;
  sandboxName: string;
  succeeded: boolean;
  steps: { cmd: string; exitCode: number; stdout: string; stderr: string }[];
  durationMs: number;
}

export interface DetachedSandboxStartResult {
  taskId: string;
  sandboxName: string;
  startedAt: string;
  deadlineAt: string;
}

export interface DetachedSandboxPollResult {
  state: "running" | "succeeded" | "failed";
  sandboxName: string;
  durationMs: number | null;
  steps: { cmd: string; exitCode: number; stdout: string; stderr: string }[];
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DETACHED_TIMEOUT_MS = 10 * 60 * 1000;
const DETACHED_STATUS_DIR = "/tmp/cooperative-task";

function repoDirectory(repoSlug: string): string {
  const value = repoSlug.split("/").filter(Boolean).at(-1);
  if (!value) throw new Error("Unable to derive Sandbox repository directory from repoSlug.");
  return value;
}

function detachedSandboxName(taskId: string): string {
  return "cooperative-task-" + taskId.toLowerCase();
}

function buildDetachedRunner(commands: SandboxTaskSpec["commands"]): string {
  const encodedCommands = JSON.stringify(commands);
  return `import fs from "node:fs";
import { spawnSync } from "node:child_process";

const statusDir = ${JSON.stringify(DETACHED_STATUS_DIR)};
const commands = ${encodedCommands};
const startedAt = Date.now();
const steps = [];

fs.mkdirSync(statusDir, { recursive: true });
fs.writeFileSync(statusDir + "/state", "running");

function finish(state, error = null) {
  const summary = {
    state,
    error,
    durationMs: Date.now() - startedAt,
    steps,
  };
  fs.writeFileSync(statusDir + "/summary.json", JSON.stringify(summary));
  fs.writeFileSync(statusDir + "/state", state);
}

try {
  for (const step of commands) {
    const result = spawnSync(step.cmd, step.args ?? [], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });

    const exitCode =
      typeof result.status === "number"
        ? result.status
        : result.error
          ? 1
          : 0;

    steps.push({
      cmd: [step.cmd, ...(step.args ?? [])].join(" "),
      exitCode,
      stdout: result.stdout ?? "",
      stderr: [result.stderr ?? "", result.error?.message ?? ""].filter(Boolean).join("\\n"),
    });

    if (exitCode !== 0) {
      finish("failed", "One or more allow-listed playbook commands failed.");
      process.exit(0);
    }
  }

  finish("succeeded");
} catch (error) {
  finish("failed", error instanceof Error ? error.message : "Detached Sandbox runner failed.");
}
`;
}

export async function runSandboxTask(spec: SandboxTaskSpec): Promise<SandboxRunResult> {
  const startedAt = Date.now();
  const sandbox = await Sandbox.create({
    source: {
      url: `https://github.com/${spec.repoSlug}.git`,
      type: "git",
      revision: spec.gitRef,
    },
    timeout: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });

  const steps: SandboxRunResult["steps"] = [];
  let succeeded = true;
  const cwd = repoDirectory(spec.repoSlug);

  try {
    for (const step of spec.commands) {
      const result = await sandbox.runCommand({
        cmd: step.cmd,
        args: step.args ?? [],
        cwd,
      });
      const stdout = await result.stdout();
      const stderr = await result.stderr();
      steps.push({
        cmd: [step.cmd, ...(step.args ?? [])].join(" "),
        exitCode: result.exitCode,
        stdout,
        stderr,
      });
      if (result.exitCode !== 0) {
        succeeded = false;
        break;
      }
    }
  } finally {
    await sandbox.stop();
  }

  return {
    taskId: spec.taskId,
    sandboxName: sandbox.name,
    succeeded,
    steps,
    durationMs: Date.now() - startedAt,
  };
}

export async function startDetachedSandboxTask(
  spec: SandboxTaskSpec,
): Promise<DetachedSandboxStartResult> {
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + (spec.timeoutMs ?? DETACHED_TIMEOUT_MS));
  const name = detachedSandboxName(spec.taskId);
  const cwd = repoDirectory(spec.repoSlug);

  const sandbox = await Sandbox.create({
    name,
    persistent: true,
    source: {
      url: `https://github.com/${spec.repoSlug}.git`,
      type: "git",
      revision: spec.gitRef,
    },
    timeout: spec.timeoutMs ?? DETACHED_TIMEOUT_MS,
  });

  const runner = buildDetachedRunner(spec.commands);
  await sandbox.writeFiles([
    {
      path: "/tmp/cooperative-runner.mjs",
      content: Buffer.from(runner, "utf8"),
    },
  ]);

  await sandbox.runCommand({
    cmd: "node",
    args: ["/tmp/cooperative-runner.mjs"],
    cwd,
    detached: true,
  });

  return {
    taskId: spec.taskId,
    sandboxName: sandbox.name,
    startedAt: startedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
  };
}

export async function pollDetachedSandboxTask(args: {
  sandboxName: string;
  deadlineAt: string;
}): Promise<DetachedSandboxPollResult> {
  const sandbox = await Sandbox.get({ name: args.sandboxName });
  const stateResult = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `cat ${DETACHED_STATUS_DIR}/state 2>/dev/null || echo missing`],
  });
  const rawState = (await stateResult.stdout()).trim();

  if (rawState === "running" || rawState === "missing") {
    if (Date.now() <= Date.parse(args.deadlineAt)) {
      return {
        state: "running",
        sandboxName: args.sandboxName,
        durationMs: null,
        steps: [],
        error: null,
      };
    }

    await sandbox.stop();
    return {
      state: "failed",
      sandboxName: args.sandboxName,
      durationMs: null,
      steps: [],
      error: "Detached Sandbox task exceeded its execution deadline.",
    };
  }

  const summaryResult = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `cat ${DETACHED_STATUS_DIR}/summary.json 2>/dev/null || true`],
  });
  const summaryText = (await summaryResult.stdout()).trim();

  let parsed: {
    state?: string;
    error?: string | null;
    durationMs?: number;
    steps?: { cmd: string; exitCode: number; stdout: string; stderr: string }[];
  } = {};

  if (summaryText) {
    try {
      parsed = JSON.parse(summaryText);
    } catch {
      parsed = {};
    }
  }

  await sandbox.stop();

  const succeeded = rawState === "succeeded";
  return {
    state: succeeded ? "succeeded" : "failed",
    sandboxName: args.sandboxName,
    durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : null,
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    error:
      succeeded
        ? null
        : parsed.error || "Detached Sandbox playbook failed without a readable summary.",
  };
}
