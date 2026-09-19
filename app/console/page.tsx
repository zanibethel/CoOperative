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
  result: unknown;
  error?: string | null;
};

type Decision = {
  id: string;
  task_id: string | null;
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
  const absolute = Math.abs(value);
  const fractionDigits = absolute < 10_000 ? 6 : absolute < 1_000_000 ? 4 : 2;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: 6,
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

function asyncExecutionMode(task: Task): "detached" | "workflow" | null {
  if (task.status !== "executing" || !task.result || typeof task.result !== "object") {
    return null;
  }

  const mode = (task.result as { executionMode?: unknown }).executionMode;
  return mode === "detached" || mode === "workflow" ? mode : null;
}

function taskProgressLabel(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const progress = (result as { progress?: unknown }).progress;
  if (!progress || typeof progress !== "object") return null;
  const stage = (progress as { stage?: unknown }).stage;
  if (typeof stage !== "string") return null;
  return stage.replaceAll("_", " ");
}

function taskLinkedProjectKey(result: unknown): "creatorhub" | "raisehub" | null {
  if (!result || typeof result !== "object") return null;
  const linkedProject = (result as { linkedProject?: unknown }).linkedProject;
  return linkedProject === "creatorhub" || linkedProject === "raisehub"
    ? linkedProject
    : null;
}

function taskHermesModelEvidence(result: unknown): {
  model?: string;
  provider?: string;
  output?: string;
  costMicrounits?: number;
  totalTokens?: number;
  costStatus?: string;
  costSource?: string;
  usageCostStatus?: string;
  usageCostSource?: string;
} | null {
  if (!result || typeof result !== "object") return null;
  const evidence = (result as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== "object") return null;

  const record = evidence as {
    model?: unknown;
    provider?: unknown;
    output?: unknown;
    costMicrounits?: unknown;
    costStatus?: unknown;
    costSource?: unknown;
    usage?: {
      total_tokens?: unknown;
      cost_status?: unknown;
      cost_source?: unknown;
      total_including_auxiliary?: { total_tokens?: unknown };
    };
  };

  if (typeof record.output !== "string") return null;

  const totalTokens =
    typeof record.usage?.total_including_auxiliary?.total_tokens === "number"
      ? record.usage.total_including_auxiliary.total_tokens
      : typeof record.usage?.total_tokens === "number"
        ? record.usage.total_tokens
        : undefined;

  return {
    model: typeof record.model === "string" ? record.model : undefined,
    provider: typeof record.provider === "string" ? record.provider : undefined,
    output: record.output,
    costMicrounits:
      typeof record.costMicrounits === "number" ? record.costMicrounits : undefined,
    totalTokens,
    costStatus: typeof record.costStatus === "string" ? record.costStatus : undefined,
    costSource: typeof record.costSource === "string" ? record.costSource : undefined,
    usageCostStatus:
      typeof record.usage?.cost_status === "string" ? record.usage.cost_status : undefined,
    usageCostSource:
      typeof record.usage?.cost_source === "string" ? record.usage.cost_source : undefined,
  };
}

function hermesCostLabel(result: unknown): string {
  const evidence = taskHermesModelEvidence(result);
  if (!evidence) return "cost pending";

  const unresolvedLegacyCost =
    evidence.costStatus === undefined &&
    (evidence.usageCostStatus === "unknown" || evidence.usageCostSource === "none");

  if (unresolvedLegacyCost) return "cost unresolved";

  if (typeof evidence.costMicrounits !== "number") return "cost pending";

  const suffix =
    evidence.costStatus === "estimated"
      ? " estimated"
      : evidence.costStatus === "reported"
        ? " reported"
        : "";

  return moneyFromMicrounits(evidence.costMicrounits) + suffix;
}

function taskHermesProjectPatch(result: unknown): {
  patch: string;
  changedFiles: string[];
  verificationSucceeded?: boolean;
  verificationSteps: Array<{
    cmd?: string;
    exitCode?: number;
    stdoutTail?: string;
    stderrTail?: string;
  }>;
} | null {
  if (!result || typeof result !== "object") return null;
  const evidence = (result as { evidence?: unknown }).evidence;
  if (!evidence || typeof evidence !== "object") return null;

  const record = evidence as {
    patch?: unknown;
    changedFiles?: unknown;
    verificationSucceeded?: unknown;
    verificationSteps?: unknown;
  };
  if (typeof record.patch !== "string") return null;

  return {
    patch: record.patch,
    changedFiles: Array.isArray(record.changedFiles)
      ? record.changedFiles.filter((item): item is string => typeof item === "string")
      : [],
    verificationSucceeded:
      typeof record.verificationSucceeded === "boolean"
        ? record.verificationSucceeded
        : undefined,
    verificationSteps: Array.isArray(record.verificationSteps)
      ? record.verificationSteps.filter(
          (item): item is {
            cmd?: string;
            exitCode?: number;
            stdoutTail?: string;
            stderrTail?: string;
          } => Boolean(item) && typeof item === "object",
        )
      : [],
  };
}

function taskFindings(result: unknown): Array<{ priority?: string; title: string; why?: string }> {
  if (!result || typeof result !== "object" || !("findings" in result)) return [];
  const findings = (result as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return [];
  return findings
    .filter((item): item is { priority?: string; title: string; why?: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { title?: unknown }).title === "string"
    )
    .slice(0, 7);
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
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [copiedPatchTaskId, setCopiedPatchTaskId] = useState<string | null>(null);

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

  const pendingDecisionByTask = useMemo(
    () =>
      new Map(
        overview.pendingDecisions
          .filter((decision): decision is Decision & { task_id: string } => Boolean(decision.task_id))
          .map((decision) => [decision.task_id, decision]),
      ),
    [overview.pendingDecisions],
  );

  const detachedTaskIds = useMemo(
    () =>
      overview.tasks
        .filter((task) => asyncExecutionMode(task) === "detached")
        .map((task) => task.id),
    [overview.tasks],
  );

  const asyncTaskIds = useMemo(
    () =>
      overview.tasks
        .filter((task) => asyncExecutionMode(task) !== null)
        .map((task) => task.id),
    [overview.tasks],
  );

  useEffect(() => {
    if (asyncTaskIds.length === 0) return;

    let cancelled = false;
    let polling = false;

    const poll = async () => {
      if (cancelled || polling) return;
      polling = true;

      try {
        if (detachedTaskIds.length > 0) {
          await Promise.all(
            detachedTaskIds.map(async (taskId) => {
              await fetch("/api/operative/tasks/" + taskId + "/poll", {
                method: "GET",
                cache: "no-store",
              }).catch(() => undefined);
            }),
          );
        }

        if (cancelled) return;

        const response = await fetch("/api/operative/overview", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to refresh Mission Control");
        if (!cancelled) setOverview(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to refresh active cloud task");
        }
      } finally {
        polling = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 4000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [asyncTaskIds.join(","), detachedTaskIds.join(",")]);

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

  async function retryHermesProjectTask(task: Task) {
    const projectKey = taskLinkedProjectKey(task.result);
    if (!projectKey) {
      setError("This failed task is not linked to a supported Hermes project.");
      return;
    }

    const budget = Number(task.max_spend_microunits ?? 0) / 1_000_000;
    if (!Number.isFinite(budget) || budget <= 0) {
      setError("This Hermes task does not have a positive model spend cap to reuse.");
      return;
    }

    setWorking(true);
    setError("");
    setNotice("");

    try {
      const projectName = projectKey === "creatorhub" ? "CreatorHub" : "RaiseHub";
      const message = await persistMessage(
        `Retry linked-project Hermes request for ${projectName}: ${task.description}`,
      );

      const createResponse = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title: `${projectName} · Hermes patch`,
          description: task.description,
          playbookKey: `${projectKey}-hermes-patch`,
          maxSpendUsd: budget,
          flags: { requiresShell: true },
        }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(created.error ?? "Unable to create retry Hermes task.");
      }

      const executeResponse = await fetch(
        "/api/operative/tasks/" + created.task.id + "/execute",
        { method: "POST" },
      );
      const executed = await executeResponse.json();
      if (!executeResponse.ok) {
        throw new Error(executed.error ?? "Unable to start retry Hermes task.");
      }

      setNotice(
        `${projectName} Hermes retry started with the same ${moneyFromMicrounits(task.max_spend_microunits)} cap.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to retry Hermes task.");
      await load().catch(() => undefined);
    } finally {
      setWorking(false);
    }
  }

  async function copyTaskError(task: Task) {
    if (!task.error) return;

    try {
      await navigator.clipboard.writeText(task.error);
      setCopiedTaskId(task.id);
      window.setTimeout(() => {
        setCopiedTaskId((current) => (current === task.id ? null : current));
      }, 1800);
    } catch {
      setError("Unable to copy the error on this device.");
    }
  }

  async function copyTaskPatch(task: Task) {
    const evidence = taskHermesProjectPatch(task.result);
    if (!evidence) return;

    try {
      await navigator.clipboard.writeText(evidence.patch);
      setCopiedPatchTaskId(task.id);
      window.setTimeout(() => {
        setCopiedPatchTaskId((current) => (current === task.id ? null : current));
      }, 1800);
    } catch {
      setError("Unable to copy the Hermes patch on this device.");
    }
  }

  function prepareErrorRequest(task: Task, mode: "explain" | "fix") {
    if (!task.error) return;

    const instruction =
      mode === "fix"
        ? "Investigate and prepare a safe fix for this failed CoOperative task."
        : "Explain this failed CoOperative task error in plain language and identify the likely root cause.";

    setText(
      [
        instruction,
        "Review the Integration Compatibility Registry and existing regression coverage before using code, shell, Hermes, or another AI.",
        "Do not bypass owner gates for secrets, money, destructive actions, production changes, auth/RLS, or database migrations.",
        "Prefer a deterministic known-good fix if this failure has already been learned.",
        "",
        "Task: " + task.title,
        "Task ID: " + task.id,
        "Error:",
        task.error,
      ].join("\n"),
    );
    setNotice(
      mode === "fix"
        ? "Fix request prepared in the composer. Review it, then queue the governed task when ready."
        : "Explanation request prepared in the composer. Review it, then save or queue it when ready.",
    );

    window.setTimeout(() => {
      document.querySelector<HTMLTextAreaElement>(".console-composer textarea")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
  }

  async function runHermesRuntimeCheck() {
    setWorking(true);
    setError("");
    setNotice("");

    try {
      const messageText =
        "Verify that the pinned Hermes Agent runtime can be prepared once, reused from a Vercel Sandbox snapshot, and restored into an isolated fork without model credentials.";
      const message = await persistMessage(messageText);

      const createResponse = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title: "Cloud Hermes runtime check",
          description:
            "Prepare or reuse the pinned Hermes Agent v0.21.3 runtime snapshot, fork an isolated Vercel Sandbox, and run bounded version/help checks against the restored CLI. Do not use provider credentials or make a model call.",
          playbookKey: "hermes-runtime-check",
          maxSpendUsd: 0,
          flags: { requiresShell: true },
        }),
      });

      const created = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(created.error ?? "Unable to create Hermes runtime check task");
      }

      const executeResponse = await fetch(
        "/api/operative/tasks/" + created.task.id + "/execute",
        { method: "POST" },
      );
      const executed = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executed.error ?? "Cloud Hermes runtime check failed");
      }

      if (executeResponse.status === 202 || executed.asynchronous === true) {
        setNotice(
          "Cloud Hermes runtime check started. You can keep using the console; Mission Control will update automatically.",
        );
        await load();
        return;
      }

      setNotice("Cloud Hermes runtime check completed. No model credentials were used.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cloud Hermes runtime check failed");
      await load().catch(() => undefined);
    } finally {
      setWorking(false);
    }
  }

  async function runHermesModelSmoke() {
    setWorking(true);
    setError("");
    setNotice("");

    try {
      const messageText =
        "Run one governed model-backed Cloud Hermes smoke test through Vercel AI Gateway with a $0.02 maximum incremental spend.";
      const message = await persistMessage(messageText);

      const createResponse = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title: "Cloud Hermes model smoke test",
          description:
            "Reuse the prepared Hermes runtime for one single-turn reasoning check through Vercel AI Gateway using short-lived deployment OIDC. No persistent provider key, repository writes, production changes, database changes, or money movement. Maximum incremental spend: $0.02.",
          playbookKey: "hermes-model-smoke",
          maxSpendUsd: 0.02,
          flags: { requiresShell: true },
        }),
      });

      const created = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(created.error ?? "Unable to create Cloud Hermes model smoke task");
      }

      const executeResponse = await fetch(
        "/api/operative/tasks/" + created.task.id + "/execute",
        { method: "POST" },
      );
      const executed = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executed.error ?? "Cloud Hermes model smoke test failed");
      }

      setNotice(
        "Model-backed Cloud Hermes test started. Maximum incremental spend is $0.02; Mission Control will update automatically.",
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cloud Hermes model smoke test failed");
      await load().catch(() => undefined);
    } finally {
      setWorking(false);
    }
  }

  async function runCloudSelfCheck() {
    setWorking(true);
    setError("");
    setNotice("");

    try {
      const messageText =
        "Run the allow-listed Cloud Operative self-check in Vercel Sandbox and record the result.";
      const message = await persistMessage(messageText);

      const createResponse = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title: "Cloud Operative self-check",
          description:
            "Verify that CoOperative can execute its reviewed deterministic self-check playbook in an isolated cloud sandbox while the Mac is not part of the runtime.",
          playbookKey: "cloud-self-check",
          maxSpendUsd: 0,
          flags: { requiresShell: true },
        }),
      });

      const created = await createResponse.json();
      if (!createResponse.ok) {
        if (created.code === "SERVER_SECRET_NOT_CONFIGURED") {
          throw new Error(
            "Cloud self-check is ready, but trusted task writes remain disabled until SUPABASE_SECRET_KEY is explicitly configured.",
          );
        }
        throw new Error(created.error ?? "Unable to create cloud self-check task");
      }

      const executeResponse = await fetch(
        "/api/operative/tasks/" + created.task.id + "/execute",
        { method: "POST" },
      );
      const executed = await executeResponse.json();

      if (!executeResponse.ok) {
        throw new Error(executed.error ?? "Cloud self-check execution failed");
      }

      setNotice("Cloud self-check completed and its evidence was saved to the task record.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cloud self-check failed");
      await load().catch(() => undefined);
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="shell operative-shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="nav-links">
          <Link href="/console/projects">Projects</Link>
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
            <div className="eyebrow">Bootstrap proof</div>
            <h2>Cloud self-check</h2>
            <p>
              Run one reviewed deterministic playbook in an isolated Vercel Sandbox.
              No owner text becomes shell commands and no Hermes/model reasoning is used.
            </p>
            <button
              className="primary"
              type="button"
              disabled={working || !overview.organization}
              onClick={() => void runCloudSelfCheck()}
            >
              {working ? "Working…" : "Run cloud self-check"}
            </button>
            <small className="console-helper">
              First live run requires the server-only Supabase secret gate so task events and evidence can be written safely.
            </small>
          </section>

          <section className="card">
            <div className="eyebrow">Cloud Hermes</div>
            <h2>Runtime check</h2>
            <p>
              Prepare the pinned Hermes runtime once, reuse its Vercel Sandbox snapshot,
              verify the restored CLI with fast bounded checks, and shut it down. This uses no model/API credentials.
            </p>
            <button
              className="primary"
              type="button"
              disabled={working || !overview.organization}
              onClick={() => void runHermesRuntimeCheck()}
            >
              {working ? "Working…" : "Test Cloud Hermes runtime"}
            </button>
            <small className="console-helper">
              The reusable runtime is already prepared from the previous run, so this check should now be much faster. Provider authentication and model routing remain a separate owner gate.
            </small>
          </section>

          <section className="card">
            <div className="eyebrow">Cloud Hermes · Model proof</div>
            <h2>One governed reasoning turn</h2>
            <p>
              Reuse the prepared Hermes snapshot and make one bounded model call through
              Vercel AI Gateway using short-lived deployment identity. No persistent provider
              key is stored and the task cannot exceed the $0.02 configured spend cap.
            </p>
            <button
              className="primary"
              type="button"
              disabled={working || !overview.organization}
              onClick={() => void runHermesModelSmoke()}
            >
              {working ? "Working…" : "Run model-backed Hermes test · max $0.02"}
            </button>
            <small className="console-helper">
              This smoke test is fixed and single-turn. It does not accept arbitrary shell instructions,
              change production, modify the database, or write to the repository.
            </small>
          </section>

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
                    {taskProgressLabel(task.result) ? <span>{taskProgressLabel(task.result)}</span> : null}
                  </div>
                  <p className="task-description">{task.description}</p>
                  <div className="task-cost">
                    <span>spent {moneyFromMicrounits(Number(task.actual_spend_microunits ?? 0))}</span>
                    <span>cap {moneyFromMicrounits(Number(task.max_spend_microunits ?? 0))}</span>
                  </div>
                  {pendingDecisionByTask.get(task.id) ? (
                    <div className="task-error-actions">
                      <button
                        type="button"
                        className="decision-approve"
                        disabled={decisionWorkingId === pendingDecisionByTask.get(task.id)?.id}
                        onClick={() =>
                          void respondToDecision(pendingDecisionByTask.get(task.id)!.id, "approve")
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="decision-button"
                        disabled={decisionWorkingId === pendingDecisionByTask.get(task.id)?.id}
                        onClick={() =>
                          void respondToDecision(pendingDecisionByTask.get(task.id)!.id, "reject")
                        }
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                  {taskFindings(task.result).length > 0 ? (
                    <details className="task-result">
                      <summary>View findings</summary>
                      <div className="task-findings">
                        {taskFindings(task.result).map((finding, index) => (
                          <div key={index} className="task-finding">
                            <strong>
                              {finding.priority ? finding.priority.toUpperCase() + " · " : ""}
                              {finding.title}
                            </strong>
                            {finding.why ? <p>{finding.why}</p> : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {taskHermesModelEvidence(task.result) ? (
                    <details className="task-result">
                      <summary>View Hermes model evidence</summary>
                      <div className="task-findings">
                        <div className="task-finding">
                          <strong>
                            {taskHermesModelEvidence(task.result)?.provider} · {taskHermesModelEvidence(task.result)?.model}
                          </strong>
                          <p>{taskHermesModelEvidence(task.result)?.output}</p>
                          <p>
                            {typeof taskHermesModelEvidence(task.result)?.totalTokens === "number"
                              ? taskHermesModelEvidence(task.result)?.totalTokens + " tokens · "
                              : ""}
                            {hermesCostLabel(task.result)}
                          </p>
                        </div>
                      </div>
                    </details>
                  ) : null}
                  {taskHermesProjectPatch(task.result) ? (
                    <details className="task-result">
                      <summary>View linked-project patch</summary>
                      <div className="task-findings">
                        <div className="task-finding">
                          <strong>
                            {taskHermesProjectPatch(task.result)?.verificationSucceeded
                              ? "Verification passed"
                              : "Verification needs attention"}
                          </strong>
                          <p>
                            {(taskHermesProjectPatch(task.result)?.changedFiles.length ?? 0) +
                              " changed file(s) · repository write not performed"}
                          </p>
                        </div>
                        {(taskHermesProjectPatch(task.result)?.verificationSteps ?? []).map(
                          (step, index) => (
                            <div className="task-finding" key={index}>
                              <strong>
                                {(step.exitCode === 0 ? "PASS · " : "FAIL · ") +
                                  (step.cmd ?? "verification step")}
                              </strong>
                              {step.stderrTail ? <p>{step.stderrTail}</p> : null}
                            </div>
                          ),
                        )}
                        <div className="task-error-toolbar">
                          <span>Reviewable patch</span>
                          <button
                            type="button"
                            className="task-error-action"
                            onClick={() => void copyTaskPatch(task)}
                          >
                            {copiedPatchTaskId === task.id ? "Copied" : "Copy patch"}
                          </button>
                        </div>
                        {taskHermesProjectPatch(task.result)?.patch ? (
                          <pre className="task-error-code">
                            <code>{taskHermesProjectPatch(task.result)?.patch}</code>
                          </pre>
                        ) : (
                          <p>Hermes completed without producing source changes.</p>
                        )}
                      </div>
                    </details>
                  ) : null}
                  {task.error ? (
                    <details className="task-error">
                      <summary>Error details</summary>
                      <div className="task-error-panel">
                        <div className="task-error-toolbar">
                          <span>Captured failure</span>
                          <button
                            type="button"
                            className="task-error-action"
                            onClick={() => void copyTaskError(task)}
                          >
                            {copiedTaskId === task.id ? "Copied" : "Copy error"}
                          </button>
                        </div>
                        <pre className="task-error-code"><code>{task.error}</code></pre>
                        <div className="task-error-actions">
                          {taskLinkedProjectKey(task.result) ? (
                            <button
                              type="button"
                              className="decision-approve"
                              disabled={working}
                              onClick={() => void retryHermesProjectTask(task)}
                            >
                              Retry Hermes patch
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="task-error-action"
                            onClick={() => prepareErrorRequest(task, "explain")}
                          >
                            Ask CoOperative to explain
                          </button>
                          <button
                            type="button"
                            className="task-error-action"
                            onClick={() => prepareErrorRequest(task, "fix")}
                          >
                            Ask CoOperative to fix
                          </button>
                        </div>
                      </div>
                    </details>
                  ) : null}
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
