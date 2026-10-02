import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { cancelHermesMediaTask } from "@/lib/inference/hermes-media-cloud";

export const runtime = "nodejs";
export const maxDuration = 30;

const cancelSchema = z.object({
  jobId: z.string().uuid(),
});

async function currentOwnerRef() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ? `coop-user:${user.id}` : null;
}

export async function POST(request: Request) {
  const ownerRef = await currentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = cancelSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const { data: job, error: jobError } = await admin
      .from("text_inference_jobs")
      .select("id,status")
      .eq("id", input.jobId)
      .eq("client_owner_ref", ownerRef)
      .maybeSingle();

    if (jobError) throw jobError;

    if (job) {
      if (job.status === "queued" || job.status === "running") {
        const { error: updateError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "cancelled",
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq("id", input.jobId)
          .eq("client_owner_ref", ownerRef);

        if (updateError) throw updateError;
      }

      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    const { data: mediaJob, error: mediaJobError } = await admin
      .from("media_generation_jobs")
      .select("id,status,sandbox_name")
      .eq("id", input.jobId)
      .eq("owner_ref", ownerRef)
      .maybeSingle();

    if (mediaJobError) throw mediaJobError;
    if (!mediaJob) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

    if (mediaJob.status === "queued" || mediaJob.status === "running") {
      if (mediaJob.sandbox_name) {
        await cancelHermesMediaTask(mediaJob.sandbox_name);
      }

      const completedAt = new Date().toISOString();
      const { error: mediaCancelError } = await admin
        .from("media_generation_jobs")
        .update({
          status: "cancelled",
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", input.jobId)
        .eq("owner_ref", ownerRef);

      if (mediaCancelError) throw mediaCancelError;
    }

    return NextResponse.json({ ok: true, status: "cancelled" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not cancel Local AI job.";
    return NextResponse.json(
      { error: "Could not cancel Local AI job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
