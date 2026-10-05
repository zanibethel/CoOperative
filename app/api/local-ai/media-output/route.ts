import { NextResponse } from "next/server";

import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MEDIA_BUCKET = "cooperative-media-library";

export async function GET(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const ownerRef = `coop-user:${userId}`;
  const admin = createAdminSupabaseClient();
  const { data: job, error } = await admin
    .from("media_generation_jobs")
    .select("pricing_dimensions")
    .eq("id", jobId)
    .eq("owner_ref", ownerRef)
    .eq("status", "completed")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Could not read generated media." },
      { status: 502 },
    );
  }
  if (!job) {
    return NextResponse.json({ error: "Media not found." }, { status: 404 });
  }

  const dimensions =
    job.pricing_dimensions &&
    typeof job.pricing_dimensions === "object" &&
    !Array.isArray(job.pricing_dimensions)
      ? (job.pricing_dimensions as {
          generatedStoragePath?: unknown;
          generatedMimeType?: unknown;
        })
      : {};

  const storagePath =
    typeof dimensions.generatedStoragePath === "string"
      ? dimensions.generatedStoragePath
      : "";
  if (!storagePath) {
    return NextResponse.json(
      { error: "Generated media storage path is unavailable." },
      { status: 404 },
    );
  }

  const { data: blob, error: downloadError } = await admin.storage
    .from(MEDIA_BUCKET)
    .download(storagePath);
  if (downloadError || !blob) {
    return NextResponse.json(
      { error: "Could not load generated media." },
      { status: 502 },
    );
  }

  const mimeType =
    typeof dimensions.generatedMimeType === "string"
      ? dimensions.generatedMimeType
      : blob.type || "image/png";

  return new Response(await blob.arrayBuffer(), {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
    },
  });
}
