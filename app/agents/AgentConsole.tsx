"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Agent = {
  key: string;
  name: string;
  purpose: string;
  preferredProfile: "fast" | "quality";
  modes: string[];
};

type Repository = {
  key: string;
  name: string;
  githubRepo: string;
};

type RegistryResult = {
  agents?: Agent[];
  repositories?: Repository[];
  error?: string;
};

type AgentTask = {
  id: string;
  agent_key: string;
  repo_key: string;
  mode: string;
  objective: string;
  requested_profile: string;
  status: string;
  branch_name?: string | null;
  result?: {
    summary?: string;
    analysis?: string;
    changedFiles?: string[];
    checksPassed?: boolean;
    checks?: Array<{ command?: string; passed?: boolean; output?: string }>;
    diffStat?: string;
    diff?: string;
    model?: string;
  } | null;
  error?: string | null;
  created_at?: string;
  completed_at?: string | null;
};

type TaskListResult = {
  tasks?: AgentTask[];
  taskId?: string;
  error?: string;
  detail?: string;
};

const ACTIVE = new Set(["queued", "running", "waiting_llm"]);

export default function AgentConsole() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [agentKey, setAgentKey] = useState("repo-engineer");
  const [repoKey, setRepoKey] = useState("cooperative");
  const [mode, setMode] = useState("inspect");
  const [profile, setProfile] = useState<"fast" | "quality">("fast");
  const [objective, setObjective] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.key === agentKey),
    [agents, agentKey],
  );

  const refreshTasks = useCallback(async () => {
    const response = await fetch("/api/agents/tasks", { cache: "no-store" });
    const result = (await response.json()) as TaskListResult;
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load agent tasks.");
    }
    setTasks(result.tasks || []);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const registryResponse = await fetch("/api/agents/registry", { cache: "no-store" });
        const registry = (await registryResponse.json()) as RegistryResult;
        if (!registryResponse.ok) {
          throw new Error(registry.error || "Could not load agent registry.");
        }
        if (cancelled) return;

        setAgents(registry.agents || []);
        setRepositories(registry.repositories || []);
        const firstAgent = registry.agents?.[0];
        if (firstAgent) {
          setAgentKey(firstAgent.key);
          setProfile(firstAgent.preferredProfile);
          setMode(firstAgent.modes[0] || "inspect");
        }
        await refreshTasks();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load agent runtime.");
        }
      }
    }

    void initialize();
    return () => {
      cancelled = true;
    };
  }, [refreshTasks]);

  useEffect(() => {
    if (!tasks.some((task) => ACTIVE.has(task.status))) return;

    const timer = window.setInterval(() => {
      void refreshTasks().catch(() => undefined);
    }, 1800);

    return () => window.clearInterval(timer);
  }, [tasks, refreshTasks]);

  useEffect(() => {
    if (!selectedAgent) return;
    if (!selectedAgent.modes.includes(mode)) {
      setMode(selectedAgent.modes[0] || "inspect");
    }
    setProfile(selectedAgent.preferredProfile);
  }, [selectedAgent, mode]);

  async function queueTask() {
    const trimmed = objective.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/agents/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentKey,
          repoKey,
          mode,
          objective: trimmed,
          profile,
        }),
      });
      const result = (await response.json()) as TaskListResult;
      if (!response.ok || !result.taskId) {
        throw new Error(result.detail || result.error || "Could not queue agent task.");
      }
      setObjective("");
      setExpandedTaskId(result.taskId);
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue agent task.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="agent-layout">
      <div className="card agent-compose">
        <div className="row">
          <label className="field">
            <span>Agent</span>
            <select
              value={agentKey}
              onChange={(event) => setAgentKey(event.target.value)}
            >
              {agents.map((agent) => (
                <option value={agent.key} key={agent.key}>
                  {agent.name}
                </option>
              ))}
            </select>
            <small>{selectedAgent?.purpose}</small>
          </label>

          <label className="field">
            <span>Repository</span>
            <select value={repoKey} onChange={(event) => setRepoKey(event.target.value)}>
              {repositories.map((repository) => (
                <option value={repository.key} key={repository.key}>
                  {repository.name} · {repository.githubRepo}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="row">
          <label className="field">
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              {(selectedAgent?.modes || []).map((item) => (
                <option value={item} key={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Local model</span>
            <select
              value={profile}
              onChange={(event) => setProfile(event.target.value as "fast" | "quality")}
            >
              <option value="fast">Local Fast</option>
              <option value="quality">Local Quality</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>Objective</span>
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Example: Inspect the Local AI chat code and identify the safest next UX improvements without changing anything."
            maxLength={12000}
          />
        </label>

        <div className="agent-submit-row">
          <button
            className="primary"
            type="button"
            onClick={() => void queueTask()}
            disabled={submitting || !objective.trim()}
          >
            {submitting ? "Queueing…" : "Queue agent task"}
          </button>
          <span>Prepare modes never push or deploy automatically.</span>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="agent-task-list">
        {tasks.length === 0 ? (
          <div className="card">
            <strong>No agent tasks yet</strong>
            <p>The local repo worker will claim tasks after it is running on the Mac.</p>
          </div>
        ) : (
          tasks.map((task) => {
            const expanded = expandedTaskId === task.id;
            const statusClass = task.status.replace("_", "-");
            return (
              <article className="card agent-task" key={task.id}>
                <button
                  className="agent-task-head"
                  type="button"
                  onClick={() => setExpandedTaskId(expanded ? null : task.id)}
                >
                  <span>
                    <strong>{task.agent_key.replaceAll("-", " ")}</strong>
                    <small>{task.repo_key} · {task.mode.replaceAll("_", " ")}</small>
                  </span>
                  <span className={`agent-status ${statusClass}`}>{task.status}</span>
                </button>

                <p>{task.objective}</p>

                {expanded ? (
                  <div className="agent-task-detail">
                    {task.branch_name ? (
                      <p><b>Local branch:</b> {task.branch_name}</p>
                    ) : null}

                    {task.result?.summary ? <p>{task.result.summary}</p> : null}

                    {task.result?.analysis ? (
                      <pre className="agent-output">{task.result.analysis}</pre>
                    ) : null}

                    {task.result?.changedFiles?.length ? (
                      <div>
                        <b>Changed files</b>
                        <pre className="agent-output">
                          {task.result.changedFiles.join("\n")}
                        </pre>
                      </div>
                    ) : null}

                    {task.result?.checks?.length ? (
                      <div className="agent-checks">
                        {task.result.checks.map((check, index) => (
                          <div className="agent-check" key={`${check.command}-${index}`}>
                            <span>{check.passed ? "✓" : "×"} {check.command}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {task.result?.diffStat ? (
                      <pre className="agent-output">{task.result.diffStat}</pre>
                    ) : null}

                    {task.result?.diff ? (
                      <details>
                        <summary>View prepared diff</summary>
                        <pre className="agent-output agent-diff">{task.result.diff}</pre>
                      </details>
                    ) : null}

                    {task.error ? <p className="error">{task.error}</p> : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
