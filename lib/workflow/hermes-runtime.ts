import { Sandbox } from "@vercel/sandbox";

import { createAdminClient } from "@/lib/supabase/admin";

const HERMES_RELEASE = "v2026.9.14";
const HERMES_BASE_NAME = "cooperative-hermes-runtime-v2026-9-14";
const HERMES_INSTALL_URL =
  "https://raw.githubusercontent.com/NousResearch/hermes-agent/v2026.9.14/scripts/install.sh";

type ProgressStage =
  | "preparing_runtime"
  | "starting_hermes"
  | "executing_check"
  | "verifying"
  | "completed"
  | "failed";

interface HermesRuntimeWorkflowInput {
  taskId: string;
  organizationId: string;
}

interface RuntimeCheckEvidence {
  baseRuntimeName: string;
  baseCreated: boolean;
  forkSandboxName: string;
  hermesVersion: string;
  promptSizeOutput: string;
  durationMs: number;
}

async function mergeTaskResult(
  taskId: string,
  organizationId: string,
  patch: Record<string, unknown>,
) {
  "use step";

  const admin = createAdminClient();
  const { data: task, error: taskError } = await admin
    .from("operative_tasks")
    .select("result")
    .eq("id", taskId)
    .eq("organization_id", organizationId)
    .single();

  if (taskError) throw taskError;

  const current =
    task.result && typeof task.result === "object" && !Array.isArray(task.result)
      ? (task.result as Record<string, unknown>)
      : {};

  const next = { ...current, ...patch };

  const { error: updateError } = await admin
    .from("operative_tasks")
    .update({
      result: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .eq("organization_id", organizationId);

  if (updateError) throw updateError;
}

async function recordProgress(
  taskId: string,
  organizationId: string,
  stage: ProgressStage,
  detail: Record<string, unknown> = {},
) {
  "use step";

  const admin = createAdminClient();
  const now = new Date().toISOString();

  const { data: task, error: taskError } = await admin
    .from("operative_tasks")
    .select("result")
    .eq("id", taskId)
    .eq("organization_id", organizationId)
    .single();

  if (taskError) throw taskError;

  const current =
    task.result && typeof task.result === "object" && !Array.isArray(task.result)
      ? (task.result as Record<string, unknown>)
      : {};

  const next = {
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
    .update({
      result: next,
      updated_at: now,
    })
    .eq("id", taskId)
    .eq("organization_id", organizationId);

  if (updateError) throw updateError;

  const { error: eventError } = await admin.from("task_events").insert({
    task_id: taskId,
    organization_id: organizationId,
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

async function ensurePreparedHermesRuntime(): Promise<{
  baseRuntimeName: string;
  created: boolean;
}> {
  "use step";

  try {
    await Sandbox.get({ name: HERMES_BASE_NAME, resume: false });
    return {
      baseRuntimeName: HERMES_BASE_NAME,
      created: false,
    };
  } catch {
    // The versioned base runtime does not exist yet. Prepare it once with an
    // explicit session timeout long enough for a cold Hermes installation.
  }

  const base = await Sandbox.create({
    name: HERMES_BASE_NAME,
    persistent: true,
    timeout: 15 * 60 * 1000,
    snapshotExpiration: 30 * 24 * 60 * 60 * 1000,
  });

  try {
    const install = await base.runCommand("bash", [
      "-lc",
      `curl -fsSL ${HERMES_INSTALL_URL} -o /tmp/hermes-install.sh && bash /tmp/hermes-install.sh --skip-setup --skip-browser --skip-computer-use --non-interactive --branch ${HERMES_RELEASE}`,
    ]);

    if (install.exitCode !== 0) {
      const stderr = await install.stderr();
      throw new Error(
        "Prepared Hermes runtime installation failed: " + stderr.slice(-2000),
      );
    }

    const verify = await base.runCommand("bash", [
      "-lc",
      'HERMES_BIN="$HOME/.local/bin/hermes"; [ -x "$HERMES_BIN" ] || HERMES_BIN=/usr/local/bin/hermes; "$HERMES_BIN" --version',
    ]);

    if (verify.exitCode !== 0) {
      const stderr = await verify.stderr();
      throw new Error(
        "Prepared Hermes runtime verification failed: " + stderr.slice(-2000),
      );
    }

    const manifest = await base.runCommand("bash", [
      "-lc",
      `mkdir -p /tmp/cooperative-runtime && printf '%s\n' '{"hermesRelease":"${HERMES_RELEASE}","prepared":true}' > /tmp/cooperative-runtime/manifest.json`,
    ]);

    if (manifest.exitCode !== 0) {
      const stderr = await manifest.stderr();
      throw new Error(
        "Prepared Hermes runtime manifest write failed: " + stderr.slice(-2000),
      );
    }

    await base.stop();

    return {
      baseRuntimeName: HERMES_BASE_NAME,
      created: true,
    };
  } catch (error) {
    await base.delete().catch(() => undefined);
    throw error;
  }
}

async function runRuntimeCheckFromPreparedBase(
  baseRuntimeName: string,
): Promise<RuntimeCheckEvidence> {
  "use step";

  const startedAt = Date.now();
  const sandbox = await Sandbox.fork({
    sourceSandbox: baseRuntimeName,
    persistent: false,
  });

  try {
    const version = await sandbox.runCommand("bash", [
      "-lc",
      'HERMES_BIN="$HOME/.local/bin/hermes"; [ -x "$HERMES_BIN" ] || HERMES_BIN=/usr/local/bin/hermes; "$HERMES_BIN" --version',
    ]);

    const hermesVersion = (await version.stdout()).trim();
    if (version.exitCode !== 0 || !hermesVersion) {
      const stderr = await version.stderr();
      throw new Error(
        "Prepared Hermes runtime version check failed: " + stderr.slice(-2000),
      );
    }

    const promptSize = await sandbox.runCommand("bash", [
      "-lc",
      'HERMES_BIN="$HOME/.local/bin/hermes"; [ -x "$HERMES_BIN" ] || HERMES_BIN=/usr/local/bin/hermes; "$HERMES_BIN" prompt-size --json',
    ]);

    const promptSizeOutput = (await promptSize.stdout()).trim();
    if (promptSize.exitCode !== 0 || !promptSizeOutput) {
      const stderr = await promptSize.stderr();
      throw new Error(
        "Prepared Hermes prompt-size check failed: " + stderr.slice(-2000),
      );
    }

    return {
      baseRuntimeName,
      baseCreated: false,
      forkSandboxName: sandbox.name,
      hermesVersion,
      promptSizeOutput: promptSizeOutput.slice(-4000),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await sandbox.stop();
  }
}

async function finalizeHermesRuntimeSuccess(
  input: HermesRuntimeWorkflowInput,
  evidence: RuntimeCheckEvidence,
  baseCreated: boolean,
) {
  "use step";

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const result = {
    executionMode: "workflow",
    progress: {
      stage: "completed",
      at: now,
    },
    workflow: "hermes-runtime-check",
    preparedRuntime: {
      name: evidence.baseRuntimeName,
      createdThisRun: baseCreated,
      release: HERMES_RELEASE,
    },
    evidence: {
      forkSandboxName: evidence.forkSandboxName,
      hermesVersion: evidence.hermesVersion,
      promptSizeOutput: evidence.promptSizeOutput,
      durationMs: evidence.durationMs,
    },
  };

  const { error: verifyingError } = await admin
    .from("operative_tasks")
    .update({
      status: "verifying",
      result,
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
      verification: "Prepared Hermes runtime executed from a forked Sandbox snapshot.",
      preparedRuntime: evidence.baseRuntimeName,
    },
  });

  const { error: completedError } = await admin
    .from("operative_tasks")
    .update({
      status: "completed",
      result,
      actual_spend_microunits: 0,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.taskId)
    .eq("organization_id", input.organizationId)
    .eq("status", "verifying");

  if (completedError) throw completedError;

  await admin.from("task_events").insert({
    task_id: input.taskId,
    organization_id: input.organizationId,
    event_type: "status_changed",
    from_status: "verifying",
    to_status: "completed",
    actor: "system",
    detail: {
      verification: "Workflow-backed Cloud Hermes runtime check completed.",
      marginalCashCostMicrounits: 0,
    },
  });

  await admin.from("cost_ledger_entries").insert({
    organization_id: input.organizationId,
    task_id: input.taskId,
    executor: "vercel-sandbox",
    cost_category: "sandbox-compute",
    amount_microunits: 0,
    currency: "USD",
    is_marginal_cost: true,
    notes:
      "Workflow-backed Hermes runtime check completed with $0 direct task cash cost; allocated Sandbox/Workflow platform usage remains a separate economics item.",
  });
}

async function finalizeHermesRuntimeFailure(
  input: HermesRuntimeWorkflowInput,
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
      message,
      stage: "workflow_hermes_runtime",
    },
  });
}

export async function hermesRuntimeWorkflow(
  input: HermesRuntimeWorkflowInput,
): Promise<{ ok: true; evidence: RuntimeCheckEvidence }> {
  "use workflow";

  try {
    await recordProgress(input.taskId, input.organizationId, "preparing_runtime", {
      runtimeName: HERMES_BASE_NAME,
      release: HERMES_RELEASE,
    });

    const prepared = await ensurePreparedHermesRuntime();

    await mergeTaskResult(input.taskId, input.organizationId, {
      preparedRuntime: {
        name: prepared.baseRuntimeName,
        createdThisRun: prepared.created,
        release: HERMES_RELEASE,
      },
    });

    await recordProgress(input.taskId, input.organizationId, "starting_hermes", {
      runtimeName: prepared.baseRuntimeName,
      reusedSnapshot: !prepared.created,
    });

    await recordProgress(input.taskId, input.organizationId, "executing_check");

    const evidence = await runRuntimeCheckFromPreparedBase(prepared.baseRuntimeName);
    evidence.baseCreated = prepared.created;

    await recordProgress(input.taskId, input.organizationId, "verifying", {
      hermesVersion: evidence.hermesVersion,
    });

    await finalizeHermesRuntimeSuccess(input, evidence, prepared.created);

    return { ok: true, evidence };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow-backed Hermes runtime check failed.";

    await finalizeHermesRuntimeFailure(input, message);
    throw error;
  }
}
