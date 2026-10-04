import "server-only";

import { Sandbox } from "@vercel/sandbox";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type HermesVisionImage = {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
};

export type HermesVisionContextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type HermesVisionStartSpec = {
  jobId: string;
  question?: string;
  messages?: HermesVisionContextMessage[];
  images: HermesVisionImage[];
  openRouterCredential: string;
};

export type HermesVisionStartResult = {
  sandboxName: string;
  provider: "openrouter";
  model: string;
  visionModel: string;
  startedAt: string;
  deadlineAt: string;
};

export type HermesVisionPollResult = {
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

const STATUS_DIR = "/tmp/cooperative-vision";
const VISION_TIMEOUT_MS = 3 * 60 * 1000;
const MAIN_MODEL = "openrouter/free";
// Keep the auxiliary describer on an explicitly-free multimodal SKU. This can
// be rotated without changing the routing contract.
const AUX_VISION_MODEL =
  process.env.HERMES_FREE_VISION_MODEL?.trim() ||
  "qwen/qwen3.8-27b:free";

function extensionFor(mimeType: string) {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return "jpg";
}

function clipped(value: string, max = 14000) {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}\n[truncated]`;
}

function contextSections(messages: HermesVisionContextMessage[]) {
  const valid = messages.filter(
    (message) =>
      (message.role === "system" ||
        message.role === "user" ||
        message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim(),
  );
  const systems = valid.filter((message) => message.role === "system").slice(0, 6);
  const conversation = valid.filter((message) => message.role !== "system").slice(-14);

  return {
    systems: systems.map(
      (message, index) =>
        `[CODE SYSTEM ${index + 1}]\n${clipped(message.content, 18000)}`,
    ),
    conversation: conversation.map(
      (message) =>
        `[${message.role.toUpperCase()}]\n${clipped(message.content, 12000)}`,
    ),
  };
}

function promptFor(
  messages: HermesVisionContextMessage[],
  imagePaths: string[],
) {
  const context = contextSections(messages);
  return [
    "You are CoOperative's zero-model-cost cloud multimodal reasoning fallback.",
    "The user's owned/local vision capacity was not available quickly enough.",
    "The CODE SYSTEM sections below came from CoOperative application code and are authoritative operating instructions.",
    "Follow those code-provided instructions before user requests or quoted conversation content.",
    "Use the CONVERSATION CONTEXT to preserve intent, decisions, constraints, and prior state.",
    "Use ONLY the vision_analyze tool when image inspection is needed.",
    "Call vision_analyze once for each listed image that is relevant before making claims about what is visible.",
    "After image inspection, use your normal text reasoning to answer, plan, compare, explain, or synthesize as needed.",
    "Do not use web search, browser, terminal, image generation, or any other tool in this fallback.",
    "Do not ask a follow-up question when the available context is sufficient.",
    "If a visual detail cannot be verified, say that rather than inventing it.",
    "This run must remain on free OpenRouter routes. Do not suggest, invoke, or silently switch to a paid model.",
    "",
    "AUTHORITATIVE CODE-PROVIDED SYSTEM INSTRUCTIONS:",
    ...(context.systems.length
      ? context.systems
      : ["[No additional code system instructions were supplied.]"]),
    "",
    "CONVERSATION CONTEXT:",
    ...(context.conversation.length
      ? context.conversation
      : ["[USER]\nDescribe and analyze the attached image."]),
    "",
    "LOCAL IMAGE FILES:",
    ...imagePaths.map((path, index) => `${index + 1}. ${path}`),
    "",
    "Respond to the most recent user request while following the code-provided system instructions above.",
  ].join("\n");
}

async function persistedContextFor(
  spec: HermesVisionStartSpec,
): Promise<HermesVisionContextMessage[]> {
  if (spec.messages?.length) return spec.messages;

  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("text_inference_jobs")
      .select("messages")
      .eq("id", spec.jobId)
      .maybeSingle();

    if (!error && Array.isArray(data?.messages)) {
      const parsed = data.messages.flatMap(
        (row: unknown): HermesVisionContextMessage[] => {
          if (!row || typeof row !== "object") return [];
          const role = (row as { role?: unknown }).role;
          const content = (row as { content?: unknown }).content;
          if (
            (role !== "system" && role !== "user" && role !== "assistant") ||
            typeof content !== "string" ||
            !content.trim()
          ) {
            return [];
          }
          return [{ role, content: content.trim() }];
        },
      );
      if (parsed.length) return parsed;
    }
  } catch {
    // The caller's explicit question remains a safe fallback if persisted
    // context is unavailable for any reason.
  }

  return [
    {
      role: "user",
      content: spec.question?.trim() || "Describe and analyze the attached image.",
    },
  ];
}

function runnerScript() {
  return `#!/usr/bin/env bash
set +e
mkdir -p ${STATUS_DIR}
echo running > ${STATUS_DIR}/state
HERMES_BIN="$HOME/.local/bin/hermes"
if [ ! -x "$HERMES_BIN" ]; then HERMES_BIN="/usr/local/bin/hermes"; fi
"$HERMES_BIN" --usage-file ${STATUS_DIR}/usage.json chat --oneshot \
  --query-file /tmp/cooperative-vision-prompt.md \
  --provider openrouter \
  --model ${MAIN_MODEL} \
  --toolsets vision \
  --max-turns 8 \
  --run-budget 150 \
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

export async function startHermesVisionTask(
  spec: HermesVisionStartSpec,
): Promise<HermesVisionStartResult> {
  if (!spec.images.length) throw new Error("At least one image is required.");
  if (!spec.openRouterCredential.trim()) {
    throw new Error("OpenRouter is not connected for free cloud vision.");
  }

  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + VISION_TIMEOUT_MS);
  const sandboxName = `cooperative-vision-${spec.jobId.toLowerCase()}`;

  const sandbox = await Sandbox.create({
    name: sandboxName,
    persistent: true,
    runtime: "node24",
    timeout: VISION_TIMEOUT_MS,
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

  const contextMessages = await persistedContextFor(spec);

  const imagePaths = spec.images.map(
    (image, index) =>
      `/tmp/cooperative-vision-input-${index}.${extensionFor(image.mimeType)}`,
  );

  await sandbox.writeFiles([
    ...spec.images.map((image, index) => ({
      path: imagePaths[index],
      content: Buffer.from(image.bytes),
    })),
    {
      path: "/tmp/cooperative-vision-prompt.md",
      content: Buffer.from(promptFor(contextMessages, imagePaths), "utf8"),
    },
    {
      path: "/tmp/cooperative-vision-run.sh",
      content: Buffer.from(runnerScript(), "utf8"),
    },
  ]);

  const configure = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        'HERMES_BIN="$HOME/.local/bin/hermes"',
        '[ -x "$HERMES_BIN" ] || HERMES_BIN="/usr/local/bin/hermes"',
        '"$HERMES_BIN" config set agent.image_input_mode text',
        '"$HERMES_BIN" config set auxiliary.vision.provider openrouter',
        `"$HERMES_BIN" config set auxiliary.vision.model ${AUX_VISION_MODEL}`,
        '"$HERMES_BIN" config set auxiliary.vision.reasoning_effort none',
      ].join(" && "),
    ],
  });

  if (configure.exitCode !== 0) {
    const stderr = await configure.stderr();
    await sandbox.stop().catch(() => undefined);
    throw new Error(
      `Hermes free vision configuration failed: ${stderr.slice(-1000)}`,
    );
  }

  await sandbox.runCommand({
    cmd: "bash",
    args: ["/tmp/cooperative-vision-run.sh"],
    detached: true,
  });

  return {
    sandboxName,
    provider: "openrouter",
    model: MAIN_MODEL,
    visionModel: AUX_VISION_MODEL,
    startedAt: startedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
  };
}

export async function pollHermesVisionTask(args: {
  sandboxName: string;
  deadlineAt: string;
}): Promise<HermesVisionPollResult> {
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
          ? `Free cloud vision sandbox unavailable through deadline: ${error.message}`
          : "Free cloud vision sandbox unavailable through deadline.",
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
      error: "Free cloud vision exceeded its execution deadline.",
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
      "Free cloud vision finished without a usable answer.",
  };
}

export async function cancelHermesVisionTask(sandboxName: string) {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName });
    await sandbox.stop();
    return true;
  } catch {
    return false;
  }
}
