"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type WorkflowSummary = {
  id: string;
  repo_key: string;
  objective: string;
  preset: "economy" | "balanced" | "premium";
  status: string;
  max_parallel_nodes: number;
  max_spend_microusd: number;
  estimated_spend_microusd: number;
  actual_spend_microusd: number;
  competitive_mode: boolean;
  created_at: string;
  updated_at: string;
};

type WorkflowNode = {
  id: string;
  node_key: string;
  role: string;
  node_kind: string;
  task_type: string;
  objective: string;
  depends_on: string[];
  required: boolean;
  mutates_repo: boolean;
  status: string;
  selected_provider?: string | null;
  selected_model?: string | null;
  selected_route_kind?: string | null;
  score_snapshot?: Record<string, unknown> | null;
  estimated_cost_microusd: number;
  actual_cost_microusd: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
};

type WorkflowDetail = {
  workflow: WorkflowSummary & {
    plan?: Record<string, unknown>;
    result?: Record<string, unknown> | null;
    error?: string | null;
  };
  nodes: WorkflowNode[];
  events: Array<{
    id: string;
    kind: string;
    message: string;
    created_at: string;
  }>;
};

const ACTIVE = new Set(["planned", "running", "waiting"]);

function dollars(microusd: number) {
  return "$" + (microusd / 1_000_000).toFixed(4);
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export default function WorkflowConsole() {
  const [repoKey, setRepoKey] = useState<"cooperative" | "creatorhub">("cooperative");
  const [mode, setMode] = useState<"inspect" | "prepare_change">("prepare_change");
  const [preset, setPreset] = useState<"economy" | "balanced" | "premium">("balanced");
  const [maxSpendUsd, setMaxSpendUsd] = useState("0.25");
  const [objective, setObjective] = useState("");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [details, setDetails] = useState<Record<string, WorkflowDetail>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refreshList = useCallback(async () => {
    const response = await fetch("/api/agents/workflows", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load workflows.");
    }
    setWorkflows(result.workflows || []);
    return (result.workflows || []) as WorkflowSummary[];
  }, []);

  const refreshOne = useCallback(async (id: string) => {
    const response = await fetch("/api/agents/workflows?id=" + encodeURIComponent(id), {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load workflow.");
    }
    if (result.workflow) {
      setDetails((current) => ({ ...current, [id]: result.workflow }));
      return result.workflow as WorkflowDetail;
    }
    return null;
  }, []);

  useEffect(() => {
    void refreshList().catch((err) => {
      setError(err instanceof Error ? err.message : "Could not load workflows.");
    });
  }, [refreshList]);

  useEffect(() => {
    const active = workflows.filter((workflow) => ACTIVE.has(workflow.status));
    if (!active.length && !expanded) return;

    const tick = async () => {
      try {
        const ids = new Set(
          active.slice(0, 6).map((workflow) => workflow.id),
        );
        if (expanded) ids.add(expanded);
        await Promise.all([...ids].map((id) => refreshOne(id)));
        await refreshList();
      } catch {
        // Keep the console usable if one polling pass misses.
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => window.clearInterval(timer);
  }, [workflows, expanded, refreshList, refreshOne]);

  const selected = expanded ? details[expanded] : null;

  const activeCount = useMemo(
    () => workflows.filter((workflow) => ACTIVE.has(workflow.status)).length,
    [workflows],
  );

  async function launch() {
    if (!objective.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/agents/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoKey,
          objective: objective.trim(),
          mode,
          preset,
          maxSpendUsd: Math.max(0, Number(maxSpendUsd) || 0),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.workflow?.workflow?.id) {
        throw new Error(
          result.detail || result.error || "Could not create workflow.",
        );
      }
      const id = result.workflow.workflow.id as string;
      setObjective("");
      setExpanded(id);
      setDetails((current) => ({ ...current, [id]: result.workflow }));
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create workflow.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="agent-layout">
      <div className="card agent-compose">
        <div className="row">
          <label className="field">
            <span>Repository</span>
            <select
              value={repoKey}
              onChange={(event) =>
                setRepoKey(event.target.value as "cooperative" | "creatorhub")
              }
            >
              <option value="cooperative">CoOperative</option>
              <option value="creatorhub">CreatorHub</option>
            </select>
          </label>

          <label className="field">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as "inspect" | "prepare_change")
              }
            >
              <option value="inspect">Inspect / analyze</option>
              <option value="prepare_change">Prepare code change</option>
            </select>
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>Workflow preset</span>
            <select
              value={preset}
              onChange={(event) =>
                setPreset(event.target.value as "economy" | "balanced" | "premium")
              }
            >
              <option value="economy">Economy · sequential</option>
              <option value="balanced">Balanced · parallel specialists</option>
              <option value="premium">Premium · competitive planning</option>
            </select>
          </label>

          <label className="field">
            <span>Shared request budget ceiling</span>
            <input
              value={maxSpendUsd}
              onChange={(event) => setMaxSpendUsd(event.target.value)}
              inputMode="decimal"
              placeholder="0.25"
            />
            <small>
              Current rollout auto-executes owned/local and verified-free models.
              Paid execution remains separately approval-gated.
            </small>
          </label>
        </div>

        <label className="field">
          <span>Objective</span>
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            maxLength={12000}
            placeholder="Example: Review our model-routing code, identify the safest way to parallelize independent agent work, implement the change, and verify it."
          />
        </label>

        <div className="agent-submit-row">
          <button
            className="primary"
            type="button"
            onClick={() => void launch()}
            disabled={submitting || !objective.trim()}
          >
            {submitting ? "Building workflow…" : "Run multi-agent workflow"}
          </button>
          <span>
            {activeCount} active · repo mutation remains serialized
          </span>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>

      {selected ? (
        <div className="card">
          <strong>{selected.workflow.preset} workflow</strong>
          <p>{selected.workflow.objective}</p>
          <p>
            Status: <b>{selected.workflow.status}</b> · Max parallel{" "}
            {selected.workflow.max_parallel_nodes} · Budget{" "}
            {dollars(selected.workflow.max_spend_microusd)}
          </p>

          <div className="agent-task-list">
            {selected.nodes.map((node) => {
              const value = num(node.score_snapshot?.overallValue);
              const performance = num(node.score_snapshot?.performance);
              const confidence = num(node.score_snapshot?.confidence);
              return (
                <article className="card agent-task" key={node.id}>
                  <div className="agent-task-head">
                    <span>
                      <strong>{node.node_key}</strong>
                      <small>
                        {node.role} · {node.task_type} ·{" "}
                        {node.node_kind.replaceAll("-", " ")}
                      </small>
                    </span>
                    <span className={"agent-status " + node.status}>
                      {node.status}
                    </span>
                  </div>

                  <p>{node.objective}</p>
                  <p>
                    <b>Model:</b>{" "}
                    {node.selected_provider && node.selected_model
                      ? node.selected_provider + " / " + node.selected_model
                      : "No eligible route"}
                  </p>
                  <p>
                    Value {value === null ? "—" : value.toFixed(1)} · Performance{" "}
                    {performance === null ? "—" : performance.toFixed(1)} · Confidence{" "}
                    {confidence === null
                      ? "—"
                      : Math.round(confidence * 100) + "%"}
                  </p>
                  {node.depends_on?.length ? (
                    <p><b>Depends on:</b> {node.depends_on.join(", ")}</p>
                  ) : (
                    <p><b>Parallel-ready:</b> no dependencies</p>
                  )}
                  {node.error ? <p className="error">{node.error}</p> : null}
                  {typeof node.result?.text === "string" ? (
                    <details>
                      <summary>Output</summary>
                      <pre className="agent-output">{node.result.text}</pre>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="agent-task-list">
        {workflows.map((workflow) => (
          <article className="card agent-task" key={workflow.id}>
            <button
              className="agent-task-head"
              type="button"
              onClick={() => {
                setExpanded(workflow.id);
                void refreshOne(workflow.id);
              }}
            >
              <span>
                <strong>{workflow.preset} · {workflow.repo_key}</strong>
                <small>{workflow.objective.slice(0, 140)}</small>
              </span>
              <span className={"agent-status " + workflow.status}>
                {workflow.status}
              </span>
            </button>
            <p>
              Parallel {workflow.max_parallel_nodes} · Budget{" "}
              {dollars(workflow.max_spend_microusd)} · Used{" "}
              {dollars(workflow.actual_spend_microusd)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
