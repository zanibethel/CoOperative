import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "local-ai-attachments";
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

function extensionFor(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    const ownerRef = `coop-user:${user.id}`;
    const attachmentId = crypto.randomUUID();
    const extension = extensionFor(file.type);
    const storagePath = `${user.id}/${attachmentId}.${extension}`;
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
          previewUrl: `/api/local-ai/attachments?id=${attachmentId}`,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not upload image attachment.";
    return NextResponse.json(
      { error: "Could not upload image attachment.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const attachmentId = url.searchParams.get("id");
    if (!attachmentId) {
      return NextResponse.json({ error: "Attachment id is required." }, { status: 400 });
    }

    const ownerRef = `coop-user:${user.id}`;
    const admin = createAdminSupabaseClient();
    const { data: attachment, error } = await admin
      .from("local_ai_attachments")
      .select("storage_path,mime_type,file_name")
      .eq("id", attachmentId)
      .eq("owner_ref", ownerRef)
      .maybeSingle();

    if (error) throw error;
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from(BUCKET)
      .download(attachment.storage_path);

    if (downloadError) throw downloadError;

    return new Response(await blob.arrayBuffer(), {
      headers: {
        "Content-Type": attachment.mime_type,
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read image attachment.";
    return NextResponse.json(
      { error: "Could not read image attachment.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const attachmentId = url.searchParams.get("id");
    if (!attachmentId) {
      return NextResponse.json({ error: "Attachment id is required." }, { status: 400 });
    }

    const ownerRef = `coop-user:${user.id}`;
    const admin = createAdminSupabaseClient();
    const { data: attachment, error } = await admin
      .from("local_ai_attachments")
      .select("storage_path,conversation_id")
      .eq("id", attachmentId)
      .eq("owner_ref", ownerRef)
      .maybeSingle();

    if (error) throw error;
    if (!attachment) {
      return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
    }
    if (attachment.conversation_id) {
      return NextResponse.json(
        { error: "Attachment is already part of a saved conversation." },
        { status: 409 },
      );
    }

    const { error: removeError } = await admin.storage
      .from(BUCKET)
      .remove([attachment.storage_path]);
    if (removeError) throw removeError;

    const { error: deleteError } = await admin
      .from("local_ai_attachments")
      .delete()
      .eq("id", attachmentId)
      .eq("owner_ref", ownerRef);
    if (deleteError) throw deleteError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not delete image attachment.";
    return NextResponse.json(
      { error: "Could not delete image attachment.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
