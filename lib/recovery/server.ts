import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import {
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import { classifyRecoveryFailure } from "@/lib/recovery/classifier";

type TextRecoveryJob = {
  id: string;
  status: string;
  client_owner_ref: string;
  conversation_id: string | null;
  error: string | null;
  messages: unknown;
  profile: string | null;
  max_tokens: number | null;
  temperature: number | null;
  routing_mode: string | null;
  task_class: string | null;
  allow_paid_fallback: boolean | null;
  human_approval_required: boolean | null;
  model_registry_revision: string | null;
  verification_status: string | null;
  attachment_ids: string[] | null;
  capability: string | null;
  routing_preference: string | null;
  model_mixer: unknown;
  request_max_spend_microusd: number | null;
  personal_use: boolean;
  personal_user_id: string | null;
  personal_conversation_id: string | null;
  target_node_id: string | null;
};

type MediaRecoveryJob = {
  id: string;
  status: string;
  owner_ref: string;
  conversation_id: string | null;
  kind: "image" | "video";
  prompt: string;
  provider: string;
  model: string;
  model_mixer: unknown;
  request_max_spend_microusd: number | null;
  media_level: number | null;
  estimated_provider_cost_microusd: number | null;
  pricing_source: string | null;
  error: string | null;
};

type RecoveryIncidentRow = {
  id: string;
  owner_ref: string;
  conversation_id: string | null;
  personal_conversation_id: string | null;
  source_kind: "text" | "media" | "connector" | "runtime";
  source_job_id: string | null;
  status: string;
  error_class: string;
  error_excerpt: string | null;
  current_message: string;
  continuation_prompt: string | null;
  requires_user_action: boolean;
  automatic_retry: boolean;
  agent_task_id: string | null;
  retry_job_id: string | null;
  attempt_count: number;
  resolution_summary: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type FailedSource =
  | {
      kind: "text";
      job: TextRecoveryJob;
      conversationId: string | null;
      error: string;
    }
  | {
      kind: "media";
      job: MediaRecoveryJob;
      conversationId: string | null;
      error: string;
    };

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

function nowIso() {
  return new Date().toISOString();
}

function safeError(value: unknown) {
  if (typeof value !== "string") return "Unknown execution failure.";
  return value.replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]").slice(0, 1200);
}

async function addEvent(
  admin: AdminClient,
  incidentId: string,
  ownerRef: string,
  kind: string,
  message: string,
  metadata: Record<string, unknown> | null = null,
) {
  const { error } = await admin.from("recovery_events").insert({
    incident_id: incidentId,
    owner_ref: ownerRef,
    kind: kind.slice(0, 80),
    message: message.slice(0, 3000),
    metadata,
  });
  if (error) throw error;
}

async function readFailedSource(
  admin: AdminClient,
  ownerRef: string,
  sourceJobId: string,
): Promise<FailedSource | null> {
  const { data: textJob, error: textError } = await admin
    .from("text_inference_jobs")
    .select(
      "id,status,client_owner_ref,conversation_id,error,messages,profile,max_tokens,temperature,routing_mode,task_class,allow_paid_fallback,human_approval_required,model_registry_revision,verification_status,attachment_ids,capability,routing_preference,model_mixer,request_max_spend_microusd,personal_use,personal_user_id,personal_conversation_id,target_node_id",
    )
    .eq("id", sourceJobId)
    .eq("client_owner_ref", ownerRef)
    .maybeSingle();
  if (textError) throw textError;

  if (textJob) {
    return {
      kind: "text",
      job: textJob as TextRecoveryJob,
      conversationId: textJob.conversation_id || null,
      error: safeError(textJob.error),
    };
  }

  const { data: mediaJob, error: mediaError } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,owner_ref,conversation_id,kind,prompt,provider,model,model_mixer,request_max_spend_microusd,media_level,estimated_provider_cost_microusd,pricing_source,error",
    )
    .eq("id", sourceJobId)
    .eq("owner_ref", ownerRef)
    .maybeSingle();
  if (mediaError) throw mediaError;

  if (mediaJob) {
    return {
      kind: "media",
      job: mediaJob as MediaRecoveryJob,
      conversationId: mediaJob.conversation_id || null,
      error: safeError(mediaJob.error),
    };
  }

  return null;
}

