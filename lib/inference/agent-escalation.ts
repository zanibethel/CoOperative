import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluatePaidEscalation,
  type EscalationDecision,
  type EscalationEvidence,
} from "@/lib/inference/escalation-evaluator";
import { configuredOpenAiCandidate } from "@/lib/inference/openai-paid-executor";

type AgentTaskForEscalation = {
  id: string;
  status: string;
  objective: string | null;
  requested_profile?: string | null;
  error?: string | null;
  result?: Record<string, unknown> | null;
};

export type AgentEscalationRecommendation = {
  decision: EscalationDecision;
  evidence: {
    localAttempts: number;
    localFailures: number;
    malformedStructuredOutputs: number;
    scopeGuardRejections: number;
    verificationStatus: EscalationEvidence["verificationStatus"];
  };
};

function countMalformedOutputs(task: AgentTaskForEscalation, eventKinds: string[]) {
  let count = eventKinds.filter((kind) => kind === "format_retry").length;
  const error = task.error || "";

  if (/invalid json twice|invalid raw plan twice/i.test(error)) {
    count = Math.max(count, 2);
  } else if (/invalid json|invalid raw plan|required raw plan|did not return required json/i.test(error)) {
    count = Math.max(count, 1);
  }

  return count;
}

function verificationStatus(task: AgentTaskForEscalation): EscalationEvidence["verificationStatus"] {
  const result = task.result || {};
  if (result.checksPassed === true) return "passed";
  if (result.checksPassed === false) return "failed";
  if (task.status === "failed") return "inconclusive";
  return "not_run";
}

export async function evaluateAgentTaskEscalation(
  admin: SupabaseClient,
  task: AgentTaskForEscalation,
  options?: {
    allowPaidFallback?: boolean;
    automaticPaidBudgetUsd?: number;
    requiredSuccessRate?: number;
  },
): Promise<AgentEscalationRecommendation> {
  const [{ data: jobs, error: jobsError }, { data: events, error: eventsError }] =
    await Promise.all([
      admin
        .from("text_inference_jobs")
        .select("id,status,error")
        .eq("agent_task_id", task.id)
        .order("created_at", { ascending: true }),
      admin
        .from("agent_task_events")
        .select("kind")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true }),
    ]);

  if (jobsError) throw jobsError;
  if (eventsError) throw eventsError;

  const eventKinds = (events || [])
    .map((event) => (typeof event.kind === "string" ? event.kind : ""))
    .filter(Boolean);
  const localAttempts = (jobs || []).length;
  const localFailures =
    (jobs || []).filter((job) => job.status === "failed").length +
    (task.status === "failed" ? 1 : 0);
  const malformedStructuredOutputs = countMalformedOutputs(task, eventKinds);
  const scopeGuardRejections = eventKinds.filter(
    (kind) => kind === "scope_guard_retry",
  ).length;

  const evidence: EscalationEvidence = {
    taskClass: "coding",
    localProfile: task.requested_profile === "fast" ? "fast" : "quality",
    messages: [
      {
        role: "user",
        content: (task.objective || "Repo-agent task").slice(0, 16_000),
      },
    ],
    requestedOutputTokens: 2400,
    localAttempts,
    localFailures,
    malformedStructuredOutputs,
    scopeGuardRejections,
    verificationStatus: verificationStatus(task),
    allowPaidFallback: options?.allowPaidFallback ?? false,
    automaticPaidBudgetUsd: options?.automaticPaidBudgetUsd ?? 0,
    requiredSuccessRate: options?.requiredSuccessRate ?? 0.8,
  };

  const openAi = configuredOpenAiCandidate(evidence);
  const decision = evaluatePaidEscalation(
    evidence,
    openAi ? [openAi] : [],
  );

  return {
    decision,
    evidence: {
      localAttempts,
      localFailures,
      malformedStructuredOutputs,
      scopeGuardRejections,
      verificationStatus: evidence.verificationStatus,
    },
  };
}
