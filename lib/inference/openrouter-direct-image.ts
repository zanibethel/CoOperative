import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

const OPENROUTER_IMAGE_ENDPOINT = "https://openrouter.ai/api/v1/images";
const MEDIA_BUCKET = "cooperative-media-library";
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

export type DirectOpenRouterImageResult =
  | {
      ok: true;
      storagePath: string;
      mimeType: string;
      usage: Record<string, unknown> | null;
      providerModel: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      usage: Record<string, unknown> | null;
    };

function normalizeBase64(value: string) {
  const marker = "base64,";
  const index = value.indexOf(marker);
  return index >= 0 ? value.slice(index + marker.length) : value;
}

function mimeFromDataUrl(value: string) {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  return match?.[1]?.toLowerCase() || null;
}

function extensionFor(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

async function imageBytesFromResponseEntry(entry: any) {
  if (typeof entry?.b64_json === "string" && entry.b64_json.trim()) {
    const raw = entry.b64_json.trim();
    const mimeType =
      (typeof entry?.media_type === "string" && entry.media_type.trim()) ||
      mimeFromDataUrl(raw) ||
      "image/png";
    return {
      bytes: Buffer.from(normalizeBase64(raw), "base64"),
      mimeType,
    };
  }

  if (typeof entry?.url === "string" && entry.url.trim()) {
    const response = await fetch(entry.url.trim(), {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(
        `Generated image URL returned HTTP ${response.status}.`,
      );
    }
    const mimeType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/png";
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mimeType,
    };
  }

  throw new Error("OpenRouter returned no image payload.");
}

export async function executeOpenRouterImageDirect(input: {
  jobId: string;
  ownerRef: string;
  model: string;
  prompt: string;
  credential: string;
  referenceImageUrls?: string[];
}) : Promise<DirectOpenRouterImageResult> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    n: 1,
  };

  const references = (input.referenceImageUrls || []).filter(Boolean);
  if (references.length) {
    body.input_references = references.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  }

  let response: Response;
  try {
    response = await fetch(OPENROUTER_IMAGE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.credential}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://co-operative-mu.vercel.app",
        "X-Title": "CoOperative",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error:
        error instanceof Error
          ? error.name === "TimeoutError" || error.name === "AbortError"
            ? "OpenRouter image generation exceeded the 120-second direct-provider window."
            : error.message
          : "OpenRouter image generation request failed.",
      usage: null,
    };
  }

  const raw = await response.text();
  let payload: any = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = null;
  }

  const usage =
    payload?.usage && typeof payload.usage === "object"
      ? (payload.usage as Record<string, unknown>)
      : null;

  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      raw.slice(0, 1600) ||
      `OpenRouter image generation returned HTTP ${response.status}.`;
    return {
      ok: false,
      status: response.status,
      error: String(detail).slice(0, 1600),
      usage,
    };
  }

  try {
    const first = Array.isArray(payload?.data) ? payload.data[0] : null;
    const generated = await imageBytesFromResponseEntry(first);
    if (
      generated.bytes.length <= 0 ||
      generated.bytes.length > MAX_OUTPUT_BYTES
    ) {
      throw new Error("Generated image size is outside the supported range.");
    }

    const safeOwner = input.ownerRef.replace(/[^a-zA-Z0-9_-]/g, "_");
    const storagePath =
      `generated/${safeOwner}/${input.jobId}.${extensionFor(generated.mimeType)}`;
    const admin = createAdminSupabaseClient();
    const { error: uploadError } = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(storagePath, generated.bytes, {
        contentType: generated.mimeType,
        upsert: false,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    return {
      ok: true,
      storagePath,
      mimeType: generated.mimeType,
      usage,
      providerModel:
        typeof payload?.model === "string" ? payload.model : null,
    };
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      error:
        error instanceof Error
          ? error.message.slice(0, 1600)
          : "Could not persist the generated OpenRouter image.",
      usage,
    };
  }
}
