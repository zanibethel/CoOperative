"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = {
  id: string;
  actor_type: "owner" | "advisor" | "system";
  channel: string;
  text: string;
  linked_task_id: string | null;
  linked_decision_id: string | null;
  created_at: string;
};

type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  risk_level: "low" | "medium" | "high";
  requires_owner_approval: boolean;
  selected_executor: string | null;
  max_spend_microunits: number;
  actual_spend_microunits: number;
};

type Decision = {
  id: string;
  proposal_summary: string;
  rationale: string;
  estimated_cost_cents: number;
  risk_level: "low" | "medium" | "high";
  recommended_action: string;
};

type Overview = {
  organization: { id: string; name: string } | null;
  conversation: { id: string; title: string } | null;
  messages: Message[];
  tasks: Task[];
  pendingDecisions: Decision[];
};

type SafetyFlags = {
  requiresShell: boolean;
  changesProduction: boolean;
  touchesSecrets: boolean;
  changesDatabase: boolean;
  movesMoney: boolean;
  destructive: boolean;
};

const emptyOverview: Overview = {
  organization: null,
  conversation: null,
  messages: [],
  tasks: [],
  pendingDecisions: [],
};

const initialFlags: SafetyFlags = {
  requiresShell: false,
  changesProduction: false,
  touchesSecrets: false,
  changesDatabase: false,
  movesMoney: false,
  destructive: false,
};

