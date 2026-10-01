"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Evidence = {
  generatedAt: string;
  generatedAtLocal?: string;
  displayTimeZone?: string;
  chat: {
    conversations: number;
    messages: number;
  };
  inference: {
    totalJobs: number;
    completed: number;
    failed: number;
    queued: number;
    running: number;
    cancelled: number;
    successRatePercent: number;
    totalTokens: number;
    averageLatencySeconds: number;
    byVerificationStatus: Record<string, number>;
  };
  agents: {
    totalTasks: number;
    byStatus: Record<string, number>;
    events: number;
  };
  unison: {
    nodes: number;
    nodesByStatus: Record<string, number>;
    nodesWithWorkerCheckIn: number;
    nodesWithHardwareReport: number;
    usageEntries: number;
    completedJobs: number;
    failedJobs: number;
  };
};

type ReportJob = {
  jobId: string;
  status: string;
  partialText?: string | null;
  text?: string | null;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  firstTokenMs?: number | null;
  latencyMs?: number | null;
  workerId?: string | null;
  routingPreference?: string | null;
  preferredNodeId?: string | null;
  error?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
};

type ReviewTask = {
  id: string;
  status: string;
  result?: {
    decision?: "pending" | "approved" | "denied" | "deferred";
    preparedTaskId?: string;
    decidedAt?: string;
    preparedAt?: string;
  } | null;
};

