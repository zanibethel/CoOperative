"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Requirement = {
  key: string;
  purpose: string;
  secret: boolean;
  ownerGate: boolean;
  environments: readonly ("preview" | "production")[];
};

type SecretRequestRecord = {
  id: string;
  title: string;
  status: string;
  approvalStatus: string;
  result: unknown;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

type StatusResponse = {
  projectKey: string;
  brokerConfigured: boolean;
  requests: SecretRequestRecord[];
};

function requestScope(result: unknown): {
  projectKey?: string;
  key?: string;
  target?: "preview" | "production";
} | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const request = (result as Record<string, unknown>).secretRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const record = request as Record<string, unknown>;
  const target =
    record.target === "preview" || record.target === "production"
      ? record.target
      : undefined;
  return {
    projectKey:
      typeof record.projectKey === "string" ? record.projectKey : undefined,
    key: typeof record.key === "string" ? record.key : undefined,
    target,
  };
}

export default function SecretBrokerPanel({
  projectKey,
  projectName,
  requirements,
}: {
  projectKey: string;
  projectName: string;
  requirements: readonly Requirement[];
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [working, setWorking] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (requirements.length === 0) return;
    const response = await fetch(
      `/api/operative/projects/${encodeURIComponent(projectKey)}/secrets`,
      { cache: "no-store" },
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load secret-broker status.");
    }
    setStatus(payload as StatusResponse);
  }, [projectKey, requirements.length]);

  useEffect(() => {
    void refresh().catch((err) =>
      setError(
        err instanceof Error ? err.message : "Unable to load secret-broker status.",
      ),
    );
  }, [refresh]);

  const latestByScope = useMemo(() => {
    const map = new Map<string, SecretRequestRecord>();
    for (const item of status?.requests ?? []) {
      const scope = requestScope(item.result);
      if (!scope?.key || !scope.target) continue;
      const key = scope.key + ":" + scope.target;
      if (!map.has(key)) map.set(key, item);
    }
    return map;
  }, [status]);

  async function currentConversationId(): Promise<string | null> {
    const response = await fetch("/api/operative/overview", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load CoOperative workspace.");
    }
    return payload.conversation?.id ?? null;
  }

  async function requestApproval(
    requirement: Requirement,
    target: "preview" | "production",
  ) {
    const workKey = requirement.key + ":" + target;
    setWorking(workKey);
    setNotice("");
    setError("");

    try {
      const conversationId = await currentConversationId();
      const response = await fetch(
        `/api/operative/projects/${encodeURIComponent(projectKey)}/secrets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            key: requirement.key,
            target,
            conversationId,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to request secret approval.");
      }
      setNotice(
        `${requirement.key} · ${target} is waiting for owner approval. No secret value has been requested yet.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to request approval.");
    } finally {
      setWorking("");
    }
  }

  async function applyApprovedSecret(
    requestRecord: SecretRequestRecord,
    requirement: Requirement,
    target: "preview" | "production",
  ) {
    const value = values[requestRecord.id] ?? "";
    if (!value) {
      setError("Enter the provider value after approval.");
      return;
    }

    setWorking(requestRecord.id);
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/operative/projects/${encodeURIComponent(projectKey)}/secrets/apply`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body: JSON.stringify({
            taskId: requestRecord.id,
            key: requirement.key,
            target,
            value,
          }),
        },
      );

      setValues((current) => ({ ...current, [requestRecord.id]: "" }));

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Secure environment write failed.");
      }

      setNotice(
        `${requirement.key} was written to ${projectName} ${target}. CoOperative did not retain the value and did not redeploy the project.`,
      );
      await refresh();
    } catch (err) {
      setValues((current) => ({ ...current, [requestRecord.id]: "" }));
      setError(
        err instanceof Error ? err.message : "Unable to apply approved secret.",
      );
      await refresh().catch(() => undefined);
    } finally {
      setWorking("");
    }
  }

  if (requirements.length === 0) {
    return null;
  }

  return (
    <section className="project-secret-broker">
      <div className="linked-project-head">
        <div>
          <div className="eyebrow">Secure secret broker</div>
          <h3>Owner-approved environment setup</h3>
        </div>
        <span
          className={[
            "status-pill",
            status?.brokerConfigured ? "status-completed" : "status-awaiting_approval",
          ].join(" ")}
        >
          {status?.brokerConfigured ? "broker configured" : "setup required"}
        </span>
      </div>

      <p>
        Approval happens before CoOperative asks for a value. Approved values travel
        directly from this form to the server-side Vercel broker. They are not saved
        in CoOperative, task text, Git, or Hermes context.
      </p>

      {!status?.brokerConfigured ? (
        <div className="secret-broker-setup">
          <strong>One-time broker setup is still required.</strong>
          <p>
            Use the CoOperative provider browser to create/link the Vercel Connect
            API-key connector and configure its connector UID. Until then, approvals
            can be prepared, but CoOperative will refuse the actual secret write.
          </p>
        </div>
      ) : null}

      <div className="project-secret-list">
        {requirements.map((requirement) => (
          <div className="project-secret-row secret-broker-row" key={requirement.key}>
            <div>
              <code>{requirement.key}</code>
              <small>{requirement.purpose}</small>
            </div>

            {requirement.environments.map((target) => {
              const scopeKey = requirement.key + ":" + target;
              const current = latestByScope.get(scopeKey);
              const approved =
                current?.approvalStatus === "approved" &&
                ["awaiting_approval", "failed"].includes(current.status);
              const completed = current?.status === "completed";

              return (
                <div className="secret-target-row" key={scopeKey}>
                  <div className="secret-target-meta">
                    <strong>{target}</strong>
                    <span>
                      {completed
                        ? "configured · redeploy still separate"
                        : approved
                          ? "approved · value entry unlocked"
                          : current?.approvalStatus === "pending"
                            ? "waiting for approval"
                            : current?.status === "failed"
                              ? "previous attempt failed"
                              : "not requested"}
                    </span>
                  </div>

                  {approved && current ? (
                    <div className="secret-value-entry">
                      <input
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={"Enter " + requirement.key + " once"}
                        value={values[current.id] ?? ""}
                        onChange={(event) =>
                          setValues((state) => ({
                            ...state,
                            [current.id]: event.target.value,
                          }))
                        }
                        disabled={working === current.id}
                      />
                      <button
                        type="button"
                        className="primary"
                        disabled={working === current.id || !(values[current.id] ?? "")}
                        onClick={() =>
                          void applyApprovedSecret(current, requirement, target)
                        }
                      >
                        {working === current.id ? "Applying…" : "Apply securely"}
                      </button>
                    </div>
                  ) : completed ? (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={working === scopeKey}
                      onClick={() => void requestApproval(requirement, target)}
                    >
                      Request replacement
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        working === scopeKey ||
                        current?.approvalStatus === "pending"
                      }
                      onClick={() => void requestApproval(requirement, target)}
                    >
                      {current?.approvalStatus === "pending"
                        ? "Approval pending"
                        : "Request approval"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {status?.requests.some((item) => item.approvalStatus === "pending") ? (
        <p className="console-helper">
          <Link href="/console">Open Pending decisions</Link> to approve or reject
          the exact project, variable, and environment before value entry unlocks.
        </p>
      ) : null}

      {notice ? <div className="notice">{notice}</div> : null}
      {error ? <div className="error">{error}</div> : null}
    </section>
  );
}
