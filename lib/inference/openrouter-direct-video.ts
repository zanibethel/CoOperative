import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const OPENROUTER_VIDEO_ENDPOINT = "https://openrouter.ai/api/v1/videos";
const MEDIA_BUCKET = "cooperative-media-library";
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;

type VideoUsage = Record<string, unknown> | null;

function usageFromPayload(payload: any): VideoUsage {
  return payload?.usage && typeof payload.usage === "object"
    ? (payload.usage as Record<string, unknown>)
    : null;
}

function errorFromPayload(payload: any, raw: string, fallback: string) {
  return String(
    payload?.error?.message ||
      payload?.error ||
      payload?.message ||
      raw.slice(0, 1600) ||
      fallback,
  ).slice(0, 1600);
}

function extensionFor(mimeType: string) {
  if (mimeType === "video/webm") return "webm";
  if (mimeType === "video/quicktime") return "mov";
  return "mp4";
}

export type OpenRouterVideoSubmitResult =
  | {
      ok: true;
      providerJobId: string;
      providerStatus: string;
      pollingUrl: string;
      usage: VideoUsage;
    }
  | {
      ok: false;
      status: number;
      error: string;
      failureStage: "transport-uncertain" | "provider-response";
    };

export async function submitOpenRouterVideoDirect(input: {
  model: string;
  prompt: string;
  credential: string;
  durationSeconds: number | null;
  resolution: string | null;
  aspectRatio: string | null;
  audio: boolean | null;
}): Promise<OpenRouterVideoSubmitResult> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    provider: {
      allow_fallbacks: false,
    },
  };
  if (input.durationSeconds !== null) body.duration = input.durationSeconds;
  if (input.resolution) body.resolution = input.resolution;
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  if (input.audio !== null) body.generate_audio = input.audio;

  let response: Response;
  try {
    response = await fetch(OPENROUTER_VIDEO_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.credential}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://co-operative-mu.vercel.app",
        "X-Title": "CoOperative",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error:
        error instanceof Error
          ? error.name === "TimeoutError" || error.name === "AbortError"
            ? "OpenRouter video submission exceeded the 60-second acceptance window."
            : error.message
          : "OpenRouter video submission failed before a provider job ID was received.",
      failureStage: "transport-uncertain",
    };
  }

  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: errorFromPayload(
        payload,
        raw,
        `OpenRouter video submission returned HTTP ${response.status}.`,
      ),
      failureStage: "provider-response",
    };
  }

  const providerJobId =
    typeof payload?.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : "";
  if (!providerJobId) {
    return {
      ok: false,
      status: response.status,
      error:
        "OpenRouter accepted the video request but returned no provider job ID. CoOperative will not submit a replacement generation automatically.",
      failureStage: "transport-uncertain",
    };
  }

  return {
    ok: true,
    providerJobId,
    providerStatus:
      typeof payload?.status === "string" ? payload.status : "pending",
    pollingUrl:
      `${OPENROUTER_VIDEO_ENDPOINT}/${encodeURIComponent(providerJobId)}`,
    usage: usageFromPayload(payload),
  };
}

export type OpenRouterVideoPollResult =
  | {
      state: "running";
      providerStatus: string;
      usage: VideoUsage;
      pollError: string | null;
    }
  | {
      state: "completed";
      providerStatus: string;
      usage: VideoUsage;
      storagePath: string;
      mimeType: string;
    }
  | {
      state: "failed";
      providerStatus: string;
      usage: VideoUsage;
      error: string;
      httpStatus: number;
      failureStage: "provider-response" | "post-provider";
    };

