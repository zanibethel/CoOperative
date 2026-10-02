"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TopUpOption = {
  id: string;
  label: string;
  amountUsd: number;
};

type LedgerEntry = {
  id: string;
  kind: "credit" | "debit" | "adjustment";
  source: string;
  label: string;
  amountUsd: number;
  createdAt: string;
};

type BalanceResponse = {
  availableUsd: number;
  reservedMicrousd: number;
  lifetimeSpentUsd: number;
  funded: boolean;
  topUpOptions: TopUpOption[];
  ledger: LedgerEntry[];
  error?: string;
  detail?: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 6 : 2,
  }).format(value);
}

export default function AiBalanceClient() {
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [busyOption, setBusyOption] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Loading balance…");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/profile/ai-balance", { cache: "no-store" });
    const result = (await response.json()) as BalanceResponse;
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load AI balance.");
    }
    setBalance(result);
    setStatus("Ready");
    return result;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await refresh();
        if (cancelled) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get("funding") === "success") {
          setStatus("Payment received. Confirming balance…");
          for (let attempt = 0; attempt < 5; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            const updated = await refresh();
            if (updated.availableUsd > next.availableUsd) break;
          }
          window.history.replaceState(null, "", window.location.pathname);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load AI balance.");
          setStatus("Unavailable");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const reservedUsd = useMemo(
    () => (balance?.reservedMicrousd || 0) / 1_000_000,
    [balance?.reservedMicrousd],
  );

  async function topUp(optionId: string) {
    if (busyOption) return;
    setBusyOption(optionId);
    setError("");
    setStatus("Opening secure checkout…");

    try {
      const response = await fetch("/api/profile/ai-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topUpOptionId: optionId }),
      });
      const result = await response.json();
      if (!response.ok || !result.checkoutUrl) {
        throw new Error(
          result.detail || result.error || "Could not start balance top-up.",
        );
      }
      window.location.assign(result.checkoutUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start balance top-up.");
      setStatus("Ready");
      setBusyOption("");
    }
  }

  return (
    <section className="ai-balance-layout">
      <div className="card ai-balance-hero">
        <div>
          <div className="eyebrow">Funded AI balance</div>
          <h1>{money(balance?.availableUsd || 0)}</h1>
          <p>
            CoOperative uses this balance only for approved paid-model execution.
            Local, owned, and lower-cost qualified routes stay first.
          </p>
        </div>
        <div className="ai-balance-summary">
          <span>
            <small>Reserved</small>
            <strong>{money(reservedUsd)}</strong>
          </span>
          <span>
            <small>Lifetime paid AI</small>
            <strong>{money(balance?.lifetimeSpentUsd || 0)}</strong>
          </span>
          <span>
            <small>Status</small>
            <strong>{balance?.funded ? "Funded" : "No paid balance"}</strong>
          </span>
        </div>
      </div>

      <div className="card ai-balance-card">
        <div>
          <h2>Add balance</h2>
          <p>
            Add only what you want available for stronger paid models. CoOperative
            cannot overdraw this balance.
          </p>
        </div>
        <div className="ai-balance-topups">
          {(balance?.topUpOptions || []).map((option) => (
            <button
              type="button"
              className="secondary-button"
              key={option.id}
              disabled={Boolean(busyOption)}
              onClick={() => void topUp(option.id)}
            >
              {busyOption === option.id ? "Opening…" : "Add " + money(option.amountUsd)}
            </button>
          ))}
          {balance && balance.topUpOptions.length === 0 ? (
            <span className="muted">Funding options are being configured.</span>
          ) : null}
        </div>
        <small className="ai-balance-status">{status}</small>
        {error ? <div className="error-box">{error}</div> : null}
      </div>

      <div className="card ai-balance-card">
        <div>
          <h2>Balance activity</h2>
          <p>
            Credits and paid-model charges are recorded here. Failed paid requests
            release their reservation instead of consuming balance.
          </p>
        </div>
        <div className="ai-balance-ledger">
          {(balance?.ledger || []).length === 0 ? (
            <p className="muted">No balance activity yet.</p>
          ) : (
            (balance?.ledger || []).map((entry) => (
              <div className="ai-balance-ledger-row" key={entry.id}>
                <div>
                  <strong>{entry.label}</strong>
                  <small>{new Date(entry.createdAt).toLocaleString()}</small>
                </div>
                <strong className={entry.kind === "credit" ? "credit" : "debit"}>
                  {entry.kind === "credit" ? "+" : entry.kind === "debit" ? "−" : ""}
                  {money(entry.amountUsd)}
                </strong>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="ai-balance-links">
        <a className="secondary-button" href="/local-ai">CoOperative AI</a>
        <a className="secondary-button" href="/personal-ai">CoOperativeLocalAI</a>
      </div>
    </section>
  );
}
