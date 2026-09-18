import { Sandbox } from "@vercel/sandbox";

/**
 * Execution-workspace adapter for Vercel Sandbox.
 *
 * Per docs/CLOUD-OPERATIVE.md "Execution Workspace": a sandbox is created
 * on-demand only when a task genuinely needs a shell, repository checkout,
 * tests, CLIs, or code execution. "A sandbox is an execution workspace, not
 * the authoritative database" — callers must persist any intentional
 * artifact/result to Supabase (task_events / operative_tasks.result /
 * Supabase Storage) before the sandbox stops; nothing here is durable.
 *
 * Authentication uses Vercel OIDC tokens (the recommended method — see
 * https://vercel.com/docs/sandbox/concepts/authentication). In production on
 * Vercel this is automatic; for local development run `vercel link` and
 * `vercel env pull` to obtain a development VERCEL_OIDC_TOKEN. No sandbox
 * access token is read or stored by this module.
 */

export interface SandboxTaskSpec {
  taskId: string;
  /** git repo to check out, e.g. "zanibethel/CoOperative" */
  repoSlug: string;
  /** git ref (branch/tag/sha) to check out — never default to a mutable branch for untrusted work */
  gitRef: string;
  /** Shell commands to run in order. Each command's exit code is checked. */
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

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — well under the Hobby 45-min cap.

/**
 * Create a sandbox, check out only the requested repo/ref, run the approved
 * playbook's commands, and stop the sandbox. Network access and credentials
 * are intentionally minimal: this function does not inject any secret env
 * vars by default. Callers needing scoped credentials must pass them
 * explicitly and are responsible for using logical secret references, never
 * raw values, in `task_events.detail` (docs/CLOUD-OPERATIVE.md "Secrets").
 */
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

  try {
    for (const step of spec.commands) {
      const result = await sandbox.runCommand({
        cmd: step.cmd,
        args: step.args ?? [],
      });
      const stdout = await result.stdout();
      const stderr = await result.stderr();
      steps.push({ cmd: [step.cmd, ...(step.args ?? [])].join(" "), exitCode: result.exitCode, stdout, stderr });
      if (result.exitCode !== 0) {
        succeeded = false;
        break;
      }
    }
  } finally {
    // Always stop the sandbox — it is billed while running and holds no
    // durable state we depend on after this call returns.
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