export async function pollOpenRouterVideoDirect(input: {
  jobId: string;
  ownerRef: string;
  providerJobId: string;
  credential: string;
}): Promise<OpenRouterVideoPollResult> {
  const pollingUrl =
    `${OPENROUTER_VIDEO_ENDPOINT}/${encodeURIComponent(input.providerJobId)}`;

  let response: Response;
  try {
    response = await fetch(pollingUrl, {
      headers: {
        Authorization: `Bearer ${input.credential}`,
        "HTTP-Referer": "https://co-operative-mu.vercel.app",
        "X-Title": "CoOperative",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return {
      state: "running",
      providerStatus: "poll-unavailable",
      usage: null,
      pollError:
        error instanceof Error
          ? error.message.slice(0, 1200)
          : "OpenRouter video status could not be read.",
    };
  }

  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }
  const usage = usageFromPayload(payload);

  if (!response.ok) {
    return {
      state: "running",
      providerStatus: "poll-http-" + response.status,
      usage,
      pollError: errorFromPayload(
        payload,
        raw,
        `OpenRouter video status returned HTTP ${response.status}.`,
      ),
    };
  }

  const providerStatus =
    typeof payload?.status === "string" ? payload.status : "unknown";

  if (providerStatus === "pending" || providerStatus === "in_progress") {
    return {
      state: "running",
      providerStatus,
      usage,
      pollError: null,
    };
  }

  if (
    providerStatus === "failed" ||
    providerStatus === "cancelled" ||
    providerStatus === "expired"
  ) {
    return {
      state: "failed",
      providerStatus,
      usage,
      error: errorFromPayload(
        payload,
        raw,
        `OpenRouter video generation ended with status ${providerStatus}.`,
      ),
      httpStatus: response.status,
      failureStage: "provider-response",
    };
  }

  if (providerStatus !== "completed") {
    return {
      state: "running",
      providerStatus,
      usage,
      pollError: `OpenRouter returned unexpected video status: ${providerStatus}.`,
    };
  }

  const contentUrl =
    `${OPENROUTER_VIDEO_ENDPOINT}/${encodeURIComponent(input.providerJobId)}/content?index=0`;
  let contentResponse: Response;
  try {
    contentResponse = await fetch(contentUrl, {
      headers: {
        Authorization: `Bearer ${input.credential}`,
        "HTTP-Referer": "https://co-operative-mu.vercel.app",
        "X-Title": "CoOperative",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    return {
      state: "running",
      providerStatus,
      usage,
      pollError:
        error instanceof Error
          ? `The completed video could not be downloaded yet: ${error.message.slice(0, 1000)}`
          : "The completed video could not be downloaded yet.",
    };
  }

  if (!contentResponse.ok) {
    const detail = (await contentResponse.text()).slice(0, 1200);
    return {
      state: "running",
      providerStatus,
      usage,
      pollError:
        detail ||
        `The completed OpenRouter video returned HTTP ${contentResponse.status} while downloading.`,
    };
  }

  const contentLength = Number(contentResponse.headers.get("content-length") || 0);
  if (contentLength > MAX_OUTPUT_BYTES) {
    return {
      state: "failed",
      providerStatus,
      usage,
      error:
        "The generated video exceeds CoOperative's current 100 MB workflow-media storage limit. No second generation was started.",
      httpStatus: 0,
      failureStage: "post-provider",
    };
  }

  try {
    const bytes = Buffer.from(await contentResponse.arrayBuffer());
    if (bytes.length <= 0) {
      throw new Error("The completed video download was empty.");
    }
    if (bytes.length > MAX_OUTPUT_BYTES) {
      return {
        state: "failed",
        providerStatus,
        usage,
        error:
          "The generated video exceeds CoOperative's current 100 MB workflow-media storage limit. No second generation was started.",
        httpStatus: 0,
        failureStage: "post-provider",
      };
    }

    const mimeType =
      contentResponse.headers.get("content-type")?.split(";")[0]?.trim() ||
      "video/mp4";
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(mimeType)) {
      return {
        state: "failed",
        providerStatus,
        usage,
        error: `OpenRouter returned unsupported video MIME type ${mimeType}.`,
        httpStatus: 0,
        failureStage: "post-provider",
      };
    }

    const safeOwner = input.ownerRef.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storagePath =
      `generated/${safeOwner}/${input.jobId}.${extensionFor(mimeType)}`;
    const admin = createAdminSupabaseClient();
    const { error: uploadError } = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: true,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    return {
      state: "completed",
      providerStatus,
      usage,
      storagePath,
      mimeType,
    };
  } catch (error) {
    return {
      state: "running",
      providerStatus,
      usage,
      pollError:
        error instanceof Error
          ? `The completed video is awaiting local persistence: ${error.message.slice(0, 1000)}`
          : "The completed video is awaiting local persistence.",
    };
  }
}
