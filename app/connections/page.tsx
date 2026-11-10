"use client";

import { useCallback, useEffect, useState } from "react";
import { SERVICE_CONNECTOR_REGISTRY } from "@/lib/runtime/service-connector-registry";

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
  const [initialized, setInitialized] = useState(false);

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
    setAccounts(next);
    setInitialized(true);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => {
      setErrors((current) => ({ ...current, general: String(error) }));
    });
  }, [refresh]);

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
                <button type="button" disabled={busy !== null}
                  onClick={() => void disconnect(account.id, provider.providerKey)}>
                  Disconnect
                </button>
              </div>
            ))}
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
