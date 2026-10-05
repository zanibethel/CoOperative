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
    { data: platformBranchTasks, error: platformBranchError },
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
      .select("id,agent_key,repo_key,mode,status,requested_profile,worker_id,branch_name,objective,result,error,created_at,updated_at,completed_at")
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
      .from("agent_tasks")
      .select("id,repo_key,mode,status,branch_name,objective,result,error,created_at,updated_at,completed_at")
      .eq("repo_key", "cooperative")
      .eq("mode", "prepare_change")
      .not("branch_name", "is", null)
      .order("updated_at", { ascending: false })
      .limit(500),
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
    platformBranchError ||
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

  const branchCandidates = (platformBranchTasks || [])
    .filter(
      (task) =>
        task.mode === "prepare_change" &&
        typeof task.branch_name === "string" &&
        task.branch_name.startsWith("sandbox/"),
    )
    .map((task) => {
      const result =
        task.result && typeof task.result === "object"
          ? (task.result as Record<string, unknown>)
          : {};
      const sandbox =
        result.sandbox && typeof result.sandbox === "object"
          ? (result.sandbox as Record<string, unknown>)
          : {};
      const changedFiles = Array.isArray(result.changedFiles)
        ? result.changedFiles
            .filter((value): value is string => typeof value === "string")
            .slice(0, 20)
        : [];
      return {
        taskId: task.id,
        repoKey: task.repo_key,
        branchName: task.branch_name,
        status: task.status,
        objective:
          typeof task.objective === "string"
            ? task.objective.slice(0, 1200)
            : "",
        summary:
          typeof result.summary === "string"
            ? result.summary.slice(0, 1200)
            : "",
        changedFiles,
        checksPassed: result.checksPassed === true,
        diffStat:
          typeof result.diffStat === "string"
            ? result.diffStat.slice(0, 1500)
            : "",
        pushed: sandbox.pushed === true,
        commitSha:
          typeof sandbox.commitSha === "string" ? sandbox.commitSha : null,
        continued: sandbox.continued === true,
        baseBranch:
          typeof sandbox.baseBranch === "string" ? sandbox.baseBranch : null,
        promotionState:
          typeof sandbox.promotionState === "string"
            ? sandbox.promotionState
            : task.status === "needs_approval"
              ? "awaiting_owner_review"
              : "testing",
        mergeAllowed: sandbox.mergeAllowed === true,
        model:
          typeof result.model === "string" ? result.model : null,
        provider:
          typeof result.provider === "string" ? result.provider : null,
        executor:
          typeof result.executor === "string" ? result.executor : null,
        strongerModelRecommendation:
          result.strongerModelRecommendation &&
          typeof result.strongerModelRecommendation === "object"
            ? result.strongerModelRecommendation
            : null,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        completedAt: task.completed_at,
      };
    })
    .slice(0, 80);

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
        "This evidence pack excludes requester identities, raw chat content, tenant documents, and credentials. For platform code governance it may include bounded sandbox-branch metadata, technical task objectives/summaries, changed-file lists, and check results needed for owner review.",
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
      branches: {
        totalSandboxBranches: branchCandidates.length,
        awaitingOwnerReview: branchCandidates.filter(
          (branch) => branch.promotionState === "awaiting_owner_review",
        ).length,
        successfulTested: branchCandidates.filter(
          (branch) => branch.checksPassed && branch.pushed,
        ).length,
        approvedForMerge: branchCandidates.filter(
          (branch) => branch.promotionState === "approved-for-merge",
        ).length,
        byRepository: countBy(branchCandidates, (branch) => branch.repoKey),
        candidates: branchCandidates,
      },
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
    "Before proposing a new code change, review evidence.agents.branches.candidates for existing unmerged sandbox implementations that may already solve the same issue.",
    "When multiple branches address similar needs, compare successful checks, changed-file scope, portability, continuation history, and evidence. Recommend the strongest existing candidate instead of creating duplicate work.",
    "A sandbox branch may be tested and revised repeatedly, but it must never be treated as mergeable until owner review marks it approved-for-merge.",
    "Treat model/provider changes as candidates that require benchmarks, not assumptions.",
    "Do not propose autonomous production deployment, secret changes, billing actions, or model promotion.",
    "Output these sections:",
    "1. Executive summary",
    "2. Evidence-backed findings",
    "3. Pending sandbox branches and competing implementations",
    "4. Proposed improvements",
    "5. Eval/model-learning candidates",
    "6. What should remain human-approved",
    "For each pending sandbox branch include: branch, reason/objective, checks/test status, scope, whether another branch overlaps it, and the recommended next action.",
    "For each proposed improvement include: evidence, expected benefit, risk, and the next bounded action.",
    "Merging to the default branch must remain an explicit owner-review action; never recommend automatic merge merely because checks passed.",
    "",
    "AGGREGATE EVIDENCE:",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}
