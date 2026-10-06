import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";
import { z } from "zod";
import { textInferenceMessageSchema } from "@/lib/inference/contracts";
import { persistResponseSupport } from "@/lib/ai/response-support";
import { refreshRuntimeContextAfterOutcome } from "@/lib/ai/runtime-context-markdown";
import { recordModelCapabilityEvidence } from "@/lib/inference/model-capability-registry";

export const runtime = "nodejs";
export const maxDuration = 30;

type CompletionBody = {
  jobId?: unknown;
  workerId?: unknown;
  text?: unknown;
  model?: unknown;
  provider?: unknown;
  promptTokens?: unknown;
  outputTokens?: unknown;
  latencyMs?: unknown;
  webSearchUsed?: unknown;
  webAccessMode?: unknown;
  error?: unknown;
};

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

const semanticScoreSchema = z.number().min(0).max(100);
const semanticNullableScoreSchema = semanticScoreSchema.nullable();

const semanticFindingSchema = z.object({
  category: z.enum([
    "face",
    "hands",
    "anatomy",
    "skin",
    "lighting",
    "background",
    "prompt",
    "artifact",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  description: z.string().min(1).max(500),
  regionHint: z.string().max(200).nullable().optional().default(null),
  action: z.enum([
    "none",
    "refine-face",
    "refine-hands",
    "refine-anatomy",
    "refine-skin",
    "refine-lighting",
    "inpaint",
    "regenerate",
    "upscale",
  ]),
});

const semanticJudgeSchema = z.object({
  version: z.literal("semantic-vision-v1").default("semantic-vision-v1"),
  overallScore: semanticScoreSchema,
  promptAdherence: semanticScoreSchema,
  faceQuality: semanticNullableScoreSchema.default(null),
  handQuality: semanticNullableScoreSchema.default(null),
  anatomyQuality: semanticNullableScoreSchema.default(null),
  skinRealism: semanticNullableScoreSchema.default(null),
  lightingConsistency: semanticScoreSchema,
  backgroundIntegrity: semanticScoreSchema,
  artifactSeverity: semanticScoreSchema,
  confidence: z.number().min(0).max(1),
  findings: z.array(semanticFindingSchema).max(16).default([]),
  suggestedActions: z.array(z.string().min(1).max(180)).max(10).default([]),
});

type SemanticJudgeReport = z.infer<typeof semanticJudgeSchema>;

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Semantic vision judge did not return a JSON object.");
  }
  return unfenced.slice(start, end + 1);
}

function parseSemanticJudgeReport(text: string): SemanticJudgeReport {
  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;

  if (Array.isArray(parsed.suggestedActions)) {
    parsed.suggestedActions = parsed.suggestedActions
      .map((value) => {
        if (typeof value === "string") return value.trim();
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as { action?: unknown }).action === "string"
        ) {
          return (value as { action: string }).action.trim();
        }
        return "";
      })
      .filter(Boolean)
      .slice(0, 10);
  }

  return semanticJudgeSchema.parse(parsed);
}

