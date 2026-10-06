import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";
import { recordModelCapabilityEvidence } from "@/lib/inference/model-capability-registry";

export const runtime = "nodejs";
export const maxDuration = 60;

type CompletionBody = {
  jobId?: unknown;
  workerId?: unknown;
  dataUrl?: unknown;
  model?: unknown;
  provider?: unknown;
  referencesUsed?: unknown;
  latencyMs?: unknown;
  referenceMode?: unknown;
  pipelineTrace?: unknown;
  error?: unknown;
};

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

async function recordUnisonUsage(
  supabase: AdminClient,
  input: {
    jobId: string;
    workerId: string | null;
    claimedAt: string | null;
    status: "completed" | "failed";
    completedAt: string;
    latencyMs: number | null;
  },
) {
  if (!input.workerId) return;

  try {
    const { data: node, error: nodeError } = await supabase
      .from("unison_nodes")
      .select("contributor_user_id,resources")
      .eq("id", input.workerId)
      .maybeSingle();

    if (nodeError || !node?.contributor_user_id) return;

    const claimedMs = input.claimedAt ? Date.parse(input.claimedAt) : NaN;
    const completedMs = Date.parse(input.completedAt);
    const elapsedSeconds =
      Number.isFinite(claimedMs) && Number.isFinite(completedMs)
        ? Math.max(0, Math.ceil((completedMs - claimedMs) / 1000))
        : 0;
    const computeSeconds =
      input.latencyMs !== null
        ? Math.max(0, Math.ceil(input.latencyMs / 1000))
        : elapsedSeconds;

    const resources = (node.resources || {}) as {
      gpus?: Array<unknown>;
    };
    const gpuSeconds = resources.gpus?.length ? computeSeconds : 0;

    const { error } = await supabase.from("unison_usage_ledger").upsert(
      {
        contributor_user_id: node.contributor_user_id,
        node_id: input.workerId,
        source_job_type: "image_generation",
        source_job_id: input.jobId,
        status: input.status,
        compute_seconds: computeSeconds,
        gpu_seconds: gpuSeconds,
        cpu_seconds: gpuSeconds ? 0 : computeSeconds,
        earned_cents: 0,
        estimated_external_cost_cents: 0,
        started_at: input.claimedAt,
        completed_at: input.completedAt,
      },
      { onConflict: "source_job_type,source_job_id" },
    );

    if (error) {
      console.error("Could not record Unison contribution", {
        jobId: input.jobId,
        workerId: input.workerId,
        detail: error.message.slice(0, 500),
      });
    }
  } catch (error) {
    console.error("Could not record Unison contribution", {
      jobId: input.jobId,
      workerId: input.workerId,
      detail: error instanceof Error ? error.message.slice(0, 500) : "Unknown ledger error",
    });
  }
}

