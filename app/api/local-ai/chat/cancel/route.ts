import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

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
    if (!job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }

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
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not cancel Local AI job.";
    return NextResponse.json(
      { error: "Could not cancel Local AI job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
