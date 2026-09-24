import "server-only";

import { Sandbox } from "@vercel/sandbox";

const HERMES_RELEASE = "v2026.9.14";
const HERMES_INSTALL_URL =
  "https://raw.githubusercontent.com/NousResearch/hermes-agent/v2026.9.14/scripts/install.sh";

export interface HermesCloudTaskSpec {
  taskId: string;
  prompt: string;
  model: string;
  provider?: "nous-api";
  maxTurns?: number;
  runBudgetSeconds?: number;
  toolsets?: string[];
  timeoutMs?: number;
}

export interface HermesUsageSummary {
  estimated_cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  api_calls?: number;
  model?: string;
  provider?: string;
  session_id?: string;
  completed?: boolean;
  failed?: boolean;
  [key: string]: unknown;
}

export interface HermesCloudRunResult {
  taskId: string;
  model: string;
  provider: string;
  sandboxName: string;
  succeeded: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  usage: HermesUsageSummary | null;
  durationMs: number;
}

function requireNousApiKey(): string {
  const value = process.env.NOUS_API_KEY?.trim();
  if (!value) {
    throw new Error(
      "Cloud Hermes provider authentication is not configured. NOUS_API_KEY is required.",
    );
  }
  return value;
}

function boundInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`);
  }
  return resolved;
}

function safeToolsets(toolsets: string[] | undefined): string[] {
  if (!toolsets) return [];
  return toolsets.map((value) => {
    if (!/^[a-z0-9_-]+$/i.test(value)) {
      throw new Error("Hermes toolset names may contain only letters, numbers, _ and -.");
    }
    return value;
  });
}

/**
 * On-demand Cloud Hermes runner.
 *
 * Security properties:
 * - owner text is written to a file; it never becomes a shell command/argument;
 * - only NOUS_API_KEY is passed into the Sandbox;
 * - model/provider are explicit per task rather than inherited from a mutable Hermes default;
 * - turns and wall-clock budget are bounded;
 * - Hermes usage is captured to a machine-readable file for the Cost Governor;
 * - the Sandbox is always stopped.
 *
 * This adapter is intentionally dormant until NOUS_API_KEY is explicitly
 * configured in the target Vercel environment.
 */
export async function runHermesCloudTask(
  spec: HermesCloudTaskSpec,
): Promise<HermesCloudRunResult> {
  const startedAt = Date.now();
  const provider = spec.provider ?? "nous-api";
  const maxTurns = boundInteger(spec.maxTurns, 8, 1, 30);
  const runBudgetSeconds = boundInteger(spec.runBudgetSeconds, 180, 30, 900);
  const toolsets = safeToolsets(spec.toolsets);
  const nousApiKey = requireNousApiKey();

  if (!spec.model.trim()) {
    throw new Error("A task-scoped Hermes model is required.");
  }
  if (!spec.prompt.trim()) {
    throw new Error("A non-empty Hermes task prompt is required.");
  }

  const sandbox = await Sandbox.create({
    runtime: "node24",
    timeout: spec.timeoutMs ?? Math.min((runBudgetSeconds + 120) * 1000, 15 * 60 * 1000),
    env: {
      NOUS_API_KEY: nousApiKey,
    },
  });

  try {
    const install = await sandbox.runCommand("bash", [
      "-lc",
      `curl -fsSL ${HERMES_INSTALL_URL} -o /tmp/hermes-install.sh && bash /tmp/hermes-install.sh --skip-setup --skip-browser --skip-computer-use --non-interactive --branch ${HERMES_RELEASE}`,
    ]);
    if (install.exitCode !== 0) {
      return {
        taskId: spec.taskId,
        model: spec.model,
        provider,
        sandboxName: sandbox.name,
        succeeded: false,
        exitCode: install.exitCode,
        stdout: await install.stdout(),
        stderr: await install.stderr(),
        usage: null,
        durationMs: Date.now() - startedAt,
      };
    }

    await sandbox.writeFiles([
      {
        path: "/tmp/cooperative-task.md",
        content: Buffer.from(spec.prompt, "utf8"),
      },
    ]);

    const args = [
      "chat",
      "--oneshot",
      "--query-file",
      "/tmp/cooperative-task.md",
      "--provider",
      provider,
      "--model",
      spec.model,
      "--max-turns",
      String(maxTurns),
      "--run-budget",
      String(runBudgetSeconds),
      "--usage-file",
      "/tmp/hermes-usage.json",
    ];

    if (toolsets.length > 0) {
      args.push("--toolsets", toolsets.join(","));
    }

    const command =
      'HERMES_BIN="$HOME/.local/bin/hermes"; [ -x "$HERMES_BIN" ] || HERMES_BIN=/usr/local/bin/hermes; exec "$HERMES_BIN" "$@"';

    const result = await sandbox.runCommand("bash", ["-lc", command, "hermes", ...args]);
    const stdout = await result.stdout();
    const stderr = await result.stderr();

    let usage: HermesUsageSummary | null = null;
    const usageRead = await sandbox.runCommand("bash", [
      "-lc",
      "test -s /tmp/hermes-usage.json && cat /tmp/hermes-usage.json || true",
    ]);
    const usageText = (await usageRead.stdout()).trim();
    if (usageText) {
      try {
        usage = JSON.parse(usageText) as HermesUsageSummary;
      } catch {
        usage = null;
      }
    }

    return {
      taskId: spec.taskId,
      model: spec.model,
      provider,
      sandboxName: sandbox.name,
      succeeded: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout,
      stderr,
      usage,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await sandbox.stop();
  }
}
