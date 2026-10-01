"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Evidence = {
  generatedAt: string;
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
  error?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
};

type ImprovementPayload = {
  evidence?: Evidence;
  latestReport?: ReportJob | null;
  jobId?: string;
  status?: string;
  compiler?: {
    route: string;
    paidFallback: boolean;
    modelRegistryRevision: string;
  };
  partialText?: string | null;
  text?: string | null;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  firstTokenMs?: number | null;
  latencyMs?: number | null;
  error?: string | null;
  detail?: string | null;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function integer(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function ImprovementLab() {
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [report, setReport] = useState<ReportJob | null>(null);
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
      ) : null}

      <div className="owner-improvement-chat">
        {visibleReport ? (
          <article className="owner-improvement-message">
            <div className="owner-improvement-avatar">C</div>
            <div>
              <strong>CoOperative Improvement Lab</strong>
              <pre>{visibleReport}</pre>
              {report?.status === "completed" ? (
                <details>
                  <summary>Report execution details</summary>
                  <p>
                    {report.provider || "owned/local provider"}
                    {report.model ? ` · ${report.model}` : ""}
                    {typeof report.promptTokens === "number" &&
                    typeof report.outputTokens === "number"
                      ? ` · ${integer(report.promptTokens)} in / ${integer(
                          report.outputTokens,
                        )} out`
                      : ""}
                    {typeof report.latencyMs === "number"
                      ? ` · ${(report.latencyMs / 1000).toFixed(1)}s`
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
        Review-only v1: this can identify and propose improvements, but it cannot merge
        code, deploy changes, spend money, or promote/retrain a model. Approval actions
        will be layered onto this report pipeline next.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
