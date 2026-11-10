"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SERVICE_CONNECTOR_REGISTRY } from "@/lib/runtime/service-connector-registry";

type GithubRepo = {
  fullName: string;
  url: string;
  private: boolean;
  canRead: boolean;
  canWrite: boolean;
};

type Account = {
  id: string;
  account_label: string | null;
  connection_status: string;
  expires_at: string | null;
  granted_scopes: string[];
};

const supported = new Set([
  "github", "gmail", "roblox", "vercel", "supabase",
  "facebook", "instagram", "icloud",
]);
const providers = SERVICE_CONNECTOR_REGISTRY.filter(
  (provider) => supported.has(provider.providerKey),
);

export default function ConnectionsPage() {
  const [accounts, setAccounts] = useState<Record<string, Account[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loginLinks, setLoginLinks] = useState<Record<string, string>>({});
  const [githubRepos, setGithubRepos] = useState<Record<string, GithubRepo[]>>({});
  const [repoLoading, setRepoLoading] = useState<string | null>(null);
  const [githubInstallUrl, setGithubInstallUrl] = useState<string | null>(null);

  const [initialized, setInitialized] = useState(false);
  const deepLinkStarted = useRef(false);

  const refresh = useCallback(async () => {
    const next: Record<string, Account[]> = {};
    await Promise.all(providers.filter((p) => p.implementation === "available" && p.authKind === "oauth")
      .map(async (provider) => {
        const response = await fetch(
          "/api/local-ai/oauth-connect?providerKey=" + encodeURIComponent(provider.providerKey),
          { cache: "no-store" },
        );
        if (response.status === 401) throw new Error("Please sign in to CoOperative first.");
        if (!response.ok) throw new Error("Could not load connected accounts.");
        const payload = await response.json() as { accounts?: Account[] };
        next[provider.providerKey] = payload.accounts || [];
      }));
    const setupResponse = await fetch("/api/connections/github?mode=setup", {
      cache: "no-store",
    });
    if (setupResponse.ok) {
      const setup = await setupResponse.json() as { installationUrl?: string | null };
      setGithubInstallUrl(setup.installationUrl || null);
    }
    setAccounts(next);
    setInitialized(true);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => {
      setErrors((current) => ({ ...current, general: String(error) }));
    });
  }, [refresh]);

  useEffect(() => {
    if (deepLinkStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("oauth")) return; // callback must never restart authorization
    const requested = params.get("provider") || "";
    const provider = providers.find((item) =>
      item.providerKey === requested &&
      item.implementation === "available" &&
      item.authKind === "oauth"
    );
    if (!provider) return;
    deepLinkStarted.current = true;
    const providerKey = provider.providerKey;
    // This is reached only after a user chooses a provider from an
    // authenticated CoOperative chat. Redirect in the same tab on mobile.
    void (async () => {
      setBusy(providerKey);
      try {
        const response = await fetch(
          "/api/local-ai/oauth-connect?providerKey=" + encodeURIComponent(providerKey),
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        const data = await response.json() as { verificationUrl?: string; error?: string };
        if (!response.ok || !data.verificationUrl ||
          !data.verificationUrl.startsWith("https://")) {
          throw new Error(data.error || "Could not start provider sign-in.");
        }
        window.location.assign(data.verificationUrl);
      } catch (error) {
        setErrors((current) => ({
          ...current,
          [providerKey]: error instanceof Error ? error.message : "Could not start sign-in.",
        }));
        setBusy(null);
      }
    })();
  }, []);

  async function connect(providerKey: string) {
    if (busy) return;
    setBusy(providerKey);
    setErrors((previous) => ({ ...previous, [providerKey]: "" }));
    // Open a blank tab while the click gesture is active to avoid popup blockers.
    const popup = window.open("about:blank", "_blank");
    try {
      const response = await fetch(
        "/api/local-ai/oauth-connect?providerKey=" + encodeURIComponent(providerKey),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      const payload = await response.json() as {
        sessionId?: string;
        verificationUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.sessionId || !payload.verificationUrl) {
        throw new Error(payload.error || "Could not start sign-in.");
      }
      setLoginLinks((previous) => ({ ...previous, [providerKey]: payload.verificationUrl! }));
      if (popup) popup.location.href = payload.verificationUrl;
      const id = payload.sessionId;
      // Poll the server for the result. The callback never sends tokens to this page.
      const interval = window.setInterval(() => {
        void (async () => {
          const status = await fetch(
            "/api/local-ai/oauth-connect?sessionId=" + encodeURIComponent(id),
            { cache: "no-store" },
          );
          if (!status.ok) return;
          const result = await status.json() as { status?: string };
          if (result.status === "approved") {
            window.clearInterval(interval);
            setBusy(null);
            setLoginLinks((previous) => ({ ...previous, [providerKey]: "" }));
            await refresh();
          } else if (result.status === "failed" || result.status === "expired") {
            window.clearInterval(interval);
            setBusy(null);
            setErrors((previous) => ({
              ...previous, [providerKey]: "Sign-in was not completed. You can try again.",
            }));
          }
        })().catch(() => {});
      }, 2000);
      window.setTimeout(() => { window.clearInterval(interval); setBusy(null); }, 11 * 60 * 1000);
      return;
    } catch (error) {
      if (popup) popup.close();
      setErrors((previous) => ({
        ...previous,
        [providerKey]: error instanceof Error ? error.message : "Sign-in failed.",
      }));
    }
    setBusy(null);
  }

  async function showGitHubRepositories(connectionId: string) {
    if (repoLoading) return;
    setRepoLoading(connectionId);
    setErrors((current) => ({ ...current, github: "" }));
    try {
      const response = await fetch(
        "/api/connections/github?mode=repositories&connectionId=" +
          encodeURIComponent(connectionId),
        { cache: "no-store" },
      );
      const data = await response.json() as { repositories?: GithubRepo[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not read GitHub repositories.");
      setGithubRepos((current) => ({ ...current, [connectionId]: data.repositories || [] }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        github: error instanceof Error ? error.message : "Could not read GitHub repositories.",
      }));
    } finally {
      setRepoLoading(null);
    }
  }

  async function disconnect(connectionId: string, providerKey: string) {
    if (!window.confirm("Disconnect this account from CoOperative?")) return;
    setBusy(providerKey);
    try {
      const response = await fetch("/api/local-ai/oauth-connect", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      if (!response.ok) throw new Error("Could not disconnect the account.");
      await refresh();
    } catch (error) {
      setErrors((previous) => ({ ...previous, [providerKey]: String(error) }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 18px" }}>
      <h1>Connected accounts</h1>
      <p>
        Each account is linked only to your signed-in CoOperative identity.
        You approve access on the provider&apos;s own website; your password is never requested here.
      </p>
      {errors.general ? <p role="alert">{errors.general}</p> : null}
      {providers.map((provider) => {
        const available = provider.implementation === "available" && provider.authKind === "oauth";
        const linked = (accounts[provider.providerKey] || [])
          .filter((account) => account.connection_status !== "disconnected");
        return (
          <section key={provider.providerKey}
            style={{ border: "1px solid #7775", borderRadius: 12, padding: 16, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <strong>{provider.providerName}</strong>
                <p style={{ margin: "4px 0", fontSize: 13, opacity: 0.8 }}>
                  {available ? (linked.length ? linked.length + " account(s) linked" : "Not connected")
                    : "Connector requires provider-specific setup"}
                </p>
              </div>
              <button type="button" disabled={!available || busy !== null}
                onClick={() => void connect(provider.providerKey)}>
                {busy === provider.providerKey ? "Connecting…" : available ? "Connect account" : "Coming later"}
              </button>
            </div>
            {linked.map((account) => (
              <div key={account.id} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                <span style={{ flex: 1 }}>
                  {account.account_label || "Linked account"} — {account.connection_status}
                </span>
                {provider.providerKey === "github" && account.connection_status === "connected" ? (
                  <button type="button" disabled={repoLoading !== null || busy !== null}
                    onClick={() => void showGitHubRepositories(account.id)}>
                    {repoLoading === account.id ? "Checking…" : "View installed repositories"}
                  </button>
                ) : null}
                <button type="button" disabled={busy !== null}
                  onClick={() => void disconnect(account.id, provider.providerKey)}>
                  Disconnect
                </button>
              </div>
            ))}
            {provider.providerKey === "github" && githubInstallUrl ? (
              <p style={{ fontSize: 13, marginTop: 10 }}>
                <a href={githubInstallUrl} target="_blank" rel="noopener noreferrer">
                  Install CoOperative GitHub App on selected repositories
                </a>
              </p>
            ) : null}
            {provider.providerKey === "github" ? Object.entries(githubRepos).map(
              ([connectionId, repositories]) => {
                if (!(accounts.github || []).some((account) =>
                  account.id === connectionId && account.connection_status === "connected"
                )) return null;
                return (
                  <div key={connectionId} style={{ padding: "10px 0 0 8px" }}>
                    <p style={{ margin: "0 0 6px" }}>Available GitHub App repositories: {repositories.length}</p>
                    {repositories.length === 0 ? (
                      <p style={{ fontSize: 13 }}>
                        No repositories are installed or visible to this account. Install the
                        CoOperative GitHub App on selected repositories to enable access.
                      </p>
                    ) : repositories.map((repository) => (
                      <p key={repository.fullName} style={{ margin: "6px 0", fontSize: 13 }}>
                        <a href={repository.url} target="_blank" rel="noopener noreferrer">
                          {repository.fullName}
                        </a>
                        {" — "}{repository.canWrite ? "contents write" :
                          repository.canRead ? "contents read" : "metadata only"}
                      </p>
                    ))}
                  </div>
                );
              },
            ) : null}
            {loginLinks[provider.providerKey] ? (
              <p style={{ fontSize: 13 }}>
                Login page did not open?{" "}
                <a href={loginLinks[provider.providerKey]} target="_blank" rel="noopener noreferrer">
                  Open {provider.providerName} authorization
                </a>
              </p>
            ) : null}
            {errors[provider.providerKey] ? (
              <p role="alert" style={{ color: "crimson" }}>{errors[provider.providerKey]}</p>
            ) : null}
          </section>
        );
      })}
      {!initialized && !errors.general ? <p>Checking your connections…</p> : null}
      <p style={{ marginTop: 24, opacity: 0.8, fontSize: 13 }}>
        Authorization is scoped to your account and the permissions you approve.
        Removing a connection stops CoOperative using its saved token. You can also
        revoke the application at the provider.
      </p>
    </main>
  );
}
