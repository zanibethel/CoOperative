import { NextResponse } from "next/server";
import { z } from "zod";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const LIBRARY_BUCKET = "cooperative-media-library";
const ATTACHMENT_BUCKET = "local-ai-attachments";
const MAX_LIBRARY_BYTES = 50 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const saveSchema = z.object({
  action: z.literal("save").default("save"),
  jobId: z.string().uuid().optional(),
  mediaUrl: z.string().url().optional(),
});

const attachSchema = z.object({
  action: z.literal("attach"),
  mediaId: z.string().uuid(),
});

function ownerRef(userId: string) {
  return `coop-user:${userId}`;
}

function normalizeRemoteMediaUrl(raw: string) {
  const cleaned = raw.trim();
  try {
    const parsed = new URL(cleaned);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (
      parsed.hostname.endsWith(".b") &&
      pathParts[0]?.endsWith(".media")
    ) {
      parsed.hostname =
        parsed.hostname.replace(".", "") + "." + pathParts.shift();
      parsed.pathname = "/" + pathParts.join("/");
    }
    return parsed.toString();
  } catch {
    return cleaned;
  }
}

function extensionFor(mimeType: string, kind: "image" | "video") {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "video/webm") return "webm";
  if (normalized === "video/quicktime") return "mov";
  if (normalized === "video/mp4") return "mp4";
  return kind === "video" ? "mp4" : "jpg";
}

function allowedMimeType(mimeType: string, kind: "image" | "video") {
  const normalized = mimeType.split(";")[0].trim().toLowerCase();
  return kind === "image"
    ? ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(normalized)
    : ["video/mp4", "video/webm", "video/quicktime"].includes(normalized);
}

function itemResponse(item: {
  id: string;
  kind: "image" | "video";
  file_name: string;
  mime_type: string;
  size_bytes: number | string;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  created_at: string;
  source_job_id: string | null;
}) {
  return {
    id: item.id,
    kind: item.kind,
    fileName: item.file_name,
    mimeType: item.mime_type,
    sizeBytes: Number(item.size_bytes || 0),
    provider: item.provider,
    model: item.model,
    prompt: item.prompt,
    createdAt: item.created_at,
    sourceJobId: item.source_job_id,
    previewUrl: `/api/local-ai/media-library?id=${item.id}`,
  };
}