type ImprovementPayload = {
  evidence?: Evidence;
  latestReport?: ReportJob | null;
  review?: ReviewTask | null;
  taskId?: string;
  jobId?: string;
  status?: string;
  compiler?: {
    route: string;
    paidFallback: boolean;
    modelRegistryRevision: string;
    ownedNodePreferred?: boolean;
    preferredNodeId?: string | null;
    preferredNodeName?: string | null;
  };
  partialText?: string | null;
  text?: string | null;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  firstTokenMs?: number | null;
  latencyMs?: number | null;
  workerId?: string | null;
  routingPreference?: string | null;
  preferredNodeId?: string | null;
  error?: string | null;
  detail?: string | null;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function integer(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

const OWNER_DISPLAY_TIME_ZONE = "America/Chicago";

function localTimestamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OWNER_DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export default function ImprovementLab() {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [report, setReport] = useState<ReportJob | null>(null);
  const [review, setReview] = useState<ReviewTask | null>(null);
  const [detailReport, setDetailReport] = useState<ReportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Loading evidence…");
  const [error, setError] = useState("");
  const activePollRef = useRef<string | null>(null);

  const pollReport = useCallback(async (jobId: string) => {
    if (activePollRef.current === jobId) return;
    activePollRef.current = jobId;
    setBusy(true);
    setError("");

    try {
      for (;;) {
        const response = await fetch(
          `/api/owner/improvements?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as ImprovementPayload;

        if (!response.ok) {
          throw new Error(
            payload.detail || payload.error || "Could not read improvement report.",
          );
        }

        const next: ReportJob = {
          jobId,
          status: payload.status || "queued",
          partialText: payload.partialText,
          text: payload.text,
          model: payload.model,
          provider: payload.provider,
          promptTokens: payload.promptTokens,
          outputTokens: payload.outputTokens,
          firstTokenMs: payload.firstTokenMs,
          latencyMs: payload.latencyMs,
          workerId: payload.workerId,
          routingPreference: payload.routingPreference,
          preferredNodeId: payload.preferredNodeId,
          error: payload.error,
        };
        setReport(next);

        if (next.status === "queued") {
          setStatus("Waiting for owned/local Quality capacity…");
          await wait(1200);
          continue;
        }

        if (next.status === "running") {
          setStatus("Owned/local Quality model is compiling the report…");
          await wait(1000);
          continue;
        }

        if (next.status === "completed") {
          setStatus("Report ready for owner review.");
          return;
        }

        if (next.status === "failed" || next.status === "cancelled") {
          throw new Error(next.error || "Improvement report did not complete.");
        }

        await wait(1200);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not compile improvement report.",
      );
      setStatus("Report unavailable.");
    } finally {
      if (activePollRef.current === jobId) activePollRef.current = null;
      setBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/owner/improvements", {
        cache: "no-store",
      });
      const payload = (await response.json()) as ImprovementPayload;

      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "Could not load improvement evidence.",
        );
      }

      setEvidence(payload.evidence || null);
      setReport(payload.latestReport || null);
      setReview(payload.review || null);

      const latest = payload.latestReport;
      if (latest?.status === "queued" || latest?.status === "running") {
        setStatus("Resuming latest owned-model report…");
        void pollReport(latest.jobId);
      } else if (latest?.status === "completed") {
        setStatus("Latest report ready for owner review.");
      } else {
        setStatus("Evidence ready. Generate a report when you want one.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load improvement evidence.",
      );
      setStatus("Evidence unavailable.");
    }
  }, [pollReport]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function generateReport() {
    setBusy(true);
    setError("");
    setStatus("Compiling current evidence…");

    try {
      const response = await fetch("/api/owner/improvements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate_report" }),
      });
      const payload = (await response.json()) as ImprovementPayload;

      if (!response.ok || !payload.jobId) {
        throw new Error(
          payload.detail || payload.error || "Could not queue improvement report.",
        );
      }

      setEvidence(payload.evidence || evidence);
      setReport({
        jobId: payload.jobId,
        status: payload.status || "queued",
      });
      setReview(payload.review || null);
      setDetailReport(null);
      setStatus("Queued for owned/local Quality model.");
      setBusy(false);
      await pollReport(payload.jobId);
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error ? err.message : "Could not queue improvement report.",
      );
      setStatus("Report unavailable.");
    }
  }

  async function reviewAction(
    action: "tell_more" | "review" | "prepare_change",
    decision?: "approved" | "denied" | "deferred",
  ) {
    if (!report?.jobId) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/owner/improvements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reportJobId: report.jobId,
          ...(decision ? { decision } : {}),
        }),
      });
      const payload = (await response.json()) as ImprovementPayload;

      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "Could not update improvement review.",
        );
      }

      if (payload.review) setReview(payload.review);

      if (action === "tell_more" && payload.jobId) {
        setStatus("Owned/local Quality is expanding the report…");
        const followUpId = payload.jobId;

        for (;;) {
          const pollResponse = await fetch(
            `/api/owner/improvements?jobId=${encodeURIComponent(followUpId)}`,
            { cache: "no-store" },
          );
          const next = (await pollResponse.json()) as ImprovementPayload;

          if (!pollResponse.ok) {
            throw new Error(
              next.detail || next.error || "Could not read report follow-up.",
            );
          }

          const detail: ReportJob = {
            jobId: followUpId,
            status: next.status || "queued",
            partialText: next.partialText,
            text: next.text,
            model: next.model,
            provider: next.provider,
            promptTokens: next.promptTokens,
            outputTokens: next.outputTokens,
            firstTokenMs: next.firstTokenMs,
            latencyMs: next.latencyMs,
            workerId: next.workerId,
            routingPreference: next.routingPreference,
            preferredNodeId: next.preferredNodeId,
            error: next.error,
          };
          setDetailReport(detail);

          if (detail.status === "completed") {
            setStatus("Extra detail ready for review.");
            break;
          }
          if (detail.status === "failed" || detail.status === "cancelled") {
            throw new Error(detail.error || "Report follow-up did not complete.");
          }
          await wait(1000);
        }
      } else if (action === "prepare_change") {
        setStatus("Approved report queued for Repo Engineer preparation.");
      } else if (decision) {
        setStatus(
          decision === "approved"
            ? "Report approved for bounded preparation."
            : decision === "denied"
              ? "Report denied."
              : "Report deferred.",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update improvement review.",
      );
    } finally {
      setBusy(false);
    }
  }

  const visibleReport = report?.text || report?.partialText || "";
  const verificationNotRun =
    evidence?.inference.byVerificationStatus?.not_run || 0;

  return (
    <section className="card owner-improvement-lab">
      <div className="service-head">
        <div>
          <div className="eyebrow">Improvement Lab</div>
          <h2>Owned-model platform review</h2>
          <p>
            Aggregate operational evidence is compiled first, then the Local Quality
            model prepares an evidence-backed improvement report. Paid fallback is off.
          </p>
        </div>
        <div className="owner-improvement-status">
          <span className="status-dot active" />
          <span>{status}</span>
        </div>
      </div>

      {evidence ? (
        <>
          <p className="owner-improvement-note">
            Evidence captured {evidence.generatedAtLocal || localTimestamp(evidence.generatedAt)}
            {" · "}Central Time
          </p>
          <div className="owner-improvement-metrics">
          <span>
            <small>Inference jobs</small>
            <strong>{integer(evidence.inference.totalJobs)}</strong>
            <em>{evidence.inference.successRatePercent}% completed</em>
          </span>
          <span>
            <small>Tokens observed</small>
            <strong>{integer(evidence.inference.totalTokens)}</strong>
            <em>{evidence.inference.averageLatencySeconds}s avg latency</em>
          </span>
          <span>
            <small>Agent tasks</small>
            <strong>{integer(evidence.agents.totalTasks)}</strong>
            <em>{integer(evidence.agents.events)} events</em>
          </span>
          <span>
            <small>Unison nodes</small>
            <strong>{integer(evidence.unison.nodes)}</strong>
            <em>{integer(evidence.unison.nodesWithWorkerCheckIn)} checked in</em>
          </span>
          <span>
            <small>Verification gap</small>
            <strong>{integer(verificationNotRun)}</strong>
            <em>jobs marked not run</em>
          </span>
          </div>
        </>
      ) : null}

      <div className="owner-improvement-chat">
        {visibleReport ? (
          <article className="owner-improvement-message">
            <div className="owner-improvement-avatar">C</div>
            <div>
              <strong>CoOperative Improvement Lab</strong>
              <pre>{visibleReport}</pre>
              {detailReport?.text || detailReport?.partialText ? (
                <div className="owner-improvement-followup">
                  <strong>More detail</strong>
                  <pre>{detailReport.text || detailReport.partialText}</pre>
                </div>
              ) : null}

              {report?.status === "completed" ? (
                <div className="owner-improvement-review-actions">
                  <div className="cta-row">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void reviewAction("tell_more")}
                      disabled={busy}
                    >
                      Tell me more
                    </button>
                    <button
                      className="primary"
                      type="button"
                      onClick={() => void reviewAction("review", "approved")}
                      disabled={busy || review?.result?.decision === "approved"}
                    >
                      {review?.result?.decision === "approved" ? "Approved" : "Approve"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void reviewAction("review", "deferred")}
                      disabled={busy}
                    >
                      Defer
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void reviewAction("review", "denied")}
                      disabled={busy}
                    >
                      Deny
                    </button>
                  </div>

                  {review?.result?.decision === "approved" ? (
                    <div className="cta-row">
                      <button
                        className="primary"
                        type="button"
                        onClick={() => void reviewAction("prepare_change")}
                        disabled={busy || Boolean(review.result?.preparedTaskId)}
                      >
                        {review.result?.preparedTaskId
                          ? "Change preparation queued"
                          : "Prepare change"}
                      </button>
                      {review.result?.preparedTaskId ? (
                        <a className="secondary-cta" href="/agents">
                          View agent work
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {review?.result?.decision ? (
                    <p className="owner-improvement-decision">
                      Review state: <strong>{review.result.decision}</strong>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {report?.status === "completed" ? (
                <details>
                  <summary>Report execution details</summary>
                  <p>
                    {report.provider || "owned/local provider"}
                    {report.model ? ` · ${report.model}` : ""}
                    {report.workerId ? ` · worker ${report.workerId}` : ""}
                    {report.routingPreference === "prefer-owned"
                      ? " · owned-node preferred"
                      : ""}
                    {typeof report.promptTokens === "number" &&
                    typeof report.outputTokens === "number"
                      ? ` · ${integer(report.promptTokens)} in / ${integer(
                          report.outputTokens,
                        )} out`
                      : ""}
                    {typeof report.latencyMs === "number"
                      ? ` · ${(report.latencyMs / 1000).toFixed(1)}s`
                      : ""}
                    {report.completedAt
                      ? ` · completed ${localTimestamp(report.completedAt)}`
                      : ""}
                  </p>
                </details>
              ) : null}
            </div>
          </article>
        ) : (
          <div className="owner-improvement-empty">
            <strong>No compiled report yet.</strong>
            <p>
              The evidence snapshot is available now. Generate a report to have the
              owned/local Quality model turn it into findings and bounded proposals.
            </p>
          </div>
        )}
      </div>

      <div className="cta-row">
        <button
          className="primary"
          type="button"
          onClick={generateReport}
          disabled={busy}
        >
          {busy ? "Working…" : report ? "Generate fresh report" : "Generate improvement report"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => void load()}
          disabled={busy}
        >
          Refresh evidence
        </button>
      </div>

      <p className="owner-improvement-note">
        Owner review is now persisted. Approval only authorizes bounded change
        preparation; it still cannot merge code, deploy, spend money, change secrets,
        or promote/retrain a model without the later guarded approval gates.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
