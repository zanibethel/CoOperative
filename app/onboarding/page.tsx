"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function checkWorkspace() {
      try {
        const response = await fetch("/api/organizations");
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = await response.json();
        if (response.ok && payload.organizations?.length) {
          router.replace("/intake");
          return;
        }
        if (!response.ok) setError(payload.error ?? "Unable to check your workspace.");
      } catch {
        setError("Unable to check your workspace.");
      } finally {
        setLoading(false);
      }
    }

    void checkWorkspace();
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to create workspace.");
      router.push("/intake");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create workspace.");
      setSaving(false);
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="badge">Workspace Setup</div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Establish Headquarters</div>
        <h1>Create your first business workspace.</h1>
        <p>The workspace is the tenant boundary. Businesses, assessments, future integrations, playbooks, and mission history will live inside it.</p>
      </section>

      {loading ? <div className="card">Checking your workspace…</div> : (
        <form className="form" onSubmit={submit}>
          <div className="field">
            <label>Workspace name</label>
            <input required maxLength={120} placeholder="Acme Services" value={name} onChange={(event) => setName(event.target.value)} />
            <small>Usually the company or parent organization name. This can be changed later.</small>
          </div>
          <button className="primary" disabled={saving}>{saving ? "Creating…" : "Create workspace"}</button>
          {error ? <div className="error">{error}</div> : null}
        </form>
      )}
    </main>
  );
}