export async function GET(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const owner = ownerRef(userId);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const { data: item, error } = await admin
        .from("cooperative_media_library")
        .select("storage_path,mime_type,file_name")
        .eq("id", id)
        .eq("owner_ref", owner)
        .maybeSingle();

      if (error) throw error;
      if (!item) {
        return NextResponse.json({ error: "Saved media not found." }, { status: 404 });
      }

      const { data: blob, error: downloadError } = await admin.storage
        .from(LIBRARY_BUCKET)
        .download(item.storage_path);
      if (downloadError) throw downloadError;

      return new Response(await blob.arrayBuffer(), {
        headers: {
          "Content-Type": item.mime_type,
          "Content-Disposition": `inline; filename="${item.file_name.replace(/["\\]/g, "_")}"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const { data, error } = await admin
      .from("cooperative_media_library")
      .select(
        "id,kind,file_name,mime_type,size_bytes,provider,model,prompt,created_at,source_job_id",
      )
      .eq("owner_ref", owner)
      .order("created_at", { ascending: false })
      .limit(60);

    if (error) throw error;

    return NextResponse.json(
      { items: (data || []).map((item) => itemResponse(item as Parameters<typeof itemResponse>[0])) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read CoOperative Cloud media.";
    return NextResponse.json(
      { error: "Could not read CoOperative Cloud media.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const raw = await request.json();
    const admin = createAdminSupabaseClient();
    const owner = ownerRef(userId);

    if (raw?.action === "attach") {
      const input = attachSchema.parse(raw);
      const { data: item, error: itemError } = await admin
        .from("cooperative_media_library")
        .select("id,kind,storage_path,file_name,mime_type,size_bytes")
        .eq("id", input.mediaId)
        .eq("owner_ref", owner)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) {
        return NextResponse.json({ error: "Saved media not found." }, { status: 404 });
      }
      if (item.kind !== "image") {
        return NextResponse.json(
          { error: "Saved videos can be viewed and shared, but only images can be attached to chat right now." },
          { status: 409 },
        );
      }
      if (Number(item.size_bytes) > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json(
          { error: "This saved image is larger than the current 3 MB chat attachment limit." },
          { status: 413 },
        );
      }

      const { data: blob, error: downloadError } = await admin.storage
        .from(LIBRARY_BUCKET)
        .download(item.storage_path);
      if (downloadError) throw downloadError;

      const attachmentId = crypto.randomUUID();
      const extension = extensionFor(item.mime_type, "image");
      const storagePath = `${userId}/${attachmentId}.${extension}`;
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const { error: uploadError } = await admin.storage
        .from(ATTACHMENT_BUCKET)
        .upload(storagePath, bytes, {
          contentType: item.mime_type,
          upsert: false,
          cacheControl: "3600",
        });
      if (uploadError) throw uploadError;

      const { error: insertError } = await admin.from("local_ai_attachments").insert({
        id: attachmentId,
        owner_ref: owner,
        storage_path: storagePath,
        file_name: item.file_name,
        mime_type: item.mime_type,
        size_bytes: bytes.byteLength,
      });
      if (insertError) {
        await admin.storage.from(ATTACHMENT_BUCKET).remove([storagePath]);
        throw insertError;
      }

      return NextResponse.json(
        {
          attachment: {
            id: attachmentId,
            fileName: item.file_name,
            mimeType: item.mime_type,
            sizeBytes: bytes.byteLength,
            previewUrl: `/api/local-ai/attachments?id=${attachmentId}`,
          },
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }

    const input = saveSchema.parse(raw);
    if (!input.jobId && !input.mediaUrl) {
      return NextResponse.json(
        { error: "A generated media job or media URL is required." },
        { status: 400 },
      );
    }

    let job:
      | {
          id: string;
          kind: "image" | "video";
          result_url: string | null;
          provider: string | null;
          model: string | null;
          prompt: string | null;
        }
      | null = null;

    if (input.jobId) {
      const { data, error } = await admin
        .from("media_generation_jobs")
        .select("id,kind,result_url,provider,model,prompt")
        .eq("id", input.jobId)
        .eq("owner_ref", owner)
        .eq("status", "completed")
        .maybeSingle();
      if (error) throw error;
      job = data as typeof job;
    }

    if (!job && input.mediaUrl) {
      const requestedUrl = normalizeRemoteMediaUrl(input.mediaUrl);
      const { data: recentJobs, error } = await admin
        .from("media_generation_jobs")
        .select("id,kind,result_url,provider,model,prompt")
        .eq("owner_ref", owner)
        .eq("status", "completed")
        .not("result_url", "is", null)
        .order("completed_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      job =
        ((recentJobs || []).find(
          (candidate) =>
            candidate.result_url &&
            normalizeRemoteMediaUrl(candidate.result_url) === requestedUrl,
        ) as typeof job) || null;
    }

    if (!job?.result_url) {
      return NextResponse.json(
        { error: "This media result could not be matched to one of your completed CoOperative jobs." },
        { status: 404 },
      );
    }

    const { data: existing, error: existingError } = await admin
      .from("cooperative_media_library")
      .select(
        "id,kind,file_name,mime_type,size_bytes,provider,model,prompt,created_at,source_job_id",
      )
      .eq("owner_ref", owner)
      .eq("source_job_id", job.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return NextResponse.json(
        { saved: true, alreadySaved: true, item: itemResponse(existing as Parameters<typeof itemResponse>[0]) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const remoteUrl = normalizeRemoteMediaUrl(job.result_url);
    const response = await fetch(remoteUrl, {
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Media provider returned HTTP ${response.status} while saving.`);
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_LIBRARY_BYTES) {
      return NextResponse.json(
        { error: "Media is larger than the 50 MB CoOperative Cloud limit." },
        { status: 413 },
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_LIBRARY_BYTES) {
      return NextResponse.json(
        { error: "Media is empty or larger than the 50 MB CoOperative Cloud limit." },
        { status: 413 },
      );
    }

    const fallbackMime = job.kind === "video" ? "video/mp4" : "image/jpeg";
    const mimeType = (response.headers.get("content-type") || fallbackMime)
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!allowedMimeType(mimeType, job.kind)) {
      return NextResponse.json(
        { error: `Unsupported saved-media type: ${mimeType || "unknown"}.` },
        { status: 415 },
      );
    }

    const libraryId = crypto.randomUUID();
    const extension = extensionFor(mimeType, job.kind);
    const fileName = `cooperative-${job.kind}-${libraryId.slice(0, 8)}.${extension}`;
    const storagePath = `${userId}/${libraryId}.${extension}`;

    const { error: uploadError } = await admin.storage
      .from(LIBRARY_BUCKET)
      .upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: false,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    const row = {
      id: libraryId,
      owner_ref: owner,
      source_job_id: job.id,
      kind: job.kind,
      storage_path: storagePath,
      mime_type: mimeType,
      file_name: fileName,
      size_bytes: bytes.byteLength,
      provider: job.provider,
      model: job.model,
      prompt: job.prompt,
    };

    const { data: saved, error: insertError } = await admin
      .from("cooperative_media_library")
      .insert(row)
      .select(
        "id,kind,file_name,mime_type,size_bytes,provider,model,prompt,created_at,source_job_id",
      )
      .single();

    if (insertError) {
      await admin.storage.from(LIBRARY_BUCKET).remove([storagePath]);
      throw insertError;
    }

    return NextResponse.json(
      { saved: true, alreadySaved: false, item: itemResponse(saved as Parameters<typeof itemResponse>[0]) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not update CoOperative Cloud media.";
    return NextResponse.json(
      { error: "Could not update CoOperative Cloud media.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