async function queueDebuggerTask(
  admin: AdminClient,
  ownerRef: string,
  incidentId: string,
  source: FailedSource,
) {
  const taskId = crypto.randomUUID();
  const objective = [
    "BACKGROUND RECOVERY INCIDENT",
    "Incident: " + incidentId,
    "Failed route: " + source.kind,
    "Source job: " + source.job.id,
    "Failure evidence: " + source.error,
    "",
    "Diagnose this CoOperative runtime failure from repository evidence and prepare the smallest bounded repair if code/configuration is responsible.",
    "Do not read or modify secrets. Do not broaden permissions, spending limits, or auth scopes.",
    "Prefer deterministic fixes and existing routing patterns. Preserve owned/local and free/included execution before paid escalation.",
    "Relevant areas commonly include app/api/local-ai, lib/inference, lib/integrations, lib/recovery, and the chat UI.",
    "If the failure is external/transient and no code change is justified, return a no-change summary explaining the safe retry condition.",
  ].join("\n");

  const { error: taskError } = await admin.from("agent_tasks").insert({
    id: taskId,
    owner_ref: ownerRef,
    agent_key: "debugger",
    repo_key: "cooperative",
    mode: "prepare_change",
    objective: objective.slice(0, 12000),
    requested_profile: "quality",
    status: "queued",
  });
  if (taskError) throw taskError;

  await admin.from("agent_task_events").insert({
    task_id: taskId,
    owner_ref: ownerRef,
    kind: "queued",
    message: "Recovery debugger queued against CoOperative.",
    metadata: {
      incidentId,
      sourceKind: source.kind,
      sourceJobId: source.job.id,
      executorPolicy: "local-first",
    },
  });

  const { error: incidentError } = await admin
    .from("recovery_incidents")
    .update({
      agent_task_id: taskId,
      status: "repairing",
      current_message:
        "Recovery Agent is tracing the failed route with the local debugger in the background.",
      updated_at: nowIso(),
    })
    .eq("id", incidentId)
    .eq("owner_ref", ownerRef);
  if (incidentError) throw incidentError;

  await addEvent(
    admin,
    incidentId,
    ownerRef,
    "debugger_queued",
    "Local Debugger was queued to inspect the failed route.",
    { taskId, modelPolicy: "local-first" },
  );

  return taskId;
}

