"use client";

import Link from "next/link";
import { useState } from "react";

import ProviderBootstrapPanel from "./ProviderBootstrapPanel";\nimport SecretBrokerPanel from "./SecretBrokerPanel";

import {
  linkedProjects,
  type LinkedProjectManifest,
  type ProjectHumanAction,
} from "@/lib/operative/project-registry";

type HealthResult = {
  ok?: boolean;
  status?: number;
  data?: unknown;
  error?: string;
};

type ActiveHandoff = {
  project: LinkedProjectManifest;
  action: ProjectHumanAction;
};

const projects = linkedProjects();

function humanActionStorageKey(projectKey: string, actionKey: string) {
  return `cooperative-human-action:${projectKey}:${actionKey}`;
}

export default function LinkedProjectsPage() {
  const [activeHandoff, setActiveHandoff] = useState<ActiveHandoff | null>(null);
  const [workingProject, setWorkingProject] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, HealthResult>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [hermesRequests, setHermesRequests] = useState<Record<string, string>>({});
  const [hermesBudgets, setHermesBudgets] = useState<Record<string, string>>({
    creatorhub: "0.02",
    raisehub: "0.02",
  });

  function startHumanAction(project: LinkedProjectManifest, action: ProjectHumanAction) {
    setError("");
    setNotice("");
    window.localStorage.setItem(
      humanActionStorageKey(project.key, action.key),
      JSON.stringify({
        state: "awaiting_user",
        startedAt: new Date().toISOString(),
        projectKey: project.key,
        actionKey: action.key,
      }),
    );
    setActiveHandoff({ project, action });
    if (action.mode === "popup-only") {
      openProviderWindow(action);
    }
  }

  function openProviderWindow(action: ProjectHumanAction) {
    const opened = window.open(
      action.launchUrl,
      "_blank",
      "noopener,noreferrer,width=1100,height=800",
    );
    if (!opened) {
      window.location.assign(action.launchUrl);
    }
  }

  async function persistHumanCompletion(project: LinkedProjectManifest, action: ProjectHumanAction) {
    setError("");
    setNotice("");

    try {
      const overviewResponse = await fetch("/api/operative/overview", { cache: "no-store" });
      const overview = await overviewResponse.json();
      if (!overviewResponse.ok) {
        throw new Error(overview.error ?? "Unable to load CoOperative workspace.");
      }

      const message =
        `Human provider step completed for ${project.name}: ${action.title}. ` +
        "No provider password, MFA code, session cookie, or secret value was stored in CoOperative.";

      const response = await fetch("/api/console/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: overview.conversation?.id ?? null,
          text: message,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to record human action.");

      window.localStorage.setItem(
        humanActionStorageKey(project.key, action.key),
        JSON.stringify({
          state: "returned",
          completedAt: new Date().toISOString(),
          projectKey: project.key,
          actionKey: action.key,
        }),
      );

      setNotice(
        `${action.title} marked returned. CoOperative can now run deterministic verification before using Hermes.`,
      );
      setActiveHandoff(null);
      if (project.integrationHealthUrl) {
        await verifyIntegrationHealth(project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record provider setup return.");
    }
  }

  async function verifyIntegrationHealth(project: LinkedProjectManifest) {
    setWorkingProject(project.key);
    setError("");

    try {
      const response = await fetch(
        `/api/operative/projects/${encodeURIComponent(project.key)}/health`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as HealthResult;
      setHealth((current) => ({ ...current, [project.key]: payload }));
      if (!response.ok) {
        throw new Error(payload.error ?? "Project integration health check failed.");
      }
      setNotice(`${project.name} integration health refreshed.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify integration health.");
    } finally {
      setWorkingProject(null);
    }
  }

  async function runProjectHealthCheck(project: LinkedProjectManifest) {
    setWorkingProject(project.key);
    setError("");
    setNotice("");

    try {
      const overviewResponse = await fetch("/api/operative/overview", { cache: "no-store" });
      const overview = await overviewResponse.json();
      if (!overviewResponse.ok) {
        throw new Error(overview.error ?? "Unable to load CoOperative workspace.");
      }

      const messageText =
        `Run the reviewed deterministic ${project.name} health check before escalating to Hermes.`;
      const messageResponse = await fetch("/api/console/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: overview.conversation?.id ?? null,
          text: messageText,
        }),
      });
      const message = await messageResponse.json();
      if (!messageResponse.ok) {
        throw new Error(message.error ?? "Unable to save project health request.");
      }

      const createResponse = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title: `${project.name} deterministic health check`,
          description:
            `Clone ${project.repoSlug} at ${project.defaultRef} and run the allow-listed ` +
            "dependency, test/type-check, lint, and build checks. No repository writes, production changes, " +
            "database changes, secret reads, or paid model reasoning.",
          playbookKey: project.healthPlaybookKey,
          maxSpendUsd: 0,
          flags: { requiresShell: true },
        }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(created.error ?? "Unable to create linked-project health task.");
      }

      const executeResponse = await fetch(
        `/api/operative/tasks/${created.task.id}/execute`,
        { method: "POST" },
      );
      const executed = await executeResponse.json();
      if (!executeResponse.ok) {
        throw new Error(executed.error ?? "Linked-project health task failed to start.");
      }

      setNotice(
        `${project.name} deterministic health check started. Mission Control will track the result.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start project health check.");
    } finally {
      setWorkingProject(null);
    }
  }

  async function runHermesProjectTask(project: LinkedProjectManifest) {
    const request = (hermesRequests[project.key] ?? "").trim();
    const budget = Number(hermesBudgets[project.key] ?? "0");

    if (request.length < 2) {
      setError("Describe the change you want Hermes to prepare first.");
      return;
    }
    if (!Number.isFinite(budget) || budget <= 0 || budget > 1) {
      setError("Set a positive Hermes spend cap of $1.00 or less for this governed patch run.");
      return;
    }

    setWorkingProject(project.key);
    setError("");
    setNotice("");

    try {
      const overviewResponse = await fetch("/api/operative/overview", { cache: "no-store" });
      const overview = await overviewResponse.json();
      if (!overviewResponse.ok) {
        throw new Error(overview.error ?? "Unable to load CoOperative workspace.");
      }

      const messageResponse = await fetch("/api/console/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: overview.conversation?.id ?? null,
          text: `Linked-project Hermes request for ${project.name}: ${request}`,
        }),
      });
      const message = await messageResponse.json();
      if (!messageResponse.ok) {
        throw new Error(message.error ?? "Unable to save Hermes project request.");
      }

      const createResponse = await fetch("/api/operative/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: message.conversationId,
          title: `${project.name} · Hermes patch`,
          description: request,
          playbookKey: project.hermesPlaybookKey,
          maxSpendUsd: budget,
          flags: { requiresShell: true },
        }),
      });
      const created = await createResponse.json();
      if (!createResponse.ok) {
        throw new Error(created.error ?? "Unable to create governed Hermes project task.");
      }

      const executeResponse = await fetch(
        `/api/operative/tasks/${created.task.id}/execute`,
        { method: "POST" },
      );
      const executed = await executeResponse.json();
      if (!executeResponse.ok) {
        throw new Error(executed.error ?? "Unable to start governed Hermes project task.");
      }

      setNotice(
        `${project.name} Hermes patch run started with a ${budget.toFixed(2)} cap. ` +
          "Hermes can edit only the isolated clone with file tools; CoOperative will collect the patch and verify it without writing to GitHub.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start Hermes project task.");
    } finally {
      setWorkingProject(null);
    }
  }

  return (
    <main className="shell operative-shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="nav-links">
          <Link href="/console">Owner Console</Link>
          <div className="badge">Linked projects</div>
        </div>
      </nav>

      <section className="compact-hero">
        <div className="eyebrow">Project control plane</div>
        <h1>Linked projects</h1>
        <p>
          Review known integration lessons first, run deterministic checks before AI,
          and hand human-only provider login or verification back to the owner without
          exposing credentials to Hermes.
        </p>
      </section>

      {notice ? <div className="notice project-notice">{notice}</div> : null}
      {error ? <div className="error project-notice">{error}</div> : null}

      <section className="project-grid">
        {projects.map((project) => (
          <article className="card linked-project-card" key={project.key}>
            <div className="linked-project-head">
              <div>
                <div className="eyebrow">{project.repoSlug}</div>
                <h2>{project.name}</h2>
              </div>
              <span className="status-pill status-completed">linked</span>
            </div>

            <p>{project.description}</p>

            <div className="project-meta-grid">
              <div><span>Git ref</span><strong>{project.defaultRef}</strong></div>
              <div><span>Vercel</span><strong>{project.vercelProject.name}</strong></div>
              <div><span>Supabase</span><strong>{project.supabaseProjectRef ?? "registry pending"}</strong></div>
              <div><span>Hermes</span><strong>governed fallback</strong></div>
            </div>

            <details className="project-detail">
              <summary>Executor policy</summary>
              <ol className="project-policy-list">
                {project.executorPreference.map((executor) => (
                  <li key={executor}>{executor}</li>
                ))}
              </ol>
            </details>

            <details className="project-detail">
              <summary>Environment requirements</summary>
              {project.secretRequirements.length === 0 ? (
                <p>No project-specific environment requirements are registered yet.</p>
              ) : (
                <div className="project-secret-list">
                  {project.secretRequirements.map((item) => (
                    <div className="project-secret-row" key={item.key}>
                      <code>{item.key}</code>
                      <span>{item.secret ? "secret · owner gated" : "identifier · owner gated"}</span>
                      <small>{item.purpose}</small>
                    </div>
                  ))}
                </div>
              )}
              <small className="console-helper">
                Values are deliberately not stored in the manifest or sent to Hermes.
                Secure environment injection remains a separate owner-gated broker operation.
              </small>
            </details>

            <ProviderBootstrapPanel
              projectKey={project.key}
              providers={providerBootstrapsForProject(project.key).map((provider) => ({
                providerKey: provider.providerKey,
                providerName: provider.providerName,
                humanActionKey: provider.humanActionKey,
              }))}
              onOpenHumanAction={(actionKey) => {
                const action = project.humanActions.find(
                  (candidate) => candidate.key === actionKey,
                );
                if (action) startHumanAction(project, action);
              }}
            />

            <SecretBrokerPanel
              projectKey={project.key}
              projectName={project.name}
              requirements={project.secretRequirements}
            />

            {project.humanActions.length > 0 ? (
              <div className="human-actions">
                <div className="eyebrow">Human setup</div>
                {project.humanActions.map((action) => (
                  <div className="human-action-row" key={action.key}>
                    <div>
                      <strong>{action.title}</strong>
                      <p>{action.description}</p>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => startHumanAction(project, action)}
                    >
                      Open setup browser
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {health[project.key] ? (
              <details className="project-detail" open>
                <summary>Integration health response</summary>
                <pre className="task-error-code">
                  <code>{JSON.stringify(health[project.key], null, 2)}</code>
                </pre>
              </details>
            ) : null}

            <section className="project-hermes-workspace">
              <div className="eyebrow">Cloud Hermes workspace</div>
              <p>
                Ask Hermes to inspect this project&apos;s source and prepare a reviewable patch.
                It receives file tools only: no provider credentials, no shell tools, no GitHub write,
                no database mutation, and no deployment.
              </p>
              <textarea
                className="project-hermes-request"
                placeholder={`What should Hermes change in ${project.name}?`}
                value={hermesRequests[project.key] ?? ""}
                onChange={(event) =>
                  setHermesRequests((current) => ({
                    ...current,
                    [project.key]: event.target.value,
                  }))
                }
                disabled={workingProject === project.key}
              />
              <div className="project-hermes-controls">
                <label>
                  Maximum model spend
                  <input
                    type="number"
                    min="0.001"
                    max="1"
                    step="0.001"
                    value={hermesBudgets[project.key] ?? "0.02"}
                    onChange={(event) =>
                      setHermesBudgets((current) => ({
                        ...current,
                        [project.key]: event.target.value,
                      }))
                    }
                    disabled={workingProject === project.key}
                  />
                </label>
                <button
                  className="primary"
                  type="button"
                  disabled={
                    workingProject === project.key ||
                    (hermesRequests[project.key] ?? "").trim().length < 2
                  }
                  onClick={() => void runHermesProjectTask(project)}
                >
                  {workingProject === project.key
                    ? "Starting…"
                    : "Run governed Hermes patch"}
                </button>
              </div>
              <small className="console-helper">
                This spends only up to the cap you set. A successful run stores the model usage,
                cost, changed-file list, patch, and deterministic verification evidence in Mission Control.
                Applying that patch to GitHub remains a separate reviewed action.
              </small>
            </section>

            <div className="linked-project-actions">
              <button
                className="primary"
                type="button"
                disabled={workingProject === project.key}
                onClick={() => void runProjectHealthCheck(project)}
              >
                {workingProject === project.key ? "Starting…" : "Run deterministic health check"}
              </button>
              {project.integrationHealthUrl ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={workingProject === project.key}
                  onClick={() => void verifyIntegrationHealth(project)}
                >
                  Check integration status
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {activeHandoff ? (
        <div className="provider-browser-backdrop" role="presentation">
          <section className="provider-browser" role="dialog" aria-modal="true">
            <header className="provider-browser-head">
              <div>
                <div className="eyebrow">
                  CoOperative secure handoff · {activeHandoff.action.provider}
                </div>
                <strong>{activeHandoff.action.title}</strong>
              </div>
              <button
                className="task-error-action"
                type="button"
                onClick={() => setActiveHandoff(null)}
              >
                Close
              </button>
            </header>

            <div className="provider-browser-location">
              <span>Provider</span>
              <code>{activeHandoff.action.launchUrl}</code>
            </div>

            <div className="provider-browser-frame-wrap">
              {activeHandoff.action.mode === "popup-only" ? (
                <div className="provider-popup-only">
                  <strong>{activeHandoff.action.provider} requires a full browser window.</strong>
                  <p>
                    CoOperative opened the provider securely in a separate tab/window.
                    Complete the setup there, then return here and tap Done · return.
                  </p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => openProviderWindow(activeHandoff.action)}
                  >
                    Reopen provider
                  </button>
                </div>
              ) : (
                <iframe
                  className="provider-browser-frame"
                  title={activeHandoff.action.title}
                  src={activeHandoff.action.launchUrl}
                  referrerPolicy="no-referrer"
                  sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation"
                />
              )}
            </div>

            <details className="provider-browser-guidance">
              <summary>Security & setup notes</summary>
              <div className="provider-browser-guidance-body">
                <p>
                  CoOperative cannot read this provider page, your password, MFA codes,
                  CAPTCHA, KYC details, or provider cookies. Some providers also refuse
                  to load login pages inside embedded frames.
                </p>
                {activeHandoff.action.callbackUrl ? (
                  <p>
                    Register callback: <code>{activeHandoff.action.callbackUrl}</code>
                  </p>
                ) : null}
                {activeHandoff.action.relatedSecretKeys.length > 0 ? (
                  <p>
                    Expected variables: {activeHandoff.action.relatedSecretKeys.join(", ")}.
                    Values remain behind the secret broker gate.
                  </p>
                ) : null}
              </div>
            </details>

            <div className="provider-browser-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => openProviderWindow(activeHandoff.action)}
              >
                Open external
              </button>
              <button
                className="primary"
                type="button"
                onClick={() =>
                  void persistHumanCompletion(activeHandoff.project, activeHandoff.action)
                }
              >
                Done · return
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
