"use client";

import { useCallback, useEffect, useState } from "react";

type ProviderSummary = {
  providerKey: string;
  providerName: string;
  humanActionKey: string;
};

type BootstrapResponse = {
  providerKey: string;
  providerName: string;
  preferredAuthOrder: string[];
  currentlySupportedAuth: string;
  secretRequirements: Array<{ key?: string; purpose?: string }>;
  verification: {
    liveChecked?: boolean;
    liveStatus?: {
      configured?: boolean;
      reachable?: boolean;
      detail?: string | null;
      toolCount?: number | null;
      toolNames?: string[];
    } | null;
    liveError?: string | null;
  };
  next?: {
    state?: "ready" | "verification_failed" | "human_action_required";
    action?: string;
    detail?: string;
  };
  paidModelRequiredForBootstrap?: boolean;
  hermesRequiredForBootstrap?: boolean;
};

function statusLabel(state: string) {
  if (state === "ready") return "ready";
  if (state === "verification_failed") return "needs verification";
  return "setup required";
}

export default function ProviderBootstrapPanel({
  projectKey,
  providers,
  onOpenHumanAction,
}: {
  projectKey: string;
  providers: readonly ProviderSummary[];
  onOpenHumanAction: (actionKey: string) => void;
}) {
  const [states, setStates] = useState<Record<string, BootstrapResponse>>({});
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(
    async (providerKey: string) => {
      setWorking(providerKey);
      setError("");
      try {
        const response = await fetch(
          `/api/operative/projects/${encodeURIComponent(projectKey)}/providers/${encodeURIComponent(providerKey)}/bootstrap`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as BootstrapResponse & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Provider bootstrap check failed.");
        }
        setStates((current) => ({ ...current, [providerKey]: payload }));
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to check provider bootstrap state.",
        );
      } finally {
        setWorking("");
      }
    },
    [projectKey],
  );

  const providerKeySignature = providers
    .map((provider) => provider.providerKey)
    .join("|");

  useEffect(() => {
    for (const providerKey of providerKeySignature.split("|").filter(Boolean)) {
      void refresh(providerKey);
    }
  }, [providerKeySignature, refresh]);

  if (providers.length === 0) return null;

  return (
    <section className="project-secret-broker provider-bootstrap-panel">
      <div className="linked-project-head">
        <div>
          <div className="eyebrow">Provider Bootstrap</div>
          <h3>Connect provider, verify, continue</h3>
        </div>
        <span className="status-pill status-completed">deterministic first</span>
      </div>

      <p>
        CoOperative resolves the reviewed auth path, asks you only for unavoidable
        provider identity/consent steps, keeps secrets behind the broker gate, and
        verifies the live connection without spending model credits.
      </p>

      <div className="project-secret-list">
        {providers.map((provider) => {
          const state = states[provider.providerKey];
          const live = state?.verification.liveStatus;
          const ready = state?.next?.state === "ready";
          const needsVerification =
            state?.next?.state === "verification_failed";

          return (
            <div
              className="project-secret-row secret-broker-row"
              key={provider.providerKey}
            >
              <div>
                <strong>{state?.providerName ?? provider.providerName}</strong>
                <small>
                  {state
                    ? `auth: ${state.currentlySupportedAuth} · preferred: ${state.preferredAuthOrder.join(" → ")}`
                    : "checking reviewed bootstrap…"}
                </small>
              </div>

              <div className="secret-target-row">
                <div className="secret-target-meta">
                  <strong>{statusLabel(state?.next?.state ?? "checking")}</strong>
                  <span>
                    {live?.detail ??
                      state?.verification.liveError ??
                      state?.next?.detail ??
                      "Reading live provider state…"}
                  </span>
                  {typeof live?.toolCount === "number" ? (
                    <span>
                      {live.toolCount} live MCP tool{live.toolCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                <div className="provider-bootstrap-actions">
                  {!ready ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onOpenHumanAction(provider.humanActionKey)}
                    >
                      Open required provider step
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={ready ? "secondary-button" : "primary"}
                    disabled={working === provider.providerKey}
                    onClick={() => void refresh(provider.providerKey)}
                  >
                    {working === provider.providerKey
                      ? "Verifying…"
                      : ready
                        ? "Re-verify"
                        : needsVerification
                          ? "Verify again"
                          : "Check live status"}
                  </button>
                  {!ready ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        document
                          .getElementById(`secret-broker-${projectKey}`)
                          ?.scrollIntoView({ behavior: "smooth", block: "start" })
                      }
                    >
                      Continue to secret broker
                    </button>
                  ) : null}
                </div>
              </div>

              {state ? (
                <small>
                  Model spend: none · Hermes: not required
                  {state.secretRequirements.length
                    ? ` · brokered key: ${state.secretRequirements
                        .map((item) => item.key)
                        .filter(Boolean)
                        .join(", ")}`
                    : ""}
                </small>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <div className="error">{error}</div> : null}
    </section>
  );
}
