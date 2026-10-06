import { NextResponse } from "next/server";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const MEDIA_BUCKET = "cooperative-media-library";
const MAX_BYTES = 50 * 1024 * 1024;

function normalizeRemoteMediaUrl(raw: string) {
  const cleaned = raw.trim();
  try {
    const parsed = new URL(cleaned);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname.endsWith(".b") && pathParts[0]?.endsWith(".media")) {
      parsed.hostname =
        parsed.hostname.replace(".", "") + "." + pathParts.shift();
      parsed.pathname = "/" + pathParts.join("/");
    }
    return parsed.toString();
  } catch {
    return cleaned;
  }
}

function extensionFor(mimeType: string, kind: string) {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  if (mime === "video/mp4") return "mp4";
  return kind === "video" ? "mp4" : "jpg";
}

export async function GET(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ownerRef = `coop-user:${userId}`;
    const admin = createAdminSupabaseClient();
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const mediaUrl = url.searchParams.get("mediaUrl");

    let job:
      | {
          id: string;
          kind: string;
          result_url: string | null;
          model: string | null;
          pricing_dimensions: Record<string, unknown> | null;
        }
      | null = null;

    if (jobId) {
      const { data, error } = await admin
        .from("media_generation_jobs")
        .select("id,kind,result_url,model,pricing_dimensions")
        .eq("id", jobId)
        .eq("owner_ref", ownerRef)
        .eq("status", "completed")
        .maybeSingle();
      if (error) throw error;
      job = data;
    }

    if (!job && mediaUrl) {
      const normalized = normalizeRemoteMediaUrl(mediaUrl);
      const { data, error } = await admin
        .from("media_generation_jobs")
        .select("id,kind,result_url,model")
        .eq("owner_ref", ownerRef)
        .eq("status", "completed")
        .not("result_url", "is", null)
        .order("completed_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      job =
        (data || []).find(
          (candidate) =>
            candidate.result_url &&
            normalizeRemoteMediaUrl(candidate.result_url) === normalized,
        ) || null;
    }

    if (!job?.result_url) {
      return NextResponse.json(
        { error: "Generated media could not be matched to your completed jobs." },
        { status: 404 },
      );
    }

    const dimensions =
      job.pricing_dimensions &&
      typeof job.pricing_dimensions === "object" &&
      !Array.isArray(job.pricing_dimensions)
        ? job.pricing_dimensions
        : {};
    const generatedStoragePath =
      typeof dimensions.generatedStoragePath === "string"
        ? dimensions.generatedStoragePath
        : "";
    const generatedMimeType =
      typeof dimensions.generatedMimeType === "string"
        ? dimensions.generatedMimeType
        : "";

    let bytes: ArrayBuffer;
    let mimeType: string;

    if (generatedStoragePath) {
      const { data: blob, error: downloadError } = await admin.storage
        .from(MEDIA_BUCKET)
        .download(generatedStoragePath);
      if (downloadError || !blob) {
        throw downloadError || new Error("Stored generated media is unavailable.");
      }
      bytes = await blob.arrayBuffer();
      mimeType =
        (generatedMimeType || blob.type || (job.kind === "video" ? "video/mp4" : "image/jpeg"))
          .split(";")[0]
          .trim();
    } else {
      const remote = await fetch(normalizeRemoteMediaUrl(job.result_url), {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!remote.ok) {
        throw new Error(`Media provider returned HTTP ${remote.status}.`);
      }

      const contentLength = Number(remote.headers.get("content-length") || 0);
      if (contentLength > MAX_BYTES) {
        return NextResponse.json(
          { error: "Media exceeds the 50 MB export limit." },
          { status: 413 },
        );
      }

      bytes = await remote.arrayBuffer();
      mimeType =
        (remote.headers.get("content-type") || (job.kind === "video" ? "video/mp4" : "image/jpeg"))
          .split(";")[0]
          .trim();
    }

    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "Media is empty or exceeds the 50 MB export limit." },
        { status: 413 },
      );
    }
    const extension = extensionFor(mimeType, job.kind);
    const fileName = `cooperative-${job.kind}-${job.id.slice(0, 8)}.${extension}`;

    return new Response(bytes, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300",
        "X-CoOperative-Filename": fileName,
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not export generated media.";
    return NextResponse.json(
      { error: "Could not export generated media.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
