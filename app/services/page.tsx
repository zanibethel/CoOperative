"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Provider = {
  provider_key: string;
  name: string;
  category: string;
  connection_method: "oauth" | "api" | "import" | "guided" | "browser" | "manual";
  connection_status: "research" | "available" | "limited" | "unavailable";
  native_replacement_status: "none" | "planned" | "partial" | "available";
};

type Service = {
  id: string;
  provider_key: string | null;
  service_name: string;
  external_account_label: string | null;
  connection_method: string;
  connection_status: string;
  monthly_cost_cents: number;
  billing_frequency: string;
  features_used: string[];
  replacement_goal: "keep" | "optimize" | "mirror" | "replace" | "unsure";
  native_coverage_percent: number;
  replacement_readiness_percent: number;
  estimated_monthly_savings_cents: number;
  notes: string | null;
};

const initial = {
  providerKey: "",
  serviceName: "",
  externalAccountLabel: "",
  connectionMethod: "manual",
  monthlyCost: 0,
  billingFrequency: "monthly",
  featuresUsed: "",
  replacementGoal: "unsure",
  notes: "",
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function ServicesPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function fetchServices() {
    const response = await fetch("/api/services", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to load services");
    return payload;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchServices();
      setProviders(payload.providers ?? []);
      setServices(payload.services ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load services");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void fetchServices()
      .then((payload) => {
        if (cancelled) return;
        setProviders(payload.providers ?? []);
        setServices(payload.services ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load services");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const monthlySpend = useMemo(
    () => services.reduce((sum, item) => {
      if (item.billing_frequency === "annual") return sum + Math.round(item.monthly_cost_cents / 12);
      if (item.billing_frequency === "free") return sum;
      return sum + item.monthly_cost_cents;
    }, 0),
    [services],
  );

  const potentialSavings = services.reduce(
    (sum, item) => sum + item.estimated_monthly_savings_cents,
    0,
  );

  function chooseProvider(value: string) {
    if (!value) {
      setForm((current) => ({ ...current, providerKey: "", serviceName: "", connectionMethod: "manual" }));
      return;
    }

    const provider = providers.find((item) => item.provider_key === value);
    setForm((current) => ({
      ...current,
      providerKey: value,
      serviceName: provider?.name ?? current.serviceName,
      connectionMethod: provider?.connection_method ?? "manual",
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerKey: form.providerKey || null,
          serviceName: form.serviceName,
          externalAccountLabel: form.externalAccountLabel,
          connectionMethod: form.connectionMethod,
          monthlyCost: Number(form.monthlyCost),
          billingFrequency: form.billingFrequency,
          featuresUsed: form.featuresUsed
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          replacementGoal: form.replacementGoal,
          notes: form.notes,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save service");
      setForm(initial);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save service");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError("");
    const response = await fetch(`/api/services?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Unable to remove service");
      return;
    }
    await load();
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="nav-links">
          <Link href="/intake">Mission Briefing</Link>
          <div className="badge">Connected Services · v0.1</div>
        </div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Business System Map</div>
        <h1>Show CoOperative what you already pay for.</h1>
        <p>
          Add the services that currently run the business. As connectors become
          available, CoOperative will sync usage and compare what you actually use
          against cheaper integrations and native replacements.
        </p>
      </section>

      <section className="metrics">
        <div className="metric"><span>Tracked services</span><strong>{services.length}</strong></div>
        <div className="metric"><span>Known monthly spend</span><strong>{money(monthlySpend)}</strong></div>
        <div className="metric"><span>Potential savings found</span><strong>{money(potentialSavings)}</strong></div>
      </section>

      <section className="services-layout">
        <form className="card form" onSubmit={submit}>
          <div className="eyebrow">Add current service</div>
          <div className="field">
            <label>Known provider</label>
            <select value={form.providerKey} onChange={(e) => chooseProvider(e.target.value)}>
              <option value="">Other / custom service</option>
              {providers.map((provider) => (
                <option key={provider.provider_key} value={provider.provider_key}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Service name</label>
            <input required value={form.serviceName} onChange={(e) => setForm((current) => ({ ...current, serviceName: e.target.value }))} />
          </div>
          <div className="field">
            <label>Account / location label</label>
            <input placeholder="Main location, salon account…" value={form.externalAccountLabel} onChange={(e) => setForm((current) => ({ ...current, externalAccountLabel: e.target.value }))} />
          </div>
          <div className="row">
            <div className="field">
              <label>What do you pay?</label>
              <input type="number" min="0" step="0.01" value={form.monthlyCost} onChange={(e) => setForm((current) => ({ ...current, monthlyCost: Number(e.target.value) }))} />
            </div>
            <div className="field">
              <label>Billing</label>
              <select value={form.billingFrequency} onChange={(e) => setForm((current) => ({ ...current, billingFrequency: e.target.value }))}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="usage">Usage based</option>
                <option value="free">Free</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>What do you actually use it for?</label>
            <textarea placeholder="Booking, reminders, deposits, customer list…" value={form.featuresUsed} onChange={(e) => setForm((current) => ({ ...current, featuresUsed: e.target.value }))} />
            <small>Separate features with commas.</small>
          </div>
          <div className="field">
            <label>Goal</label>
            <select value={form.replacementGoal} onChange={(e) => setForm((current) => ({ ...current, replacementGoal: e.target.value }))}>
              <option value="unsure">Let CoOperative evaluate it</option>
              <option value="keep">Keep it</option>
              <option value="optimize">Use it better</option>
              <option value="mirror">Mirror it before replacing</option>
              <option value="replace">Replace if we can lower cost</option>
            </select>
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} />
          </div>
          <button className="primary" disabled={saving}>{saving ? "Saving…" : "Add to business map"}</button>
          {error ? <div className="error">{error}</div> : null}
        </form>

        <div className="service-stack">
          <div>
            <div className="eyebrow">Current stack</div>
            <h2>What CoOperative knows so far</h2>
          </div>

          {loading ? <div className="card"><p>Loading services…</p></div> : null}

          {!loading && services.length === 0 ? (
            <div className="card">
              <strong>No services mapped yet.</strong>
              <p>Start with the software that costs the most or touches the most customers.</p>
            </div>
          ) : null}

          {services.map((service) => {
            const provider = providers.find((item) => item.provider_key === service.provider_key);
            const connectorAvailable = provider?.connection_status === "available";
            return (
              <div className="card service-card" key={service.id}>
                <div className="service-head">
                  <div>
                    <strong>{service.service_name}</strong>
                    <p>{service.external_account_label || "Business service"}</p>
                  </div>
                  <strong>{service.billing_frequency === "annual" ? `${money(service.monthly_cost_cents)}/yr` : `${money(service.monthly_cost_cents)}/mo`}</strong>
                </div>
                <div className="service-tags">
                  <span>{service.replacement_goal}</span>
                  <span>{provider?.native_replacement_status ?? "custom"} native coverage</span>
                  <span>{service.connection_status}</span>
                </div>
                {service.features_used.length ? (
                  <p><b>Used for:</b> {service.features_used.join(", ")}</p>
                ) : null}
                <p>
                  {connectorAvailable
                    ? "This provider has an approved connector and can move to account authorization."
                    : "Tracked now. Direct connection will appear here after the provider connector passes review."}
                </p>
                <button className="text-button" type="button" onClick={() => void remove(service.id)}>Remove</button>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
