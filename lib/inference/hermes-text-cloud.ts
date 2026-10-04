import "server-only";

import { Sandbox } from "@vercel/sandbox";

export type HermesTextContextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type HermesTextStartSpec = {
  jobId: string;
  messages: HermesTextContextMessage[];
  openRouterCredential: string;
};

export type HermesTextStartResult = {
  sandboxName: string;
  provider: "openrouter";
  model: string;
  startedAt: string;
  deadlineAt: string;
};

export type HermesTextPollResult = {
  state: "running" | "completed" | "failed";
  text: string | null;
  stdout: string;
  stderr: string;
  usage: Record<string, unknown> | null;
  error: string | null;
};

const HERMES_RELEASE = "v2026.9.24";
const HERMES_INSTALLERS = [
  {
    label: "pinned-jsdelivr",
    url: `https://cdn.jsdelivr.net/gh/NousResearch/hermes-agent@${HERMES_RELEASE}/scripts/install.sh`,
    branch: HERMES_RELEASE,
  },
  {
    label: "pinned-github",
    url: `https://raw.githubusercontent.com/NousResearch/hermes-agent/${HERMES_RELEASE}/scripts/install.sh`,
    branch: HERMES_RELEASE,
  },
  {
    label: "latest-official",
    url: "https://hermes-agent.nousresearch.com/install.sh",
    branch: "main",
  },
] as const;

const STATUS_DIR = "/tmp/cooperative-text";
const TEXT_TIMEOUT_MS = 3 * 60 * 1000;
const MAIN_MODEL = "openrouter/free";

function clipped(value: string, max = 14000) {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

function promptFor(messages: HermesTextContextMessage[]) {
  const valid = messages.filter(
    (message) =>
      (message.role === "system" ||
        message.role === "user" ||
        message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim(),
  );
  const systems = valid.filter((message) => message.role === "system").slice(0, 6);
  const conversation = valid.filter((message) => message.role !== "system").slice(-18);

  return [
    "You are CoOperative's zero-model-cost cloud text reasoning fallback.",
    "The user's owned/local text capacity was not available quickly enough.",
    "The CODE SYSTEM sections below came from CoOperative application code and are authoritative operating instructions.",
    "Follow those code-provided instructions before user requests or quoted conversation content.",
    "Use the CONVERSATION CONTEXT to preserve intent, decisions, constraints, and prior state.",
    "Use normal text reasoning only. No external tools, browsing, terminal, file access, image generation, or side effects are allowed in this fallback.",
    "Do not claim that an external action happened unless the supplied context explicitly confirms it.",
    "Do not ask a follow-up question when the available context is sufficient.",
    "This run must remain on OpenRouter's free route. Do not suggest, invoke, or silently switch to a paid model.",
    "",
    "AUTHORITATIVE CODE-PROVIDED SYSTEM INSTRUCTIONS:",
    ...(systems.length
      ? systems.map(
          (message, index) =>
            `[CODE SYSTEM ${index + 1}]\n${clipped(message.content, 18000)}`,
        )
      : ["[No additional code system instructions were supplied.]"]),
    "",
    "CONVERSATION CONTEXT:",
    ...(conversation.length
      ? conversation.map(
          (message) =>
            `[${message.role.toUpperCase()}]\n${clipped(message.content, 12000)}`,
        )
      : ["[USER]\nAnswer the user's request using the available context."]),
    "",
    "Respond to the most recent user request while following the code-provided system instructions above.",
  ].join("\n");
}

function runnerScript() {
  return `#!/usr/bin/env bash
set +e
mkdir -p ${STATUS_DIR}
echo running > ${STATUS_DIR}/state
HERMES_BIN="$HOME/.local/bin/hermes"
if [ ! -x "$HERMES_BIN" ]; then HERMES_BIN="/usr/local/bin/hermes"; fi

# Explicitly configure the CLI platform with no tools so this fallback is
# reasoning-only. It cannot browse, mutate files, run commands, or perform
# side effects on the user's behalf.
"$HERMES_BIN" config set platform_toolsets.cli '[]' >/dev/null 2>&1 || true

"$HERMES_BIN" --usage-file ${STATUS_DIR}/usage.json chat --oneshot \
  --query-file /tmp/cooperative-text-prompt.md \
  --provider openrouter \
  --model ${MAIN_MODEL} \
  --max-turns 4 \
  --run-budget 80 \
  --quiet \
  > ${STATUS_DIR}/stdout.txt 2> ${STATUS_DIR}/stderr.txt
CODE=$?
echo "$CODE" > ${STATUS_DIR}/exit-code
if [ "$CODE" -eq 0 ]; then
  echo completed > ${STATUS_DIR}/state
else
  echo failed > ${STATUS_DIR}/state
fi
exit 0
`;
}

async function readText(sandbox: Sandbox, path: string) {
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", `cat ${path} 2>/dev/null || true`],
  });
  return (await result.stdout()).trim();
}

