import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { textInferenceMessageSchema } from "@/lib/inference/contracts";
import { agentWorkerCanAccessOwner, authorizeAgentWorker } from "@/lib/agents/server";
import {
  preferredOwnedTextNode,
  userIdFromOwnerRef,
} from "@/lib/unison/owned-text-routing";
import {
  cancelHermesTextTask,
  pollHermesTextTask,
  startHermesTextTask,
  type HermesTextContextMessage,
} from "@/lib/inference/hermes-text-cloud";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { buildHostedWebResearch } from "@/lib/inference/public-web-research";
import { preferredRegistryFreeTextModel } from "@/lib/inference/model-capability-registry";

export const runtime = "nodejs";
export const maxDuration = 300;

const AGENT_FREE_TEXT_WORKER_ID = "cooperative-hermes-free-agent-text";
const AGENT_FREE_QUEUE_GRACE_MS = 8_000;
const AGENT_LOCAL_STALL_MS = 120_000;
const AGENT_PROGRESS_STALL_MS = 180_000;
const AGENT_JOB_SELECT =
  "id,status,profile,messages,max_tokens,temperature,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,latency_ms,worker_id,routing_preference,preferred_node_id,error,route_reason,allow_paid_fallback,queued_at,claimed_at,progress_at,created_at,fallback_provider,fallback_model,fallback_sandbox_name,fallback_deadline_at,fallback_attempted_at,fallback_usage,fallback_for_job_id";

const createSchema = z.object({
  taskId: z.string().uuid(),
  messages: z.array(textInferenceMessageSchema).min(1).max(20),
  profile: z.enum(["fast","quality"]).default("fast"),
  maxTokens: z.number().int().min(64).max(4096).default(1600),
  temperature: z.number().min(0).max(1).default(0.1),
});


type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

type AgentTaskForFreeFallback = {
  id: string;
  owner_ref: string;
  status: string;
  result: Record<string, unknown> | null;
};