async function retryTextJob(
  admin: AdminClient,
  ownerRef: string,
  incidentId: string,
  source: Extract<FailedSource, { kind: "text" }>,
) {
  const job = source.job;
  if (job.status !== "failed") return null;

  const retryJobId = crypto.randomUUID();

  let retryMessages = job.messages;
  if (job.personal_use) {
    if (
      !job.personal_user_id ||
      !job.personal_conversation_id ||
      !job.target_node_id
    ) {
      throw new Error(
        "Personal AI recovery is missing its user, conversation, or local node.",
      );
    }

    const { data: history, error: historyError } = await admin.rpc(
      "personal_ai_read_messages",
      {
        p_user_id: job.personal_user_id,
        p_conversation_id: job.personal_conversation_id,
      },
    );
    if (historyError) throw historyError;

    const recent = (history || [])
      .slice(-24)
      .filter(
        (message: Record<string, unknown>) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string",
      )
      .map((message: Record<string, unknown>) => ({
        role: message.role,
        content: message.content,
      }));

    retryMessages = [
      {
        role: "system",
        content:
          "You are CoOperative Personal AI running on the user's own Windows PC. " +
          "Be useful, clear, practical, and honest. This is personal use, not contributed compute. " +
          "Do not claim to have used cloud inference or paid APIs.",
      },
      ...recent,
    ];
  }

  const { error } = await admin.from("text_inference_jobs").insert({
    id: retryJobId,
    status: "queued",
    client_owner_ref: ownerRef,
    conversation_id: job.personal_use ? null : job.conversation_id,
    messages: retryMessages,
    attachment_ids: job.attachment_ids || [],
    capability: job.capability || "text",
    profile: job.profile || "fast",
    max_tokens: job.max_tokens || 768,
    temperature: job.temperature ?? 0.2,
    routing_mode: job.routing_mode || "local-fast",
    task_class: job.task_class || "general",
    route_reason: job.personal_use
      ? "Recovery Agent retry for " +
        job.id +
        ". Personal AI remains pinned to the same authorized local PC; no cloud or paid inference is allowed."
      : "Recovery Agent retry for " +
        job.id +
        ". Previous route failed; node pinning cleared so the next eligible free/local route can claim it.",
    allow_paid_fallback: job.personal_use ? false : job.allow_paid_fallback === true,
    human_approval_required: false,
    model_registry_revision:
      job.model_registry_revision || TEXT_MODEL_REGISTRY_REVISION,
    verification_status: "not_run",
    routing_preference: job.personal_use ? "require-node" : "default",
    preferred_node_id: null,
    target_node_id: job.personal_use ? job.target_node_id : null,
    personal_use: job.personal_use,
    personal_user_id: job.personal_use ? job.personal_user_id : null,
    personal_conversation_id: job.personal_use
      ? job.personal_conversation_id
      : null,
    model_mixer: job.personal_use ? null : job.model_mixer || null,
    request_max_spend_microusd: job.personal_use
      ? null
      : job.request_max_spend_microusd ?? null,
  });
  if (error) throw error;

  const { error: incidentError } = await admin
    .from("recovery_incidents")
    .update({
      status: "retrying",
      retry_job_id: retryJobId,
      automatic_retry: true,
      attempt_count: 1,
      current_message:
        "Recovery Agent rerouted the original request and is retrying it through the next eligible free/local path.",
      updated_at: nowIso(),
    })
    .eq("id", incidentId)
    .eq("owner_ref", ownerRef);
  if (incidentError) throw incidentError;

  await addEvent(
    admin,
    incidentId,
    ownerRef,
    "retry_started",
    job.personal_use
      ? "Original Personal AI request was requeued on the same authorized local PC."
      : "Original text request was requeued with node pinning cleared.",
    {
      retryJobId,
      spendChanged: false,
      personalLocalOnly: job.personal_use,
      targetNodeId: job.personal_use ? job.target_node_id : null,
    },
  );

  return retryJobId;
}

