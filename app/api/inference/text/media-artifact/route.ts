import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const judgeJobId = url.searchParams.get("judgeJobId") || "";
    const workerId = (url.searchParams.get("workerId") || "").slice(0, 160);
    const artifactRole =
      url.searchParams.get("role") === "comparison" ? "comparison" : "source";

    if (!judgeJobId || !workerId) {
      return NextResponse.json(
        { error: "judgeJobId and workerId are required." },
        { status: 400 },
      );
    }

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();
    const { data: judgeJob, error: judgeError } = await admin
      .from("text_inference_jobs")
      .select(
        "id,status,worker_id,target_node_id,capability,source_image_job_id,comparison_image_job_id",
      )
      .eq("id", judgeJobId)
      .maybeSingle();

    if (judgeError) throw judgeError;
    if (!judgeJob) {
      return NextResponse.json({ error: "Judge job not found." }, { status: 404 });
    }

    if (
      judgeJob.capability !== "media-judge" ||
      judgeJob.status !== "running" ||
      judgeJob.worker_id !== workerId ||
      (judgeJob.target_node_id && judgeJob.target_node_id !== workerId) ||
      !judgeJob.source_image_job_id ||
      (artifactRole === "comparison" && !judgeJob.comparison_image_job_id)
    ) {
      return NextResponse.json(
        { error: "Judge job is not authorized for this media artifact." },
        { status: 409 },
      );
    }

    const requestedImageJobId =
      artifactRole === "comparison"
        ? judgeJob.comparison_image_job_id
        : judgeJob.source_image_job_id;

    const { data: imageJob, error: imageError } = await admin
      .from("inference_jobs")
      .select("id,status,result_path")
      .eq("id", requestedImageJobId)
      .maybeSingle();

    if (imageError) throw imageError;
    if (!imageJob || imageJob.status !== "completed" || !imageJob.result_path) {
      return NextResponse.json(
        { error: "Source image result is not available." },
        { status: 409 },
      );
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from("inference-job-assets")
      .download(imageJob.result_path);

    if (downloadError) throw downloadError;

    return new Response(await blob.arrayBuffer(), {
      headers: {
        "Content-Type": blob.type || "image/jpeg",
        "Cache-Control": "no-store",
        "X-Cooperative-Source-Image-Job": imageJob.id,
        "X-Cooperative-Artifact-Role": artifactRole,
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not read semantic judge media artifact.";

    console.error("Semantic judge artifact read failed", {
      detail: detail.slice(0, 800),
    });

    return NextResponse.json(
      {
        error: "Could not read semantic judge media artifact.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
