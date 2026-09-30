import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { textInferenceRequestSchema } from "@/lib/inference/contracts";

export const runtime = "nodejs";
export const maxDuration = 30;

const enqueueSchema = textInferenceRequestSchema.extend({
  clientOwnerRef: z.string().min(1).max(160),
});

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = enqueueSchema.parse(await request.json());
    const supabase = createAdminSupabaseClient();
    const jobId = crypto.randomUUID();

    const { error } = await supabase.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: input.clientOwnerRef,
      messages: input.messages,
      profile: input.profile,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    });

    if (error) throw error;

    return NextResponse.json(
      { jobId, status: "queued", profile: input.profile },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not enqueue text generation.";
    console.error("CoOperative async text enqueue failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not enqueue text generation.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