async function updateSourceSemanticJudgeTrace(
  supabase: AdminClient,
  sourceImageJobId: string | null,
  semanticJudge: Record<string, unknown>,
) {
  if (!sourceImageJobId) return;

  const { data: sourceJob, error: sourceError } = await supabase
    .from("inference_jobs")
    .select("pipeline_trace")
    .eq("id", sourceImageJobId)
    .maybeSingle();

  if (sourceError) throw sourceError;
  if (!sourceJob) return;

  const existingTrace =
    sourceJob.pipeline_trace &&
    typeof sourceJob.pipeline_trace === "object" &&
    !Array.isArray(sourceJob.pipeline_trace)
      ? (sourceJob.pipeline_trace as Record<string, unknown>)
      : {};

  const { error: updateError } = await supabase
    .from("inference_jobs")
    .update({
      pipeline_trace: {
        ...existingTrace,
        semanticJudge,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", sourceImageJobId);

  if (updateError) throw updateError;
}

async function recordSemanticJudgeEvidence(input: {
  ownerRef: string;
  judgeJobId: string;
  sourceImageJobId: string;
  model: string;
  provider: string;
  latencyMs: number | null;
  report: SemanticJudgeReport;
}) {
  await recordModelCapabilityEvidence({
    ownerRef: input.ownerRef,
    provider: "cooperative-local",
    model: "local-image-quality",
    endpoint: "",
    routeKind: "image",
    capabilityKey: "semantic-quality-judge",
    scope: "semantic-vision-v1",
    state: "supported",
    sourceType: "runtime-success",
    sourceRef: input.judgeJobId,
    confidence: Math.max(0.5, Math.min(0.99, input.report.confidence)),
    evidence: {
      sourceImageJobId: input.sourceImageJobId,
      judgeModel: input.model,
      judgeProvider: input.provider,
      latencyMs: input.latencyMs,
      report: input.report,
    },
  });
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : null;
}

async function recordUnisonTextUsage(
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

    const resources = (node.resources || {}) as { gpus?: Array<unknown> };
    const gpuSeconds = resources.gpus?.length ? computeSeconds : 0;

    const { error } = await supabase.from("unison_usage_ledger").upsert(
      {
        contributor_user_id: node.contributor_user_id,
        node_id: input.workerId,
        source_job_type: "text_generation",
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
      console.error("Could not record Unison text contribution", {
        jobId: input.jobId,
        workerId: input.workerId,
        detail: error.message.slice(0, 500),
      });
    }
  } catch (error) {
    console.error("Could not record Unison text contribution", {
      jobId: input.jobId,
      workerId: input.workerId,
      detail: error instanceof Error ? error.message.slice(0, 500) : "Unknown ledger error",
    });
  }
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
      .from("text_inference_jobs")
      .select("id,status,client_owner_ref,conversation_id,worker_id,claimed_at,personal_use,personal_user_id,personal_conversation_id,messages,capability,routing_preference,route_reason,business_id,source_image_job_id")
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
    if (job.status === "cancelled") {
      return NextResponse.json({ ok: true, status: "cancelled" });
    }

    if (typeof body.error === "string" && body.error.trim()) {
      const completedAt = new Date().toISOString();
      const failureUpdate: Record<string, unknown> = {
        status: "failed",
        error: body.error.slice(0, 1200),
        completed_at: completedAt,
        updated_at: completedAt,
      };
      if (job.personal_use) {
        failureUpdate.messages = [
          { role: "system", content: "Personal AI payload removed after local execution." },
        ];
        failureUpdate.partial_text = null;
        failureUpdate.result_text = null;
      }

      const { error: updateError } = await supabase
        .from("text_inference_jobs")
        .update(failureUpdate)
        .eq("id", jobId);

      if (updateError) throw updateError;

      if (job.capability === "media-judge") {
        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt,
          latencyMs: null,
        });

        await updateSourceSemanticJudgeTrace(
          supabase,
          typeof job.source_image_job_id === "string"
            ? job.source_image_job_id
            : null,
          {
            status: "failed",
            version: "semantic-vision-v1",
            judgeJobId: jobId,
            error: body.error.slice(0, 800),
          },
        ).catch((traceError) => {
          console.error("Could not persist semantic judge failure trace", {
            judgeJobId: jobId,
            detail:
              traceError instanceof Error
                ? traceError.message.slice(0, 500)
                : "unknown",
          });
        });

        return NextResponse.json({ ok: true, status: "failed" });
      }

      if (!job.personal_use) {
        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt,
          latencyMs: null,
        });

        try {
          await refreshRuntimeContextAfterOutcome({
            ownerRef: job.client_owner_ref,
            jobId,
            conversationId: job.conversation_id,
            requestType: `${job.capability || "text"} / local failure`,
            allowExternalReview: job.routing_preference !== "require-node",
            businessId: job.business_id || null,
          });
        } catch (contextError) {
          console.error("Could not archive local failure context", {
            jobId,
            detail:
              contextError instanceof Error
                ? contextError.message.slice(0, 600)
                : "Unknown context error",
          });
        }
      }

      return NextResponse.json({ ok: true, status: "failed" });
    }

    if (typeof body.text !== "string" || !body.text.trim() || typeof body.model !== "string") {
      return NextResponse.json({ error: "Invalid completion payload." }, { status: 400 });
    }

    const latencyMs = asCount(body.latencyMs);
    const completedAt = new Date().toISOString();
    const provider =
      typeof body.provider === "string"
        ? body.provider.slice(0, 160)
        : "cooperative-local-text-worker";
    const resultModel = body.model.slice(0, 300);

    const webSearchUsed = body.webSearchUsed === true;
    const webAccessMode =
      body.webAccessMode === "auto" || body.webAccessMode === "always"
        ? body.webAccessMode
        : "off";

    if (job.capability === "media-judge") {
      const sourceImageJobId =
        typeof job.source_image_job_id === "string"
          ? job.source_image_job_id
          : null;

      if (!sourceImageJobId) {
        throw new Error("Semantic media judge job is missing its source image.");
      }

      let report: SemanticJudgeReport;
      try {
        report = parseSemanticJudgeReport(body.text);
      } catch (parseError) {
        const failureDetail =
          parseError instanceof Error
            ? parseError.message.slice(0, 800)
            : "Semantic judge report could not be parsed.";
        const failedAt = new Date().toISOString();

        const { error: failureError } = await supabase
          .from("text_inference_jobs")
          .update({
            status: "failed",
            error: failureDetail,
            result_text: body.text.trim().slice(0, 8000),
            result_model: resultModel,
            result_provider: provider,
            latency_ms: latencyMs,
            completed_at: failedAt,
            updated_at: failedAt,
          })
          .eq("id", jobId);

        if (failureError) throw failureError;

        await updateSourceSemanticJudgeTrace(supabase, sourceImageJobId, {
          status: "failed",
          version: "semantic-vision-v1",
          judgeJobId: jobId,
          model: resultModel,
          provider,
          latencyMs,
          error: failureDetail,
        }).catch(() => undefined);

        await recordUnisonTextUsage(supabase, {
          jobId,
          workerId,
          claimedAt: job.claimed_at,
          status: "failed",
          completedAt: failedAt,
          latencyMs,
        });

        return NextResponse.json({ ok: true, status: "failed" });
      }

      const semanticCompletedAt = new Date().toISOString();
      const { error: semanticUpdateError } = await supabase
        .from("text_inference_jobs")
        .update({
          status: "completed",
          partial_text: body.text.trim(),
          result_text: body.text.trim(),
          result_model: resultModel,
          result_provider: provider,
          prompt_tokens: asCount(body.promptTokens),
          output_tokens: asCount(body.outputTokens),
          latency_ms: latencyMs,
          error: null,
          verification_status: "passed",
          completed_at: semanticCompletedAt,
          updated_at: semanticCompletedAt,
        })
        .eq("id", jobId);

      if (semanticUpdateError) throw semanticUpdateError;

      await updateSourceSemanticJudgeTrace(supabase, sourceImageJobId, {
        status: "completed",
        version: "semantic-vision-v1",
        judgeJobId: jobId,
        model: resultModel,
        provider,
        latencyMs,
        report,
      });

      await recordUnisonTextUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "completed",
        completedAt: semanticCompletedAt,
        latencyMs,
      });

      await recordSemanticJudgeEvidence({
        ownerRef: job.client_owner_ref,
        judgeJobId: jobId,
        sourceImageJobId,
        model: resultModel,
        provider,
        latencyMs,
        report,
      }).catch((evidenceError) => {
        console.error("Could not record semantic judge evidence", {
          judgeJobId: jobId,
          detail:
            evidenceError instanceof Error
              ? evidenceError.message.slice(0, 500)
              : "unknown",
        });
      });

      return NextResponse.json({
        ok: true,
        status: "completed",
        semanticJudge: report,
      });
    }

    const jobUpdate: Record<string, unknown> = {
      status: "completed",
      partial_text: job.personal_use ? null : body.text,
      result_text: job.personal_use ? null : body.text,
      result_model: resultModel,
      result_provider: provider,
      prompt_tokens: asCount(body.promptTokens),
      output_tokens: asCount(body.outputTokens),
      latency_ms: latencyMs,
      error: null,
      completed_at: completedAt,
      updated_at: completedAt,
      ...(webSearchUsed
        ? {
            route_reason: `${job.route_reason || ""} Profile Web ${webAccessMode} authorized a public search on the selected node; model inference remained local.`.trim(),
          }
        : {}),
    };
    if (job.personal_use) {
      jobUpdate.messages = [
        { role: "system", content: "Personal AI payload removed after local execution." },
      ];
    }

    const { error: updateError } = await supabase
      .from("text_inference_jobs")
      .update(jobUpdate)
      .eq("id", jobId);

    if (updateError) throw updateError;

    if (job.personal_use) {
      if (!job.personal_user_id || !job.personal_conversation_id) {
        throw new Error("Personal AI completion is missing its user or conversation.");
      }

      const { error: personalMessageError } = await supabase.rpc(
        "personal_ai_append_message",
        {
          p_user_id: job.personal_user_id,
          p_conversation_id: job.personal_conversation_id,
          p_role: "assistant",
          p_content: body.text.trim(),
          p_source: "node",
          p_source_job_id: jobId,
          p_metadata: {
            model: resultModel,
            provider,
            promptTokens: asCount(body.promptTokens),
            outputTokens: asCount(body.outputTokens),
            latencyMs,
            workerId,
            webSearchUsed,
            webAccessMode,
          },
        },
      );
      if (personalMessageError) throw personalMessageError;
    } else {
      await recordUnisonTextUsage(supabase, {
        jobId,
        workerId,
        claimedAt: job.claimed_at,
        status: "completed",
        completedAt,
        latencyMs,
      });
    }

    if (job.conversation_id) {
      const { error: messageError } = await supabase.from("local_ai_messages").upsert(
        {
          conversation_id: job.conversation_id,
          owner_ref: job.client_owner_ref,
          role: "assistant",
          content: body.text.trim(),
          job_id: jobId,
        },
        { onConflict: "job_id,role" },
      );

      if (messageError) throw messageError;

      const { error: conversationError } = await supabase
        .from("local_ai_conversations")
        .update({ updated_at: completedAt })
        .eq("id", job.conversation_id)
        .eq("owner_ref", job.client_owner_ref);

      if (conversationError) throw conversationError;

      if (
        (job.capability === "text" || job.capability === "vision") &&
        job.routing_preference !== "require-node"
      ) {
        const parsedMessages = z
          .array(textInferenceMessageSchema)
          .min(1)
          .max(40)
          .safeParse(job.messages);
        if (parsedMessages.success) {
          try {
            await persistResponseSupport({
              ownerRef: job.client_owner_ref,
              conversationId: job.conversation_id,
              jobId,
              messages: parsedMessages.data,
              answer: body.text.trim(),
              provider,
              model: resultModel,
              businessId: job.business_id || null,
            });
          } catch (supportError) {
            console.error("Could not persist local response support", {
              jobId,
              detail:
                supportError instanceof Error
                  ? supportError.message.slice(0, 600)
                  : "Unknown support error",
            });
          }
        }
      }
    }

    if (!job.personal_use) {
      try {
        await refreshRuntimeContextAfterOutcome({
          ownerRef: job.client_owner_ref,
          jobId,
          conversationId: job.conversation_id,
          requestType: `${job.capability || "text"} / local success`,
          allowExternalReview: job.routing_preference !== "require-node",
          businessId: job.business_id || null,
        });
      } catch (contextError) {
        console.error("Could not refresh local runtime context", {
          jobId,
          detail:
            contextError instanceof Error
              ? contextError.message.slice(0, 600)
              : "Unknown context error",
        });
      }
    }

    return NextResponse.json({ ok: true, status: "completed" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not complete text inference job.";
    console.error("CoOperative text inference completion failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not complete text inference job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