function moneyFromMicrounits(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 10_000 ? 4 : 2,
    maximumFractionDigits: value < 10_000 ? 6 : 2,
  }).format(value / 1_000_000);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function OwnerConsolePage() {
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [text, setText] = useState("");
  const [maxSpendUsd, setMaxSpendUsd] = useState("0");
  const [flags, setFlags] = useState<SafetyFlags>(initialFlags);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [decisionWorkingId, setDecisionWorkingId] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/operative/overview", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load Owner Console");
    setOverview(payload);
  }

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/operative/overview", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load Owner Console");
        if (!cancelled) setOverview(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load Owner Console");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const actualSpend = useMemo(
    () => overview.tasks.reduce((sum, task) => sum + Number(task.actual_spend_microunits ?? 0), 0),
    [overview.tasks],
  );

  async function persistMessage(messageText: string) {
    const response = await fetch("/api/console/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: overview.conversation?.id ?? null,
        text: messageText,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to save message");
    return payload as { conversationId: string; messageId: string };
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const messageText = text.trim();
    if (!messageText) return;

    setWorking(true);
    setError("");
    setNotice("");

    try {
      await persistMessage(messageText);
      setText("");
      setNotice("Saved to the canonical CoOperative thread.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save message");
    } finally {
      setWorking(false);
    }
  }

  async function queueTask() {
    const messageText = text.trim();
    if (messageText.length < 2) return;

    setWorking(true);
    setError("");
    setNotice("");

    try {
      const message = await persistMessage(messageText);
      const title = (messageText.split("\n").find(Boolean) ?? messageText).slice(0, 120);

      const response = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title,
          description: messageText,
          maxSpendUsd: Number(maxSpendUsd || 0),
          flags,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        if (payload.code === "SERVER_SECRET_NOT_CONFIGURED") {
          throw new Error(
            "The conversation was saved, but trusted cloud task writes are not enabled yet. SUPABASE_SECRET_KEY remains an owner gate.",
          );
        }
        throw new Error(payload.error ?? "Unable to queue task");
      }

      setText("");
      setFlags(initialFlags);
      setMaxSpendUsd("0");
      setNotice(
        "Task queued · " +
          payload.policy.riskLevel +
          " risk" +
          (payload.policy.requiresOwnerApproval
            ? " · owner gate required before guarded execution"
            : "") +
          ".",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to queue task");
      await load().catch(() => undefined);
    } finally {
      setWorking(false);
    }
  }

  function setFlag(key: keyof SafetyFlags, value: boolean) {
    setFlags((current) => ({ ...current, [key]: value }));
  }

  async function respondToDecision(
    decisionId: string,
    action: "approve" | "reject" | "modify" | "ask_question",
  ) {
    const note = decisionNotes[decisionId]?.trim() ?? "";
    if ((action === "modify" || action === "ask_question") && !note) {
      setError("Add a note for a modification or a question before sending it.");
      return;
    }

    setDecisionWorkingId(decisionId);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/operative/decisions/" + decisionId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, note: note || undefined }),
      });
      const payload = await response.json();

      if (!response.ok) {
        if (payload.code === "SERVER_SECRET_NOT_CONFIGURED") {
          throw new Error(
            "Decision responses are ready, but trusted cloud writes remain disabled until SUPABASE_SECRET_KEY is explicitly configured.",
          );
        }
        throw new Error(payload.error ?? "Unable to save decision response");
      }

      setDecisionNotes((current) => {
        const next = { ...current };
        delete next[decisionId];
        return next;
      });

      setNotice(
        action === "ask_question"
          ? "Question saved. The decision remains pending."
          : "Decision recorded. Execution remains paused until the governed resume layer is connected.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save decision response");
    } finally {
      setDecisionWorkingId(null);
    }
  }

  return (
    <main className="shell operative-shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="nav-links">
          <Link href="/services">Services</Link>
          <Link href="/intake">Briefing</Link>
          <div className="badge">Owner Console · Phase C</div>
        </div>
      </nav>

      <section className="console-header">
        <div>
          <div className="eyebrow">Cloud Operative</div>
          <h1>Talk. Decide. Execute. Keep the context.</h1>
          <p>
            Messages, governed tasks, decisions, cost, and evidence stay in CoOperative
            instead of living inside one model session.
          </p>
        </div>
        <div className="console-health card">
          <span>Workspace</span>
          <strong>{overview.organization?.name ?? (loading ? "Loading…" : "Not created yet")}</strong>
          <span>Cloud execution</span>
          <strong>Foundation ready · executor not connected</strong>
        </div>
      </section>

      <section className="metrics">
        <div className="metric"><span>Operative tasks</span><strong>{overview.tasks.length}</strong></div>
        <div className="metric"><span>Pending owner decisions</span><strong>{overview.pendingDecisions.length}</strong></div>
        <div className="metric"><span>Recorded marginal task cost</span><strong>{moneyFromMicrounits(actualSpend)}</strong></div>
      </section>

      {!overview.organization && !loading ? (
        <div className="card console-callout">
          <strong>No CoOperative workspace yet.</strong>
          <p>Complete onboarding first so conversations and tasks have an owner-scoped organization.</p>
          <Link className="cta" href="/onboarding">Create workspace →</Link>
        </div>
      ) : null}

      <section className="console-layout">
        <div className="console-thread card">
          <div className="console-section-head">
            <div>
              <div className="eyebrow">Canonical thread</div>
              <h2>{overview.conversation?.title || "Owner conversation"}</h2>
            </div>
            <span className="badge">{overview.messages.length} messages</span>
          </div>

          <div className="message-list">
            {loading ? <p>Loading conversation…</p> : null}
            {!loading && overview.messages.length === 0 ? (
              <div className="empty-state">
                <strong>No conversation yet.</strong>
                <p>Send a note about what you want CoOperative to do or queue it as a governed task.</p>
              </div>
            ) : null}

            {overview.messages.map((message) => (
              <article
                className={["message", message.actor_type === "owner" ? "message-owner" : "message-system"].join(" ")}
                key={message.id}
              >
                <div className="message-meta">
                  <span>{message.actor_type}</span>
                  <span>{message.channel}</span>
                  <span>{formatTime(message.created_at)}</span>
                </div>
                <p>{message.text}</p>
                {message.linked_task_id ? <span className="mini-tag">task linked</span> : null}
                {message.linked_decision_id ? <span className="mini-tag">decision linked</span> : null}
              </article>
            ))}
          </div>

          <form className="console-composer" onSubmit={send}>
            <textarea
              placeholder="Tell CoOperative what you want, what changed, or what should happen next…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={working || !overview.organization}
            />

            <details className="task-controls">
              <summary>Task safety + cost controls</summary>
              <div className="task-control-grid">
                <label><input type="checkbox" checked={flags.requiresShell} onChange={(e) => setFlag("requiresShell", e.target.checked)} /> Needs cloud shell/runtime</label>
                <label><input type="checkbox" checked={flags.changesProduction} onChange={(e) => setFlag("changesProduction", e.target.checked)} /> Changes production</label>
                <label><input type="checkbox" checked={flags.touchesSecrets} onChange={(e) => setFlag("touchesSecrets", e.target.checked)} /> Touches secrets</label>
                <label><input type="checkbox" checked={flags.changesDatabase} onChange={(e) => setFlag("changesDatabase", e.target.checked)} /> Changes database/RLS</label>
                <label><input type="checkbox" checked={flags.movesMoney} onChange={(e) => setFlag("movesMoney", e.target.checked)} /> Moves money</label>
                <label><input type="checkbox" checked={flags.destructive} onChange={(e) => setFlag("destructive", e.target.checked)} /> Destructive operation</label>
              </div>
              <div className="field task-budget">
                <label>Maximum incremental task spend (USD)</label>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="0.01"
                  value={maxSpendUsd}
                  onChange={(event) => setMaxSpendUsd(event.target.value)}
                />
                <small>$0 means no paid execution is pre-authorized.</small>
              </div>
            </details>

            <div className="composer-actions">
              <button className="secondary-button" type="submit" disabled={working || !text.trim() || !overview.organization}>
                {working ? "Working…" : "Save to thread"}
              </button>
              <button className="primary" type="button" onClick={() => void queueTask()} disabled={working || text.trim().length < 2 || !overview.organization}>
                Queue governed task
              </button>
            </div>

            {notice ? <div className="notice">{notice}</div> : null}
            {error ? <div className="error">{error}</div> : null}
          </form>
        </div>

        <aside className="console-sidebar">
          <section className="card">
            <div className="eyebrow">Mission Control</div>
            <h2>Recent tasks</h2>
            <div className="task-stack">
              {overview.tasks.length === 0 ? <p>No tasks queued yet.</p> : null}
              {overview.tasks.map((task) => (
                <article className="task-card" key={task.id}>
                  <div className="task-card-head">
                    <strong>{task.title}</strong>
                    <span className={["status-pill", "status-" + task.status].join(" ")}>{task.status.replaceAll("_", " ")}</span>
                  </div>
                  <div className="service-tags">
                    <span>{task.risk_level} risk</span>
                    {task.requires_owner_approval ? <span>approval gated</span> : <span>standard policy</span>}
                    {task.selected_executor ? <span>{task.selected_executor}</span> : <span>executor pending</span>}
                  </div>
                  <p>{task.description}</p>
                  <div className="task-cost">
                    <span>spent {moneyFromMicrounits(Number(task.actual_spend_microunits ?? 0))}</span>
                    <span>cap {moneyFromMicrounits(Number(task.max_spend_microunits ?? 0))}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="eyebrow">Owner gates</div>
            <h2>Pending decisions</h2>
            <div className="task-stack">
              {overview.pendingDecisions.length === 0 ? <p>No Decision Briefs are waiting for you.</p> : null}
              {overview.pendingDecisions.map((decision) => (
                <article className="decision-card" key={decision.id}>
                  <strong>{decision.proposal_summary}</strong>
                  {decision.rationale ? <p>{decision.rationale}</p> : null}
                  <div className="service-tags">
                    <span>{decision.risk_level} risk</span>
                    <span>{"$" + (decision.estimated_cost_cents / 100).toFixed(2) + " estimated"}</span>
                  </div>
                  {decision.recommended_action ? <p><b>Recommended:</b> {decision.recommended_action}</p> : null}
                  <div className="decision-response">
                    <input
                      placeholder="Optional note; required to modify or ask a question"
                      value={decisionNotes[decision.id] ?? ""}
                      onChange={(event) =>
                        setDecisionNotes((current) => ({
                          ...current,
                          [decision.id]: event.target.value,
                        }))
                      }
                      disabled={decisionWorkingId === decision.id}
                    />
                    <div className="decision-actions">
                      <button
                        type="button"
                        className="decision-approve"
                        disabled={decisionWorkingId === decision.id}
                        onClick={() => void respondToDecision(decision.id, "approve")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="decision-button"
                        disabled={decisionWorkingId === decision.id}
                        onClick={() => void respondToDecision(decision.id, "reject")}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="decision-button"
                        disabled={decisionWorkingId === decision.id}
                        onClick={() => void respondToDecision(decision.id, "modify")}
                      >
                        Modify
                      </button>
                      <button
                        type="button"
                        className="decision-button"
                        disabled={decisionWorkingId === decision.id}
                        onClick={() => void respondToDecision(decision.id, "ask_question")}
                      >
                        Ask question
                      </button>
                    </div>
                    <small>
                      Your response is written to the canonical conversation and task audit trail.
                      Approval does not bypass the executor/policy layer.
                    </small>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