function safePipelineTrace(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  try {
    const serialized = JSON.stringify(value);
    if (!serialized || serialized.length > 32_000) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function recordPipelineCapabilityEvidence(input: {
  ownerRef: string | null;
  jobId: string;
  pipelineTrace: Record<string, unknown>;
}) {
  if (input.pipelineTrace.version !== "quality-v1") return;

  const stages = Array.isArray(input.pipelineTrace.stages)
    ? input.pipelineTrace.stages.filter(
        (stage): stage is Record<string, unknown> =>
          Boolean(stage) && typeof stage === "object" && !Array.isArray(stage),
      )
    : [];

  const evidenceRows: Array<{
    capabilityKey: string;
    stage: Record<string, unknown> | null;
  }> = [
    {
      capabilityKey: "composable-media-pipeline",
      stage: null,
    },
    {
      capabilityKey: "quality-judge",
      stage:
        stages.find((stage) => stage.stage === "quality-judge") || null,
    },
    {
      capabilityKey: "targeted-refinement",
      stage:
        stages.find(
          (stage) =>
            stage.stage === "targeted-refinement" && stage.applied === true,
        ) || null,
    },
    {
      capabilityKey: "upscaling",
      stage:
        stages.find(
          (stage) => stage.stage === "upscale" && stage.applied === true,
        ) || null,
    },
  ];

  for (const row of evidenceRows) {
    if (
      row.capabilityKey !== "composable-media-pipeline" &&
      row.stage === null
    ) {
      continue;
    }

    await recordModelCapabilityEvidence({
      ownerRef: input.ownerRef,
      provider: "cooperative-local",
      model: "local-image-quality",
      endpoint: "",
      routeKind: "image",
      capabilityKey: row.capabilityKey,
      scope: "quality-v1",
      state: "supported",
      sourceType: "runtime-success",
      sourceRef: input.jobId,
      confidence: row.capabilityKey === "composable-media-pipeline" ? 0.95 : 0.9,
      evidence: {
        pipelineVersion: "quality-v1",
        stage: row.stage,
      },
    }).catch((error) => {
      console.error("Could not record local pipeline capability evidence", {
        jobId: input.jobId,
        capabilityKey: row.capabilityKey,
        detail:
          error instanceof Error ? error.message.slice(0, 500) : "unknown",
      });
    });
  }
}

function parseDataUrl(value: string) {
  const prefixMatch = value.match(/^data:(image\/(?:png|jpeg|webp));base64,/);
  if (!prefixMatch) throw new Error("Unsupported generated image format.");

  const encoded = value.slice(prefixMatch[0].length);
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length || buffer.length > 12 * 1024 * 1024) {
    throw new Error("Generated image is empty or exceeds the 12 MB result limit.");
  }

  const contentType = prefixMatch[1];
  const extension =
    contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";

  return {
    bytes: new Uint8Array(buffer),
    contentType,
    extension,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompletionBody;
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    const workerId =
      typeof body.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 160)
        : null;

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required." }, { status: 400 });
    }

    if (!(await authorizeUnisonNode(request, workerId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminSupabaseClient();
    const { data: job, error: jobError } = await supabase
      .from("inference_jobs")
      .select("id,status,worker_id,claimed_at,client_owner_ref,pipeline_mode")
      .eq("id", jobId)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    if (workerId && job.worker_id && job.worker_id !== workerId) {
      return NextResponse.json(
        { error: "This job is leased to a different node." },
        { status: 409 },
      );
    }

    if (typeof body.error === "string" && body.error.trim()) {
      const completedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("inference_jobs")
        .update({
          status: "failed",
          error: body.error.slice(0, 1200),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", jobId);

      if (updateError) throw updateError;

      await recordUnisonUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "failed",
        completedAt,
        latencyMs: null,
      });

      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (typeof body.dataUrl !== "string" || typeof body.model !== "string") {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const image = parseDataUrl(body.dataUrl);
    const resultPath = `jobs/${jobId}/result.${image.extension}`;

    const { error: uploadError } = await supabase.storage
      .from("inference-job-assets")
      .upload(resultPath, image.bytes, {
        contentType: image.contentType,
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const referencesUsed =
      typeof body.referencesUsed === "number" && Number.isInteger(body.referencesUsed)
        ? Math.max(0, Math.min(4, body.referencesUsed))
        : 0;
    const latencyMs =
      typeof body.latencyMs === "number" && Number.isFinite(body.latencyMs)
        ? Math.max(0, Math.round(body.latencyMs))
        : null;

    const pipelineTrace = safePipelineTrace(body.pipelineTrace);
    const completedAt = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("inference_jobs")
      .update({
        status: "completed",
        result_path: resultPath,
        result_model: body.model.slice(0, 300),
        result_provider:
          typeof body.provider === "string"
            ? body.provider.slice(0, 160)
            : "cooperative-worker",
        references_used: referencesUsed,
        reference_mode:
          typeof body.referenceMode === "string" &&
          ["none", "img2img", "ip-adapter"].includes(body.referenceMode)
            ? body.referenceMode
            : null,
        latency_ms: latencyMs,
        pipeline_trace: pipelineTrace,
        error: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", jobId);

    if (updateError) throw updateError;

    await recordUnisonUsage(supabase, {
      jobId,
      workerId,
      claimedAt: job.claimed_at,
      status: "completed",
      completedAt,
      latencyMs,
    });

    if (job.pipeline_mode === "quality-v1") {
      await recordPipelineCapabilityEvidence({
        ownerRef:
          typeof job.client_owner_ref === "string"
            ? job.client_owner_ref
            : null,
        jobId,
        pipelineTrace,
      });
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete inference job.";
    console.error("CoOperative inference completion failed", { detail: detail.slice(0, 800) });

    return NextResponse.json(
      { error: "Could not complete inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