function hermesMessages(value: unknown): HermesTextContextMessage[] {
  const parsed = z.array(textInferenceMessageSchema).min(1).max(40).safeParse(value);
  if (!parsed.success) return [];
  return parsed.data.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function connectorResearchQuery(result: Record<string, unknown> | null) {
  if (!result || result.kind !== "service_connector_build") return null;
  const providerName =
    typeof result.providerName === "string" ? result.providerName.trim() : "";
  if (!providerName) return null;
  return `${providerName} official developer API OAuth documentation`;
}

function shouldStartFreeFallback(job: Record<string, any>) {
  const now = Date.now();
  const queuedAt = Date.parse(job.queued_at || job.created_at || "");
  if (
    job.status === "queued" &&
    !job.worker_id &&
    job.routing_preference !== "require-node" &&
    Number.isFinite(queuedAt) &&
    now - queuedAt >= AGENT_FREE_QUEUE_GRACE_MS
  ) {
    return true;
  }

  if (job.status !== "running" || job.worker_id === AGENT_FREE_TEXT_WORKER_ID) {
    return job.status === "failed";
  }

  const claimedAt = Date.parse(job.claimed_at || "");
  const progressAt = Date.parse(job.progress_at || "");
  if (Number.isFinite(progressAt)) {
    return now - progressAt >= AGENT_PROGRESS_STALL_MS;
  }
  return Number.isFinite(claimedAt) && now - claimedAt >= AGENT_LOCAL_STALL_MS;
}

async function freeOpenRouterCredential(ownerRef: string) {
  const connected =
    await businessOwnedServiceCredentialForOwner(ownerRef, "openrouter-api");
  return connected?.credential || process.env.OPENROUTER_API_KEY?.trim() || null;
}

async function latestFreeFallback(
  admin: AdminClient,
  taskId: string,
  rootJobId: string,
) {
  const { data, error } = await admin
    .from("text_inference_jobs")
    .select(AGENT_JOB_SELECT)
    .eq("agent_task_id", taskId)
    .eq("fallback_for_job_id", rootJobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, any> | null;
}

async function startFreeFallback(input: {
  admin: AdminClient;
  task: AgentTaskForFreeFallback;
  rootJob: Record<string, any>;
}) {
  const { admin, task, rootJob } = input;
  const existing = await latestFreeFallback(admin, task.id, rootJob.id);
  if (existing) return existing;

  const openRouterCredential = await freeOpenRouterCredential(task.owner_ref);
  if (!openRouterCredential) return null;

  const messages = hermesMessages(rootJob.messages);
  if (!messages.length) return null;

  const now = new Date().toISOString();
  if (rootJob.status === "queued" || rootJob.status === "running") {
    const { data: cancelled, error: cancelError } = await admin
      .from("text_inference_jobs")
      .update({
        status: "cancelled",
        error:
          "Owned/local agent reasoning did not complete in the bounded window; CoOperative moved to a strict-free cloud fallback.",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", rootJob.id)
      .eq("agent_task_id", task.id)
      .in("status", ["queued", "running"])
      .select("id")
      .maybeSingle();
    if (cancelError) throw cancelError;
    if (!cancelled) {
      const { data: refreshed, error: refreshError } = await admin
        .from("text_inference_jobs")
        .select(AGENT_JOB_SELECT)
        .eq("id", rootJob.id)
        .eq("agent_task_id", task.id)
        .maybeSingle();
      if (refreshError) throw refreshError;
      return refreshed as Record<string, any> | null;
    }
  }

  const fallbackModel =
    (await preferredRegistryFreeTextModel({
      requireReasoning: true,
      requireStructuredOutput: false,
    })) || "openrouter/free";
  const fallbackId = crypto.randomUUID();
  const baseReason =
    `${rootJob.route_reason || "Bounded agent reasoning request."} Owned/local reasoning was unavailable, failed, or stalled, so CoOperative is trying strict-free Hermes/OpenRouter before any paid model is suggested.`.trim();

  const { error: insertError } = await admin.from("text_inference_jobs").insert({
    id: fallbackId,
    status: "running",
    client_owner_ref: `agent-task:${task.id}`,
    agent_task_id: task.id,
    messages: rootJob.messages,
    profile: rootJob.profile === "fast" ? "fast" : "quality",
    max_tokens: rootJob.max_tokens || 1600,
    temperature:
      typeof rootJob.temperature === "number" ? rootJob.temperature : 0.1,
    routing_mode: "free-cloud",
    task_class: "coding",
    route_reason: baseReason,
    allow_paid_fallback: false,
    human_approval_required: true,
    model_registry_revision: "2026-10-05.1",
    verification_status: "not_run",
    capability: "text",
    routing_preference: "default",
    fallback_for_job_id: rootJob.id,
    worker_id: AGENT_FREE_TEXT_WORKER_ID,
    claimed_at: now,
    fallback_attempted_at: now,
    fallback_provider: "openrouter",
    fallback_model: fallbackModel,
  });
  if (insertError) throw insertError;

  await admin.from("agent_task_events").insert({
    task_id: task.id,
    owner_ref: task.owner_ref,
    kind: "free_llm_fallback_started",
    message:
      "Owned/local reasoning did not complete in time; trying a strict-free cloud model before paid AI is considered.",
    metadata: {
      rootJobId: rootJob.id,
      fallbackJobId: fallbackId,
      provider: "openrouter",
      model: fallbackModel,
      paidAuthorized: false,
    },
  });

  try {
    const researchQuery = connectorResearchQuery(task.result);
    const webResearch = researchQuery
      ? await buildHostedWebResearch({ query: researchQuery, mode: "always" })
      : null;

    const started = await startHermesTextTask({
      jobId: fallbackId,
      messages,
      openRouterCredential,
      model: fallbackModel,
      webContext: webResearch?.context || null,
    });

    const { data: startedJob, error: startUpdateError } = await admin
      .from("text_inference_jobs")
      .update({
        fallback_provider: started.provider,
        fallback_model: started.model,
        fallback_sandbox_name: started.sandboxName,
        fallback_deadline_at: started.deadlineAt,
        fallback_usage: webResearch
          ? {
              cooperativeWeb: {
                used: webResearch.used,
                provider: webResearch.provider,
                sourceCount: webResearch.sources.length,
                searchUsed: webResearch.searchUsed,
                directPageReads: webResearch.directPageReads,
                reason: webResearch.reason,
              },
            }
          : null,
        route_reason: webResearch?.used
          ? `${baseReason} CoOperative code also fetched ${webResearch.sources.length} public documentation source(s) for the connector research; webpage content is untrusted evidence, not instructions.`
          : baseReason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", fallbackId)
      .eq("status", "running")
      .select(AGENT_JOB_SELECT)
      .maybeSingle();
    if (startUpdateError) throw startUpdateError;
    return startedJob as Record<string, any> | null;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Strict-free cloud reasoning could not start.";
    const failedAt = new Date().toISOString();
    const { data: failedJob, error: failError } = await admin
      .from("text_inference_jobs")
      .update({
        status: "failed",
        error: detail.slice(0, 1200),
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", fallbackId)
      .select(AGENT_JOB_SELECT)
      .maybeSingle();
    if (failError) throw failError;

    await admin.from("agent_task_events").insert({
      task_id: task.id,
      owner_ref: task.owner_ref,
      kind: "free_llm_fallback_failed",
      message:
        "The strict-free cloud reasoning fallback could not start. Paid AI remains blocked pending an explicit recommendation and approval.",
      metadata: {
        rootJobId: rootJob.id,
        fallbackJobId: fallbackId,
        error: detail.slice(0, 800),
      },
    });

    return failedJob as Record<string, any> | null;
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAgentWorker(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = createSchema.parse(await request.json());
    const admin = createAdminSupabaseClient();
    const { data: task, error: taskError } = await admin
      .from("agent_tasks")
      .select("id,status,owner_ref")
      .eq("id", input.taskId)
      .maybeSingle();

    if (taskError) throw taskError;
    if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });
    if (!agentWorkerCanAccessOwner(authorization, task.owner_ref)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!["running","waiting_llm"].includes(task.status)) {
      return NextResponse.json(
        { error: `Task is not active: ${task.status}` },
        { status: 409 },
      );
    }

    const ownerUserId = userIdFromOwnerRef(task.owner_ref);
    const ownedNode = ownerUserId
      ? await preferredOwnedTextNode(admin, ownerUserId)
      : null;
    const jobId = crypto.randomUUID();
    const { error } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: `agent-task:${input.taskId}`,
      agent_task_id: input.taskId,
      messages: input.messages,
      profile: input.profile,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      routing_mode: input.profile === "quality" ? "local-quality" : "local-fast",
      task_class: "coding",
      route_reason: "Bounded local agent reasoning request.",
      allow_paid_fallback: false,
      human_approval_required: true,
      model_registry_revision: "2026-09-30.2",
      verification_status: "not_run",
      capability: "text",
      routing_preference: ownedNode ? "prefer-owned" : "default",
      preferred_node_id: ownedNode?.id ?? null,
    });
    if (error) throw error;

    await admin.from("agent_tasks").update({
      status: "waiting_llm",
      updated_at: new Date().toISOString(),
    }).eq("id", input.taskId);

    return NextResponse.json(
      {
        jobId,
        status: "queued",
        profile: input.profile,
        ownedNodePreferred: Boolean(ownedNode),
        preferredNodeId: ownedNode?.id ?? null,
        preferredNodeName: ownedNode?.displayName ?? null,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not queue agent LLM work.";
    return NextResponse.json(
      { error: "Could not queue agent LLM work.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const authorization = await authorizeAgentWorker(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId") || "";
    const jobId = url.searchParams.get("jobId") || "";
    if (!taskId || !jobId) {
      return NextResponse.json({ error: "taskId and jobId are required." }, { status: 400 });
    }

    const admin = createAdminSupabaseClient();
    const { data: taskRow, error: taskError } = await admin
      .from("agent_tasks")
      .select("id,owner_ref,status,result")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!taskRow) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (!agentWorkerCanAccessOwner(authorization, taskRow.owner_ref)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const task: AgentTaskForFreeFallback = {
      id: taskRow.id,
      owner_ref: taskRow.owner_ref,
      status: taskRow.status,
      result:
        taskRow.result && typeof taskRow.result === "object"
          ? (taskRow.result as Record<string, unknown>)
          : null,
    };

    const { data: rootJob, error: rootError } = await admin
      .from("text_inference_jobs")
      .select(AGENT_JOB_SELECT)
      .eq("id", jobId)
      .eq("agent_task_id", taskId)
      .maybeSingle();
    if (rootError) throw rootError;
    if (!rootJob) return NextResponse.json({ error: "Job not found." }, { status: 404 });

    let effectiveJob =
      (await latestFreeFallback(admin, taskId, rootJob.id)) ||
      (rootJob as Record<string, any>);

    if (
      effectiveJob.id === rootJob.id &&
      shouldStartFreeFallback(rootJob as Record<string, any>)
    ) {
      const started = await startFreeFallback({
        admin,
        task,
        rootJob: rootJob as Record<string, any>,
      });
      if (started) effectiveJob = started;
    }

    if (
      effectiveJob.status === "running" &&
      effectiveJob.worker_id === AGENT_FREE_TEXT_WORKER_ID &&
      effectiveJob.fallback_sandbox_name &&
      effectiveJob.fallback_deadline_at
    ) {
      const polled = await pollHermesTextTask({
        sandboxName: effectiveJob.fallback_sandbox_name,
        deadlineAt: effectiveJob.fallback_deadline_at,
      });

      if (polled.state === "completed" && polled.text) {
        const completedAt = new Date().toISOString();
        const claimedMs = Date.parse(effectiveJob.claimed_at || "");
        const latencyMs = Number.isFinite(claimedMs)
          ? Math.max(0, Date.parse(completedAt) - claimedMs)
          : null;

        const { data: completed, error: completionError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "completed",
            partial_text: polled.text,
            result_text: polled.text,
            result_model: effectiveJob.fallback_model || "openrouter/free",
            result_provider: "openrouter-free",
            latency_ms: latencyMs,
            fallback_usage: {
              ...(effectiveJob.fallback_usage &&
              typeof effectiveJob.fallback_usage === "object" &&
              !Array.isArray(effectiveJob.fallback_usage)
                ? effectiveJob.fallback_usage
                : {}),
              ...(polled.usage || {}),
            },
            error: null,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", effectiveJob.id)
          .eq("worker_id", AGENT_FREE_TEXT_WORKER_ID)
          .eq("status", "running")
          .select(AGENT_JOB_SELECT)
          .maybeSingle();
        if (completionError) throw completionError;
        if (completed) {
          effectiveJob = completed as Record<string, any>;
          await admin.from("agent_task_events").insert({
            task_id: taskId,
            owner_ref: task.owner_ref,
            kind: "free_llm_fallback_completed",
            message:
              "Strict-free cloud reasoning completed after the owned/local attempt stalled or failed.",
            metadata: {
              rootJobId: rootJob.id,
              fallbackJobId: effectiveJob.id,
              provider: effectiveJob.result_provider,
              model: effectiveJob.result_model,
            },
          });
        }
      } else if (polled.state === "failed") {
        const failedAt = new Date().toISOString();
        const detail =
          polled.error || "Strict-free cloud reasoning did not return a usable answer.";
        const { data: failed, error: failureError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "failed",
            error: detail.slice(0, 1200),
            fallback_usage: {
              ...(effectiveJob.fallback_usage &&
              typeof effectiveJob.fallback_usage === "object" &&
              !Array.isArray(effectiveJob.fallback_usage)
                ? effectiveJob.fallback_usage
                : {}),
              ...(polled.usage || {}),
            },
            completed_at: failedAt,
            updated_at: failedAt,
          })
          .eq("id", effectiveJob.id)
          .eq("worker_id", AGENT_FREE_TEXT_WORKER_ID)
          .eq("status", "running")
          .select(AGENT_JOB_SELECT)
          .maybeSingle();
        if (failureError) throw failureError;
        if (failed) {
          effectiveJob = failed as Record<string, any>;
          await admin.from("agent_task_events").insert({
            task_id: taskId,
            owner_ref: task.owner_ref,
            kind: "free_llm_fallback_failed",
            message:
              "Strict-free cloud reasoning also failed. CoOperative can now recommend a paid model, but it remains blocked until explicit approval.",
            metadata: {
              rootJobId: rootJob.id,
              fallbackJobId: effectiveJob.id,
              error: detail.slice(0, 800),
            },
          });
        }
      }
    }

    if (["completed", "failed", "cancelled"].includes(effectiveJob.status)) {
      await admin.from("agent_tasks").update({
        status: "running",
        updated_at: new Date().toISOString(),
      }).eq("id", taskId).eq("status", "waiting_llm");
    }

    return NextResponse.json({
      jobId: rootJob.id,
      actualJobId: effectiveJob.id,
      status: effectiveJob.status,
      profile: effectiveJob.profile,
      partialText: effectiveJob.partial_text,
      text: effectiveJob.result_text,
      model: effectiveJob.result_model || effectiveJob.fallback_model,
      provider: effectiveJob.result_provider || effectiveJob.fallback_provider,
      workerId: effectiveJob.worker_id,
      routingPreference: effectiveJob.routing_preference,
      preferredNodeId: effectiveJob.preferred_node_id,
      promptTokens: effectiveJob.prompt_tokens,
      outputTokens: effectiveJob.output_tokens,
      latencyMs: effectiveJob.latency_ms,
      routeReason: effectiveJob.route_reason,
      freeFallbackUsed: effectiveJob.id !== rootJob.id,
      paidFallbackAllowed: effectiveJob.allow_paid_fallback === true,
      error: effectiveJob.error,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read agent LLM work.";
    return NextResponse.json(
      { error: "Could not read agent LLM work.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}


export async function DELETE(request: Request) {
  const authorization = await authorizeAgentWorker(request);
  if (!authorization.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("taskId") || "";
    const jobId = url.searchParams.get("jobId") || "";
    if (!taskId || !jobId) {
      return NextResponse.json(
        { error: "taskId and jobId are required." },
        { status: 400 },
      );
    }

    const admin = createAdminSupabaseClient();
    const { data: task, error: taskError } = await admin
      .from("agent_tasks")
      .select("id,owner_ref,status")
      .eq("id", taskId)
      .maybeSingle();
    if (taskError) throw taskError;
    if (!task) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (!agentWorkerCanAccessOwner(authorization, task.owner_ref)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: fallbacks, error: fallbackError } = await admin
      .from("text_inference_jobs")
      .select("id,fallback_sandbox_name,status")
      .eq("agent_task_id", taskId)
      .eq("fallback_for_job_id", jobId);
    if (fallbackError) throw fallbackError;

    for (const fallback of fallbacks || []) {
      if (fallback.fallback_sandbox_name) {
        await cancelHermesTextTask(fallback.fallback_sandbox_name).catch(
          () => false,
        );
      }
    }

    const cancelledAt = new Date().toISOString();
    const ids = [
      jobId,
      ...(fallbacks || []).map((fallback) => fallback.id),
    ];

    const { error: cancelError } = await admin
      .from("text_inference_jobs")
      .update({
        status: "cancelled",
        error: "Agent reasoning was cancelled after exceeding its bounded wait.",
        completed_at: cancelledAt,
        updated_at: cancelledAt,
      })
      .in("id", ids)
      .eq("agent_task_id", taskId)
      .in("status", ["queued", "running"]);
    if (cancelError) throw cancelError;

    await admin
      .from("agent_tasks")
      .update({
        status: "running",
        updated_at: cancelledAt,
      })
      .eq("id", taskId)
      .eq("status", "waiting_llm");

    return NextResponse.json(
      { ok: true, status: "cancelled" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not cancel agent LLM work.";
    return NextResponse.json(
      { error: "Could not cancel agent LLM work.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
