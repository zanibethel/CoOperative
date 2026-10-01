import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type CountMap = Record<string, number>;

function countBy<T>(rows: T[], key: (row: T) => string | null | undefined) {
  const result: CountMap = {};
  for (const row of rows) {
    const value = key(row) || "unknown";
    result[value] = (result[value] || 0) + 1;
  }
  return result;
}

function round(value: number, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const OWNER_DISPLAY_TIME_ZONE = "America/Chicago";

function formatOwnerLocalTimestamp(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OWNER_DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export async function collectOwnerImprovementEvidence(userId: string) {
  const admin = createAdminSupabaseClient();
  const ownerRef = `coop-user:${userId}`;

  const [
    { data: textJobs, error: textError },
    { data: agentTasks, error: agentError },
    { data: agentEvents, error: eventError },
    { data: conversations, error: conversationError },
    { data: messages, error: messageError },
    { data: nodes, error: nodeError },
    { data: usage, error: usageError },
  ] = await Promise.all([
    admin
      .from("text_inference_jobs")
      .select(
        "status,profile,result_model,result_provider,prompt_tokens,output_tokens,latency_ms,worker_id,routing_mode,task_class,verification_status,created_at,completed_at",
      )
      .eq("client_owner_ref", ownerRef)
      .order("created_at", { ascending: false })
      .limit(500),
    admin
      .from("agent_tasks")
      .select("agent_key,repo_key,mode,status,requested_profile,worker_id,created_at,completed_at")
      .eq("owner_ref", ownerRef)
      .order("created_at", { ascending: false })
      .limit(250),
    admin
      .from("agent_task_events")
      .select("kind,created_at")
      .eq("owner_ref", ownerRef)
      .order("created_at", { ascending: false })
      .limit(1000),
    admin
      .from("local_ai_conversations")
      .select("id,created_at,updated_at")
      .eq("owner_ref", ownerRef),
    admin
      .from("local_ai_messages")
      .select("id,role,created_at")
      .eq("owner_ref", ownerRef)
      .limit(5000),
    admin
      .from("unison_nodes")
      .select("id,state,worker_version,last_seen_at,capabilities,resources,node_class"),
    admin
      .from("unison_usage_ledger")
      .select(
        "status,source_job_type,compute_seconds,gpu_seconds,cpu_seconds,earned_cents,estimated_external_cost_cents,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const firstError =
    textError ||
    agentError ||
    eventError ||
    conversationError ||
    messageError ||
    nodeError ||
    usageError;
  if (firstError) throw firstError;

  const jobs = textJobs || [];
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const promptTokens = completedJobs.reduce(
    (sum, job) => sum + Number(job.prompt_tokens || 0),
    0,
  );
  const outputTokens = completedJobs.reduce(
    (sum, job) => sum + Number(job.output_tokens || 0),
    0,
  );
  const latencies = completedJobs
    .map((job) => Number(job.latency_ms || 0))
    .filter((value) => value > 0);
  const avgLatencyMs = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : 0;

  const now = Date.now();
  const nodeRows = nodes || [];
  const nodeStatus = nodeRows.map((node) => {
    const lastSeen = Date.parse(node.last_seen_at);
    const online =
      Number.isFinite(lastSeen) && now - lastSeen <= 90_000;
    return {
      status: online ? node.state : "offline",
      workerVersion: node.worker_version,
      nodeClass: node.node_class,
      capabilitiesCount: Array.isArray(node.capabilities)
        ? node.capabilities.length
        : 0,
      hasResources:
        Boolean(node.resources) &&
        typeof node.resources === "object" &&
        Object.keys(node.resources as object).length > 0,
    };
  });

  const usageRows = usage || [];
  const completedUsage = usageRows.filter((entry) => entry.status === "completed");

  const generatedAt = new Date();

  return {
    generatedAt: generatedAt.toISOString(),
    generatedAtLocal: formatOwnerLocalTimestamp(generatedAt),
    displayTimeZone: OWNER_DISPLAY_TIME_ZONE,
    scope: "owner-platform",
    privacy: {
      rawConversationContentIncluded: false,
      rawTenantDocumentsIncluded: false,
      credentialsIncluded: false,
      note:
        "This evidence pack contains aggregate operational metrics only. It excludes raw chat content, tenant documents, and credentials.",
    },
    chat: {
      conversations: conversations?.length || 0,
      messages: messages?.length || 0,
      messagesByRole: countBy(messages || [], (message) => message.role),
    },
    inference: {
      totalJobs: jobs.length,
      completed: completedJobs.length,
      failed: failedJobs.length,
      queued: jobs.filter((job) => job.status === "queued").length,
      running: jobs.filter((job) => job.status === "running").length,
      cancelled: jobs.filter((job) => job.status === "cancelled").length,
      successRatePercent: jobs.length
        ? round((completedJobs.length / jobs.length) * 100, 1)
        : 0,
      promptTokens,
      outputTokens,
      totalTokens: promptTokens + outputTokens,
      averageLatencySeconds: round(avgLatencyMs / 1000, 1),
      byProfile: countBy(jobs, (job) => job.profile),
      byTaskClass: countBy(jobs, (job) => job.task_class),
      byRoutingMode: countBy(jobs, (job) => job.routing_mode),
      byVerificationStatus: countBy(jobs, (job) => job.verification_status),
      byProvider: countBy(completedJobs, (job) => job.result_provider),
      byModel: countBy(completedJobs, (job) => job.result_model),
    },
    agents: {
      totalTasks: agentTasks?.length || 0,
      byStatus: countBy(agentTasks || [], (task) => task.status),
      byAgent: countBy(agentTasks || [], (task) => task.agent_key),
      byMode: countBy(agentTasks || [], (task) => task.mode),
      events: agentEvents?.length || 0,
      eventsByKind: countBy(agentEvents || [], (event) => event.kind),
    },
    unison: {
      nodes: nodeRows.length,
      nodesByStatus: countBy(nodeStatus, (node) => node.status),
      nodesWithWorkerCheckIn: nodeStatus.filter(
        (node) => node.workerVersion && node.workerVersion !== "paired",
      ).length,
      nodesWithHardwareReport: nodeStatus.filter((node) => node.hasResources).length,
      usageEntries: usageRows.length,
      completedJobs: completedUsage.length,
      failedJobs: usageRows.filter((entry) => entry.status === "failed").length,
      computeSeconds: completedUsage.reduce(
        (sum, entry) => sum + Number(entry.compute_seconds || 0),
        0,
      ),
      gpuSeconds: completedUsage.reduce(
        (sum, entry) => sum + Number(entry.gpu_seconds || 0),
        0,
      ),
      cpuSeconds: completedUsage.reduce(
        (sum, entry) => sum + Number(entry.cpu_seconds || 0),
        0,
      ),
      earnedCents: completedUsage.reduce(
        (sum, entry) => sum + Number(entry.earned_cents || 0),
        0,
      ),
      estimatedExternalCostAvoidedCents: completedUsage.reduce(
        (sum, entry) =>
          sum + Number(entry.estimated_external_cost_cents || 0),
        0,
      ),
      byJobType: countBy(usageRows, (entry) => entry.source_job_type),
    },
  };
}

export type OwnerImprovementEvidence = Awaited<
  ReturnType<typeof collectOwnerImprovementEvidence>
>;

export function ownerImprovementReportPrompt(
  evidence: OwnerImprovementEvidence,
) {
  return [
    "You are CoOperative Improvement Lab, reviewing aggregate operational evidence for the platform owner.",
    "Use only the supplied evidence. Do not invent events, costs, failures, causes, or outcomes.",
    "For timestamps shown to the owner, use evidence.generatedAtLocal and the supplied displayTimeZone instead of restating UTC timestamps.",
    "Do not expose hidden chain-of-thought. Give concise conclusions and cite the metric or count that supports each conclusion.",
    "Prefer deterministic code/playbook fixes over adding more AI when they can safely solve the problem.",
    "Treat model/provider changes as candidates that require benchmarks, not assumptions.",
    "Do not propose autonomous production deployment, secret changes, billing actions, or model promotion.",
    "Output these sections:",
    "1. Executive summary",
    "2. Evidence-backed findings",
    "3. Proposed improvements",
    "4. Eval/model-learning candidates",
    "5. What should remain human-approved",
    "For each proposed improvement include: evidence, expected benefit, risk, and the next bounded action.",
    "",
    "AGGREGATE EVIDENCE:",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}