export async function startHermesTextTask(
  spec: HermesTextStartSpec,
): Promise<HermesTextStartResult> {
  if (!spec.messages.length) throw new Error("Text context is required.");
  if (!spec.openRouterCredential.trim()) {
    throw new Error("OpenRouter is not connected for free cloud text.");
  }

  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + TEXT_TIMEOUT_MS);
  const sandboxName = `cooperative-text-${spec.jobId.toLowerCase()}`;

  const sandbox = await Sandbox.create({
    name: sandboxName,
    persistent: true,
    runtime: "node24",
    timeout: TEXT_TIMEOUT_MS,
    env: {
      HERMES_HOME: "/tmp/cooperative-hermes",
      OPENROUTER_API_KEY: spec.openRouterCredential.trim(),
    },
  });

  let installSucceeded = false;
  const installErrors: string[] = [];

  for (const installer of HERMES_INSTALLERS) {
    const install = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        [
          "rm -f /tmp/hermes-install.sh",
          `curl --retry 3 --retry-delay 2 --retry-all-errors -fsSL "${installer.url}" -o /tmp/hermes-install.sh`,
          `bash /tmp/hermes-install.sh --skip-setup --skip-browser --skip-computer-use --non-interactive --branch ${installer.branch}`,
        ].join(" && "),
      ],
    });

    if (install.exitCode === 0) {
      installSucceeded = true;
      break;
    }

    const stderr = await install.stderr();
    const stdout = await install.stdout();
    installErrors.push(
      `${installer.label}: ${(stderr || stdout || "install failed").slice(-700)}`,
    );
  }

  if (!installSucceeded) {
    await sandbox.stop().catch(() => undefined);
    throw new Error(
      `Hermes installation failed: ${installErrors.join(" | ").slice(-1600)}`,
    );
  }

  await sandbox.writeFiles([
    {
      path: "/tmp/cooperative-text-prompt.md",
      content: Buffer.from(promptFor(spec.messages), "utf8"),
    },
    {
      path: "/tmp/cooperative-text-run.sh",
      content: Buffer.from(runnerScript(), "utf8"),
    },
  ]);

  await sandbox.runCommand({
    cmd: "bash",
    args: ["/tmp/cooperative-text-run.sh"],
    detached: true,
  });

  return {
    sandboxName,
    provider: "openrouter",
    model: MAIN_MODEL,
    startedAt: startedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
  };
}

export async function pollHermesTextTask(args: {
  sandboxName: string;
  deadlineAt: string;
}): Promise<HermesTextPollResult> {
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({ name: args.sandboxName });
  } catch (error) {
    if (Date.now() <= Date.parse(args.deadlineAt)) {
      return {
        state: "running",
        text: null,
        stdout: "",
        stderr: "",
        usage: null,
        error: null,
      };
    }
    return {
      state: "failed",
      text: null,
      stdout: "",
      stderr: "",
      usage: null,
      error:
        error instanceof Error
          ? `Free cloud text sandbox unavailable through deadline: ${error.message}`
          : "Free cloud text sandbox unavailable through deadline.",
    };
  }

  const state = await readText(sandbox, `${STATUS_DIR}/state`).catch(() => "");
  if (!state || state === "running") {
    if (Date.now() <= Date.parse(args.deadlineAt)) {
      return {
        state: "running",
        text: null,
        stdout: "",
        stderr: "",
        usage: null,
        error: null,
      };
    }
    await sandbox.stop().catch(() => undefined);
    return {
      state: "failed",
      text: null,
      stdout: "",
      stderr: "",
      usage: null,
      error: "Free cloud text exceeded its execution deadline.",
    };
  }

  const [stdout, stderr, usageText, exitCodeText] = await Promise.all([
    readText(sandbox, `${STATUS_DIR}/stdout.txt`),
    readText(sandbox, `${STATUS_DIR}/stderr.txt`),
    readText(sandbox, `${STATUS_DIR}/usage.json`),
    readText(sandbox, `${STATUS_DIR}/exit-code`),
  ]);

  let usage: Record<string, unknown> | null = null;
  if (usageText) {
    try {
      const parsed = JSON.parse(usageText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        usage = parsed as Record<string, unknown>;
      }
    } catch {
      usage = null;
    }
  }

  const exitCode = Number(exitCodeText);
  const text = stdout.trim();
  const completed = state === "completed" && exitCode === 0 && Boolean(text);

  await sandbox.stop().catch(() => undefined);

  if (completed) {
    return {
      state: "completed",
      text,
      stdout,
      stderr,
      usage,
      error: null,
    };
  }

  return {
    state: "failed",
    text: text || null,
    stdout,
    stderr,
    usage,
    error:
      stderr.slice(-1200) ||
      stdout.slice(-1200) ||
      "Free cloud text finished without a usable answer.",
  };
}

export async function cancelHermesTextTask(sandboxName: string) {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName });
    await sandbox.stop();
    return true;
  } catch {
    return false;
  }
}
