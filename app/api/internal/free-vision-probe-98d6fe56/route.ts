import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import {
  pollHermesVisionTask,
  startHermesVisionTask,
} from "@/lib/inference/hermes-vision-cloud";

export const runtime = "nodejs";
export const maxDuration = 300;

const KEY_SHA256 =
  "f268b1a9b724e8a734cbea4dda9e96b573cd3c21a565ba3a27e717748a5f931f";
const TEST_JOB_ID = "98d6fe56-2e04-4b0a-9b6c-b044a2335df1";
const SANDBOX_NAME = `cooperative-vision-${TEST_JOB_ID}`;

async function validKey(value: string | null) {
  if (!value) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex === KEY_SHA256;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!(await validKey(url.searchParams.get("key")))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const action = url.searchParams.get("action") || "poll";
  const admin = createAdminSupabaseClient();

  const { data: owner, error: ownerError } = await admin
    .from("unison_platform_owners")
    .select("user_id")
    .limit(1)
    .single();
  if (ownerError) throw ownerError;

  const ownerRef = `coop-user:${owner.user_id}`;

  if (action === "start") {
    const { data: item, error: itemError } = await admin
      .from("cooperative_media_library")
      .select("kind,storage_path,file_name,mime_type")
      .eq("owner_ref", ownerRef)
      .eq("kind", "image")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return NextResponse.json({ error: "No saved image found." }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from("cooperative-media-library")
      .download(item.storage_path);
    if (downloadError) throw downloadError;

    const openRouter = await businessOwnedServiceCredentialForOwner(
      ownerRef,
      "openrouter-api",
    );
    if (!openRouter?.credential) {
      return NextResponse.json(
        { error: "OpenRouter credential unavailable." },
        { status: 409 },
      );
    }

    const started = await startHermesVisionTask({
      jobId: TEST_JOB_ID,
      question:
        "Briefly describe what is visibly present in this image. Mention the main subject, setting, lighting, and notable objects. Do not infer identity.",
      images: [
        {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          fileName: item.file_name,
          mimeType: item.mime_type,
        },
      ],
      openRouterCredential: openRouter.credential,
    });

    return NextResponse.json({
      status: "running",
      sandboxName: started.sandboxName,
      deadlineAt: started.deadlineAt,
      provider: started.provider,
      model: started.model,
      visionModel: started.visionModel,
    });
  }

  const deadlineAt =
    url.searchParams.get("deadlineAt") ||
    new Date(Date.now() + 3 * 60 * 1000).toISOString();
  const polled = await pollHermesVisionTask({
    sandboxName: SANDBOX_NAME,
    deadlineAt,
  });

  return NextResponse.json({
    state: polled.state,
    text: polled.text,
    error: polled.error,
    usage: polled.usage,
    stderrTail: polled.stderr.slice(-1200),
  });
}