async function retryFreeMediaJob(
  admin: AdminClient,
  ownerRef: string,
  incidentId: string,
  source: Extract<FailedSource, { kind: "media" }>,
) {
  const job = source.job;
  const estimatedCost = Number(job.estimated_provider_cost_microusd || 0);
  if (job.status !== "failed" || estimatedCost > 0) return null;

  const retryJobId = crypto.randomUUID();
  const { error: insertError } = await admin.from("media_generation_jobs").insert({
    id: retryJobId,
    status: "queued",
    owner_ref: ownerRef,
    conversation_id: job.conversation_id,
    kind: job.kind,
    prompt: job.prompt,
    provider: job.provider,
    model: job.model,
    model_mixer: job.model_mixer || null,
    request_max_spend_microusd: job.request_max_spend_microusd ?? null,
    media_level: job.media_level ?? 0,
    estimated_provider_cost_microusd: 0,
    pricing_source: job.pricing_source || "recovery-retry",
  });
  if (insertError) throw insertError;

  const [openRouter, nousAuth] = await Promise.all([
    job.provider === "openrouter"
      ? businessOwnedServiceCredentialForOwner(ownerRef, "openrouter-api")
      : Promise.resolve(null),
    freshNousRuntimeAuthForOwner(ownerRef).catch(() => null),
  ]);

  try {
    const started = await startHermesMediaTask({
      jobId: retryJobId,
      kind: job.kind,
      userRequest: job.prompt,
      provider: job.provider,
      model: job.model,
      providerCredential: openRouter?.credential,
      nousAuthJson: nousAuth?.sandboxAuthJson,
    });

    const { error: startError } = await admin
      .from("media_generation_jobs")
      .update({
        status: "running",
        sandbox_name: started.sandboxName,
        started_at: started.startedAt,
        deadline_at: started.deadlineAt,
        updated_at: nowIso(),
      })
      .eq("id", retryJobId)
      .eq("owner_ref", ownerRef);
    if (startError) throw startError;

    await admin
      .from("recovery_incidents")
      .update({
        status: "retrying",
        retry_job_id: retryJobId,
        automatic_retry: true,
        attempt_count: 1,
        current_message:
          "Recovery Agent restarted the original free media request through a fresh Hermes worker.",
        updated_at: nowIso(),
      })
      .eq("id", incidentId)
      .eq("owner_ref", ownerRef);

    await addEvent(
      admin,
      incidentId,
      ownerRef,
      "retry_started",
      "Free media generation was restarted in a fresh Hermes sandbox.",
      {
        retryJobId,
        provider: job.provider,
        model: job.model,
        spendChanged: false,
      },
    );

    return retryJobId;
  } catch (error) {
    const detail = safeError(error instanceof Error ? error.message : error);
    await admin
      .from("media_generation_jobs")
      .update({
        status: "failed",
        error: detail,
        completed_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", retryJobId)
      .eq("owner_ref", ownerRef);

    await addEvent(
      admin,
      incidentId,
      ownerRef,
      "retry_failed_to_start",
      "The automatic free media retry could not start, so the debugger path will inspect the route.",
    );
    return null;
  }
}

async function appendRecoveryMessage(
  admin: AdminClient,
  ownerRef: string,
  conversationId: string | null,
  incidentId: string,
  currentMessage: string,
  continuationPrompt: string,
) {
  if (!conversationId) return;

  const content = [
    currentMessage,
    "",
    continuationPrompt,
    "",
    "RECOVERY_STATUS:" + incidentId,
  ].join("\n");

  const { error } = await admin.from("local_ai_messages").insert({
    conversation_id: conversationId,
    owner_ref: ownerRef,
    role: "assistant",
    content,
    attachment_ids: [],
    job_id: null,
  });
  if (error) throw error;

  await admin
    .from("local_ai_conversations")
    .update({ updated_at: nowIso() })
    .eq("id", conversationId)
    .eq("owner_ref", ownerRef);
}

export async function startRecoveryForJob(
  ownerRef: string,
  sourceJobId: string,
) {
  const admin = createAdminSupabaseClient();
  const source = await readFailedSource(admin, ownerRef, sourceJobId);
  if (!source) {
    throw new Error("Failed job was not found for recovery.");
  }

  const { data: existing, error: existingError } = await admin
    .from("recovery_incidents")
    .select("*")
    .eq("owner_ref", ownerRef)
    .eq("source_kind", source.kind)
    .eq("source_job_id", sourceJobId)
    .in("status", ["diagnosing", "repairing", "waiting_user", "retrying"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const classification = classifyRecoveryFailure(source.error, source.kind);
  const incidentId = crypto.randomUUID();

  const { data: incident, error: insertError } = await admin
    .from("recovery_incidents")
    .insert({
      id: incidentId,
      owner_ref: ownerRef,
      conversation_id: source.conversationId,
      source_kind: source.kind,
      source_job_id: sourceJobId,
      status:
        classification.strategy === "wait-user" ? "waiting_user" : "diagnosing",
      error_class: classification.errorClass,
      error_excerpt: source.error,
      current_message: classification.currentMessage,
      continuation_prompt: classification.continuationPrompt,
      requires_user_action: classification.requiresUserAction,
      automatic_retry: false,
    })
    .select("*")
    .single();
  if (insertError) throw insertError;

  await addEvent(
    admin,
    incidentId,
    ownerRef,
    "detected",
    "Recovery Agent captured the failed route and classified it deterministically.",
    {
      errorClass: classification.errorClass,
      sourceKind: source.kind,
      publicDetail: classification.publicDetail,
    },
  );

  if (classification.strategy === "wait-user") {
    await addEvent(
      admin,
      incidentId,
      ownerRef,
      "waiting_user",
      classification.publicDetail,
    );
  } else if (classification.strategy === "retry-route") {
    const retryJobId =
      source.kind === "text"
        ? await retryTextJob(admin, ownerRef, incidentId, source)
        : await retryFreeMediaJob(admin, ownerRef, incidentId, source);

    if (!retryJobId) {
      await queueDebuggerTask(admin, ownerRef, incidentId, source);
    }
  } else if (classification.strategy === "repair-code") {
    await queueDebuggerTask(admin, ownerRef, incidentId, source);
  }

  await appendRecoveryMessage(
    admin,
    ownerRef,
    source.conversationId,
    incidentId,
    classification.currentMessage,
    classification.continuationPrompt,
  );

  const { data: refreshed, error: refreshError } = await admin
    .from("recovery_incidents")
    .select("*")
    .eq("id", incidentId)
    .eq("owner_ref", ownerRef)
    .single();
  if (refreshError) throw refreshError;
  return refreshed || incident;
}

async function finalizeTextRetry(
  admin: AdminClient,
  incident: RecoveryIncidentRow,
) {
  if (!incident.retry_job_id) return incident;

  const { data: job, error } = await admin
    .from("text_inference_jobs")
    .select("id,status,error")
    .eq("id", incident.retry_job_id)
    .eq("client_owner_ref", incident.owner_ref)
    .maybeSingle();
  if (error) throw error;
  if (!job) return incident;

  if (job.status === "completed") {
    const message =
      "Recovery Agent fixed the route and the original request completed successfully.";
    await admin
      .from("recovery_incidents")
      .update({
        status: "completed",
        current_message: message,
        resolution_summary:
          "Automatic free/local reroute completed the original request.",
        resolved_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", incident.id)
      .eq("owner_ref", incident.owner_ref);
    await addEvent(
      admin,
      incident.id,
      incident.owner_ref,
      "completed",
      "The automatic retry completed successfully.",
      { retryJobId: job.id },
    );
    return { ...incident, status: "completed", current_message: message };
  }

  if (job.status === "failed" && !incident.agent_task_id) {
    await addEvent(
      admin,
      incident.id,
      incident.owner_ref,
      "retry_failed",
      "The automatic reroute also failed; Recovery Agent is escalating to the debugger.",
      { retryJobId: job.id },
    );
    const source = await readFailedSource(
      admin,
      incident.owner_ref,
      String(job.id),
    );
    if (source) {
      await queueDebuggerTask(admin, incident.owner_ref, incident.id, source);
    }
  }

  return incident;
}

async function finalizeMediaRetry(
  admin: AdminClient,
  incident: RecoveryIncidentRow,
) {
  if (!incident.retry_job_id) return incident;

  const { data: job, error } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,conversation_id,kind,provider,model,sandbox_name,deadline_at,error",
    )
    .eq("id", incident.retry_job_id)
    .eq("owner_ref", incident.owner_ref)
    .maybeSingle();
  if (error) throw error;
  if (!job) return incident;

  if (job.status === "running" && job.sandbox_name && job.deadline_at) {
    const polled = await pollHermesMediaTask({
      sandboxName: job.sandbox_name,
      deadlineAt: job.deadline_at,
    });

    if (polled.state === "completed" && polled.mediaUrl) {
      const marker = job.kind === "video" ? "MEDIA_VIDEO:" : "MEDIA_IMAGE:";
      const resultText =
        "Generated " +
        job.kind +
        " with " +
        job.model +
        ".\n" +
        marker +
        polled.mediaUrl;
      const completedAt = nowIso();

      await admin
        .from("media_generation_jobs")
        .update({
          status: "completed",
          result_url: polled.mediaUrl,
          result_text: resultText,
          usage: polled.usage,
          error: null,
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", job.id)
        .eq("owner_ref", incident.owner_ref)
        .eq("status", "running");

      if (job.conversation_id) {
        await admin.from("local_ai_messages").insert({
          conversation_id: job.conversation_id,
          owner_ref: incident.owner_ref,
          role: "assistant",
          content: resultText,
          attachment_ids: [],
          job_id: null,
        });
        await admin
          .from("local_ai_conversations")
          .update({ updated_at: completedAt })
          .eq("id", job.conversation_id)
          .eq("owner_ref", incident.owner_ref);
      }

      const message =
        "Recovery Agent repaired the route and the original media request completed successfully.";
      await admin
        .from("recovery_incidents")
        .update({
          status: "completed",
          current_message: message,
          resolution_summary:
            "Fresh free Hermes media retry completed the original request.",
          resolved_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", incident.id)
        .eq("owner_ref", incident.owner_ref);

      await addEvent(
        admin,
        incident.id,
        incident.owner_ref,
        "completed",
        "The free media retry completed successfully.",
        { retryJobId: job.id, provider: job.provider, model: job.model },
      );

      return { ...incident, status: "completed", current_message: message };
    }

    if (polled.state === "failed") {
      const failure = safeError(polled.error);
      await admin
        .from("media_generation_jobs")
        .update({
          status: "failed",
          usage: polled.usage,
          error: failure,
          completed_at: nowIso(),
          updated_at: nowIso(),
        })
        .eq("id", job.id)
        .eq("owner_ref", incident.owner_ref);
    }
  }

  const { data: latestJob } = await admin
    .from("media_generation_jobs")
    .select("id,status,error")
    .eq("id", job.id)
    .eq("owner_ref", incident.owner_ref)
    .maybeSingle();

  if (latestJob?.status === "failed" && !incident.agent_task_id) {
    await addEvent(
      admin,
      incident.id,
      incident.owner_ref,
      "retry_failed",
      "The fresh free media retry also failed; Recovery Agent is escalating to the debugger.",
      { retryJobId: latestJob.id },
    );
    const source = await readFailedSource(
      admin,
      incident.owner_ref,
      String(latestJob.id),
    );
    if (source) {
      await queueDebuggerTask(admin, incident.owner_ref, incident.id, source);
    }
  }

  return incident;
}

async function syncDebuggerStatus(
  admin: AdminClient,
  incident: RecoveryIncidentRow,
) {
  if (!incident.agent_task_id) return incident;

  const { data: task, error } = await admin
    .from("agent_tasks")
    .select("id,status,result,error,branch_name,updated_at,completed_at")
    .eq("id", incident.agent_task_id)
    .eq("owner_ref", incident.owner_ref)
    .maybeSingle();
  if (error) throw error;
  if (!task) return incident;

  if (task.status === "running" || task.status === "waiting_llm") {
    const current =
      task.status === "waiting_llm"
        ? "Recovery Agent is using the local model to diagnose the route."
        : "Recovery Agent is inspecting repository evidence and deterministic checks.";
    if (current !== incident.current_message) {
      await admin
        .from("recovery_incidents")
        .update({ current_message: current, updated_at: nowIso() })
        .eq("id", incident.id)
        .eq("owner_ref", incident.owner_ref);
    }
    return { ...incident, current_message: current };
  }

  if (task.status === "needs_approval") {
    const result =
      task.result && typeof task.result === "object"
        ? (task.result as Record<string, unknown>)
        : {};
    const checksPassed = result.checksPassed === true;
    const changedFiles = Array.isArray(result.changedFiles)
      ? result.changedFiles.filter(
          (item): item is string => typeof item === "string",
        )
      : [];

    const message = checksPassed
      ? "Recovery Agent prepared a bounded repair and the deterministic checks passed. Automatic application of code patches is not enabled yet, so the repair is ready for review."
      : "Recovery Agent prepared a possible repair, but verification is not clean enough to apply automatically.";

    await admin
      .from("recovery_incidents")
      .update({
        status: "waiting_user",
        requires_user_action: true,
        current_message: message,
        resolution_summary:
          typeof result.summary === "string"
            ? result.summary.slice(0, 3000)
            : null,
        updated_at: nowIso(),
      })
      .eq("id", incident.id)
      .eq("owner_ref", incident.owner_ref);

    await addEvent(
      admin,
      incident.id,
      incident.owner_ref,
      "repair_prepared",
      checksPassed
        ? "Debugger prepared a bounded patch and deterministic checks passed."
        : "Debugger prepared a patch, but verification needs attention.",
      {
        changedFiles: changedFiles.slice(0, 12),
        checksPassed,
        branchName: task.branch_name || null,
      },
    );

    return {
      ...incident,
      status: "waiting_user",
      requires_user_action: true,
      current_message: message,
    };
  }

  if (task.status === "completed") {
    const message =
      "Recovery Agent finished diagnosis and did not find a code change that should be applied automatically.";
    await admin
      .from("recovery_incidents")
      .update({
        status: "completed",
        current_message: message,
        resolution_summary:
          task.result &&
          typeof task.result === "object" &&
          typeof (task.result as Record<string, unknown>).analysis === "string"
            ? String((task.result as Record<string, unknown>).analysis).slice(
                0,
                3000,
              )
            : null,
        resolved_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", incident.id)
      .eq("owner_ref", incident.owner_ref);
    await addEvent(
      admin,
      incident.id,
      incident.owner_ref,
      "diagnosis_completed",
      "Recovery diagnosis completed without an automatic code change.",
    );
    return { ...incident, status: "completed", current_message: message };
  }

  if (task.status === "failed") {
    const message =
      "Recovery Agent could not complete the repair automatically. The failure is preserved with diagnostics instead of retrying endlessly.";
    await admin
      .from("recovery_incidents")
      .update({
        status: "failed",
        current_message: message,
        resolution_summary: safeError(task.error),
        resolved_at: nowIso(),
        updated_at: nowIso(),
      })
      .eq("id", incident.id)
      .eq("owner_ref", incident.owner_ref);
    await addEvent(
      admin,
      incident.id,
      incident.owner_ref,
      "failed",
      "Background debugger stopped after the bounded repair attempt failed.",
    );
    return { ...incident, status: "failed", current_message: message };
  }

  return incident;
}

export async function refreshRecoveryIncident(
  ownerRef: string,
  incidentId: string,
) {
  const admin = createAdminSupabaseClient();
  const { data: incident, error } = await admin
    .from("recovery_incidents")
    .select("*")
    .eq("id", incidentId)
    .eq("owner_ref", ownerRef)
    .maybeSingle();
  if (error) throw error;
  if (!incident) return null;

  let current = incident as RecoveryIncidentRow;

  if (current.status === "retrying" && current.retry_job_id) {
    current =
      current.source_kind === "media"
        ? await finalizeMediaRetry(admin, current)
        : await finalizeTextRetry(admin, current);
  }

  if (
    current.agent_task_id &&
    ["diagnosing", "repairing", "retrying"].includes(current.status)
  ) {
    current = await syncDebuggerStatus(admin, current);
  }

  const { data: latest, error: latestError } = await admin
    .from("recovery_incidents")
    .select("*")
    .eq("id", incidentId)
    .eq("owner_ref", ownerRef)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) return null;

  const { data: events, error: eventsError } = await admin
    .from("recovery_events")
    .select("id,kind,message,metadata,created_at")
    .eq("incident_id", incidentId)
    .eq("owner_ref", ownerRef)
    .order("created_at", { ascending: true });
  if (eventsError) throw eventsError;

  if (latest.agent_task_id) {
    const { data: agentEvents } = await admin
      .from("agent_task_events")
      .select("id,kind,message,metadata,created_at")
      .eq("task_id", latest.agent_task_id)
      .eq("owner_ref", ownerRef)
      .order("created_at", { ascending: true });

    const safeAgentEvents = (agentEvents || []).map((event) => {
      const rawMeta =
        event.metadata && typeof event.metadata === "object"
          ? (event.metadata as Record<string, unknown>)
          : {};
      return {
        id: "agent-" + event.id,
        kind: "agent_" + event.kind,
        message: event.message,
        metadata: {
          model: typeof rawMeta.model === "string" ? rawMeta.model : undefined,
          executor:
            typeof rawMeta.executor === "string" ? rawMeta.executor : undefined,
          checks: Array.isArray(rawMeta.checks) ? rawMeta.checks : undefined,
        },
        created_at: event.created_at,
      };
    });

    return {
      incident: latest,
      events: [...(events || []), ...safeAgentEvents].sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)),
      ),
    };
  }

  return { incident: latest, events: events || [] };
}

export async function listRecoveryIncidents(
  ownerRef: string,
  conversationId: string,
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("recovery_incidents")
    .select("*")
    .eq("owner_ref", ownerRef)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw error;
  return data || [];
}
