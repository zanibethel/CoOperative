import "server-only";

import { Sandbox } from "@vercel/sandbox";

export type HermesMediaKind = "image" | "video";

export type HermesMediaStartSpec = {
  jobId: string;
  kind: HermesMediaKind;
  userRequest: string;
  provider?: string;
  model?: string;
  providerCredential?: string;
  nousAuthJson?: string;
  orchestratorProvider?: string;
  orchestratorModel?: string;
};

export type HermesMediaStartResult = {
  sandboxName: string;
  provider: string;
  model: string;
  orchestratorProvider: string;
  orchestratorModel: string;
  startedAt: string;
  deadlineAt: string;
};

export type HermesMediaPollResult = {
  state: "running" | "completed" | "failed";
  mediaUrl: string | null;
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
const STATUS_DIR = "/tmp/cooperative-media";
const IMAGE_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_TIMEOUT_MS = 15 * 60 * 1000;

function safeIdentifier(value: string, label: string) {
  if (!/^[a-z0-9_.:/-]+$/i.test(value)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return value;
}

export function hermesMediaConfiguration(
  kind: HermesMediaKind,
  override?: { provider?: string; model?: string },
) {
  const provider = safeIdentifier(
    override?.provider?.trim() ||
      (kind === "image"
        ? process.env.HERMES_IMAGE_PROVIDER
        : process.env.HERMES_VIDEO_PROVIDER
      )?.trim() ||
      "openrouter",
    "Media provider",
  );
  const model = safeIdentifier(
    override?.model?.trim() ||
      (kind === "image"
        ? process.env.HERMES_IMAGE_MODEL
        : process.env.HERMES_VIDEO_MODEL
      )?.trim() ||
      (kind === "image"
        ? "inclusionai/ming-image-0.1-design"
        : "bytedance/seedance-2.0-fast:free"),
    "Media model",
  );
  const legacyNousConfigured = Boolean(process.env.NOUS_API_KEY?.trim());
  const orchestratorProvider = safeIdentifier(
    process.env.HERMES_CLOUD_PROVIDER?.trim() ||
      (legacyNousConfigured ? "nous" : "openrouter"),
    "Hermes orchestrator provider",
  );
  const orchestratorModel = safeIdentifier(
    process.env.HERMES_CLOUD_MODEL?.trim() ||
      (orchestratorProvider === "nous"
        ? "poolside/laguna-s-2.1:free"
        : "openrouter/free"),
    "Hermes orchestrator model",
  );

  return {
    provider,
    model,
    orchestratorProvider,
    orchestratorModel,
    freeRoute: model.endsWith(":free"),
  };
}

export function hermesMediaProviderStatus() {
  const image = hermesMediaConfiguration("image");
  const video = hermesMediaConfiguration("video");

  return {
    nousConfigured: Boolean(process.env.NOUS_API_KEY?.trim()),
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    orchestratorProvider: image.orchestratorProvider,
    orchestratorModel: image.orchestratorModel,
    image,
    video,
  };
}

function promptFor(spec: HermesMediaStartSpec) {
  const tool = spec.kind === "image" ? "image_generate" : "video_generate";

  return [
    "You are CoOperative's media production worker.",
    "Convert the user's request into the strongest production-ready generation prompt you can before spending media-generation compute.",
    `You MUST call the ${tool} tool exactly once.`,
    "Do not ask the user a follow-up question; CoOperative has already handled clarification.",
    "Do not retry a failed generation and do not call a second image/video model.",
    "Honor explicit duration, aspect ratio, platform, style, camera, audio, and subject requirements in the request.",
    "After the tool succeeds, answer briefly and include the returned media URL using the exact prefix MEDIA:.",
    "If the tool fails, report the failure concisely and stop.",
    "",
    "USER REQUEST:",
    spec.userRequest.trim(),
  ].join("\n");
}

function runnerScript(args: {
  kind: HermesMediaKind;
  orchestratorProvider: string;
  orchestratorModel: string;
}) {
  const toolset = args.kind === "image" ? "image_gen" : "video_gen";
  return `#!/usr/bin/env bash
set +e
mkdir -p ${STATUS_DIR}
echo running > ${STATUS_DIR}/state
HERMES_BIN="$HOME/.local/bin/hermes"
if [ ! -x "$HERMES_BIN" ]; then HERMES_BIN="/usr/local/bin/hermes"; fi
"$HERMES_BIN" --usage-file ${STATUS_DIR}/usage.json chat --oneshot \
  --query-file /tmp/cooperative-media-prompt.md \
  --provider ${args.orchestratorProvider} \
  --model ${args.orchestratorModel} \
  --max-turns 8 \
  --run-budget 840 \
  --toolsets ${toolset} \
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

function extractMediaUrl(stdout: string) {
  const mediaMatches = [...stdout.matchAll(/MEDIA:\s*(https?:\/\/\S+)/gi)];
  const media = mediaMatches.at(-1)?.[1];
  if (media) return media.replace(/[)\]}>.,]+$/, "");

  const urls = [...stdout.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) => match[0]);
  const likelyMedia = urls
    .filter((url) => /\.(?:png|jpe?g|webp|gif|mp4|webm)(?:\?|$)/i.test(url))
    .at(-1);
  return likelyMedia?.replace(/[)\]}>.,]+$/, "") || null;
}

export async function startHermesMediaTask(
  spec: HermesMediaStartSpec,
): Promise<HermesMediaStartResult> {
  if (!spec.userRequest.trim()) throw new Error("A media request is required.");

  const baseConfig = hermesMediaConfiguration(spec.kind, {
    provider: spec.provider,
    model: spec.model,
  });
  const orchestratorProvider = safeIdentifier(
    spec.orchestratorProvider?.trim() ||
      (spec.nousAuthJson ? "nous" : baseConfig.orchestratorProvider),
    "Hermes orchestrator provider",
  );
  const orchestratorModel = safeIdentifier(
    spec.orchestratorModel?.trim() ||
      (spec.nousAuthJson && !process.env.HERMES_CLOUD_MODEL?.trim()
        ? "poolside/laguna-s-2.1:free"
        : baseConfig.orchestratorModel),
    "Hermes orchestrator model",
  );
  const config = {
    ...baseConfig,
    orchestratorProvider,
    orchestratorModel,
  };

  const env: Record<string, string> = {
    HERMES_HOME: "/tmp/cooperative-hermes",
  };
  const nousApiKey = process.env.NOUS_API_KEY?.trim();
  if (nousApiKey) env.NOUS_API_KEY = nousApiKey;

  if (config.provider === "openrouter" || config.orchestratorProvider === "openrouter") {
    const credential =
      spec.providerCredential?.trim() || process.env.OPENROUTER_API_KEY?.trim();
    if (!credential) {
      throw new Error(
        "OpenRouter is not connected. Connect an OpenRouter API key in CoOperative Services.",
      );
    }
    env.OPENROUTER_API_KEY = credential;
  }

  if (
    config.provider !== "openrouter" &&
    config.provider !== "nous"
  ) {
    throw new Error(
      `Media provider ${config.provider} is not enabled for this CoOperative media job.`,
    );
  }

  if (
    (config.orchestratorProvider === "nous" || config.provider === "nous") &&
    !spec.nousAuthJson &&
    !nousApiKey
  ) {
    throw new Error(
      "Nous Portal is selected for Hermes orchestration but is not connected to this CoOperative profile.",
    );
  }

  const timeoutMs = spec.kind === "image" ? IMAGE_TIMEOUT_MS : VIDEO_TIMEOUT_MS;
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + timeoutMs);
  const sandboxName = `cooperative-media-${spec.jobId.toLowerCase()}`;

  const sandbox = await Sandbox.create({
    name: sandboxName,
    persistent: true,
    runtime: "node24",
    timeout: timeoutMs,
    env,
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
    await sandbox.stop();
    throw new Error(
      `Hermes installation failed after pinned stable + official fallback: ${installErrors.join(" | ").slice(-1600)}`,
    );
  }

  if (spec.nousAuthJson) {
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "mkdir -p /tmp/cooperative-hermes && chmod 700 /tmp/cooperative-hermes"],
    });
    await sandbox.writeFiles([
      {
        path: "/tmp/cooperative-hermes/auth.json",
        content: Buffer.from(spec.nousAuthJson, "utf8"),
      },
    ]);
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "chmod 600 /tmp/cooperative-hermes/auth.json"],
    });
  }

  const category = spec.kind === "image" ? "image_gen" : "video_gen";
  const configure = await sandbox.runCommand({
    cmd: "bash",
    args: [
      "-lc",
      [
        'HERMES_BIN="$HOME/.local/bin/hermes"',
        '[ -x "$HERMES_BIN" ] || HERMES_BIN="/usr/local/bin/hermes"',
        `"$HERMES_BIN" config set ${category}.provider ${config.provider}`,
        `"$HERMES_BIN" config set ${category}.model ${config.model}`,
      ].join(" && "),
    ],
  });
  if (configure.exitCode !== 0) {
    const stderr = await configure.stderr();
    await sandbox.stop();
    throw new Error(`Hermes media provider configuration failed: ${stderr.slice(-800)}`);
  }

  await sandbox.writeFiles([
    {
      path: "/tmp/cooperative-media-prompt.md",
      content: Buffer.from(promptFor(spec), "utf8"),
    },
    {
      path: "/tmp/cooperative-media-run.sh",
      content: Buffer.from(
        runnerScript({
          kind: spec.kind,
          orchestratorProvider: config.orchestratorProvider,
          orchestratorModel: config.orchestratorModel,
        }),
        "utf8",
      ),
    },
  ]);

  await sandbox.runCommand({
    cmd: "bash",
    args: ["/tmp/cooperative-media-run.sh"],
    detached: true,
  });

  return {
    sandboxName,
    provider: config.provider,
    model: config.model,
    orchestratorProvider: config.orchestratorProvider,
    orchestratorModel: config.orchestratorModel,
    startedAt: startedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
  };
}

export async function pollHermesMediaTask(args: {
  sandboxName: string;
  deadlineAt: string;
}): Promise<HermesMediaPollResult> {
  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.get({ name: args.sandboxName });
  } catch (error) {
    const beforeDeadline = Date.now() <= Date.parse(args.deadlineAt);
    if (beforeDeadline) {
      return {
        state: "running",
        mediaUrl: null,
        stdout: "",
        stderr: "",
        usage: null,
        error: null,
      };
    }

    return {
      state: "failed",
      mediaUrl: null,
      stdout: "",
      stderr: "",
      usage: null,
      error:
        error instanceof Error
          ? `Hermes media sandbox remained unavailable through its deadline: ${error.message}`
          : "Hermes media sandbox remained unavailable through its deadline.",
    };
  }

  let state: string;
  try {
    state = await readText(sandbox, `${STATUS_DIR}/state`);
  } catch (error) {
    if (Date.now() <= Date.parse(args.deadlineAt)) {
      return {
        state: "running",
        mediaUrl: null,
        stdout: "",
        stderr: "",
        usage: null,
        error: null,
      };
    }

    await sandbox.stop().catch(() => undefined);
    return {
      state: "failed",
      mediaUrl: null,
      stdout: "",
      stderr: "",
      usage: null,
      error:
        error instanceof Error
          ? `Hermes media status remained unreadable through its deadline: ${error.message}`
          : "Hermes media status remained unreadable through its deadline.",
    };
  }

  if (!state || state === "running") {
    if (Date.now() <= Date.parse(args.deadlineAt)) {
      return {
        state: "running",
        mediaUrl: null,
        stdout: "",
        stderr: "",
        usage: null,
        error: null,
      };
    }

    await sandbox.stop();
    return {
      state: "failed",
      mediaUrl: null,
      stdout: "",
      stderr: "",
      usage: null,
      error: "Hermes media generation exceeded its execution deadline.",
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
  const mediaUrl = extractMediaUrl(stdout);
  const completed = state === "completed" && exitCode === 0 && Boolean(mediaUrl);

  await sandbox.stop();

  if (completed) {
    return {
      state: "completed",
      mediaUrl,
      stdout,
      stderr,
      usage,
      error: null,
    };
  }

  return {
    state: "failed",
    mediaUrl,
    stdout,
    stderr,
    usage,
    error:
      stderr.slice(-1000) ||
      stdout.slice(-1000) ||
      "Hermes media generation finished without a usable media URL.",
  };
}


export async function cancelHermesMediaTask(sandboxName: string) {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName });
    await sandbox.stop();
    return true;
  } catch {
    return false;
  }
}
