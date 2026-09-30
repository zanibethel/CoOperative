import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const BUCKET = "local-ai-attachments";

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const attachmentId = url.searchParams.get("id");
    if (!attachmentId) {
      return NextResponse.json({ error: "Attachment id is required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { data: attachment, error } = await admin
      .from("local_ai_attachments")
      .select("storage_path,mime_type,file_name")
      .eq("id", attachmentId)
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
        "X-Cooperative-Filename": encodeURIComponent(attachment.file_name),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read worker attachment.";
    return NextResponse.json(
      { error: "Could not read worker attachment.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
