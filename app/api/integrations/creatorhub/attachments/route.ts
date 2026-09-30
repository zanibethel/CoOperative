import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "local-ai-attachments";
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function extensionFor(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = request.headers.get("x-creatorhub-user-id")?.trim() || "";
    const creatorId = request.headers.get("x-creatorhub-creator-id")?.trim() || "";
    if (!userId || !creatorId) {
      return NextResponse.json({ error: "CreatorHub owner context is required." }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, and WebP images are supported." },
        { status: 400 },
      );
    }
    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image must be 3 MB or smaller after compression." },
        { status: 413 },
      );
    }

    const ownerRef = `creatorhub:${userId}:${creatorId}`;
    const attachmentId = crypto.randomUUID();
    const extension = extensionFor(file.type);
    const storagePath = `creatorhub/${creatorId}/${attachmentId}.${extension}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const admin = createAdminSupabaseClient();

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type,
        upsert: false,
        cacheControl: "3600",
      });
    if (uploadError) throw uploadError;

    const { error: insertError } = await admin.from("local_ai_attachments").insert({
      id: attachmentId,
      owner_ref: ownerRef,
      storage_path: storagePath,
      file_name: file.name.slice(0, 240) || `image.${extension}`,
      mime_type: file.type,
      size_bytes: file.size,
    });

    if (insertError) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      throw insertError;
    }

    return NextResponse.json(
      {
        attachment: {
          id: attachmentId,
          fileName: file.name.slice(0, 240) || `image.${extension}`,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not upload CreatorHub image attachment.";
    return NextResponse.json(
      { error: "Could not upload CreatorHub image attachment.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
