"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type { AssessmentResult } from "@/lib/domain/schemas";

const initial = {
  businessName: "",
  industry: "",
  teamSize: 1,
  customerDescription: "",
  leadSources: "",
  dailyWork: "",
  repetitiveWork: "",
  tools: "",
  bottlenecks: "",
  humanApprovalAreas: "",
  websiteAndInquiryFlow: "",
  marketingAndSocial: "",
  bookingAndScheduling: "",
  costPriority: "balanced" as const,
};

export default function IntakePage() {
  const [form, setForm] = useState(initial);
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Assessment failed");
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assessment failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/" className="brand">CO/OPERATIVE</Link>
        <div className="badge">Mission Briefing · v0.1</div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Gather Intel</div>
        <h1>Teach CoOperative how the business actually works.</h1>
        <p>We start broad. Later, the AI interviewer will ask targeted follow-ups and compare your answers with approved capabilities, connected systems, and proven playbooks.</p>
      </section>

      <form className="form" onSubmit={submit}>
        <div className="row">
          <div className="field"><label>Business name</label><input required value={form.businessName} onChange={(e) => update("businessName", e.target.value)} /></div>
          <div className="field"><label>Industry</label><input required placeholder="Salon, HVAC, nonprofit, SaaS…" value={form.industry} onChange={(e) => update("industry", e.target.value)} /></div>
        </div>
        <div className="field"><label>Team size</label><input required type="number" min={1} value={form.teamSize} onChange={(e) => update("teamSize", Number(e.target.value))} /></div>
        <div className="field"><label>Who are your customers?</label><textarea required value={form.customerDescription} onChange={(e) => update("customerDescription", e.target.value)} /><small>Who pays you, and what are they trying to get done?</small></div>
        <div className="field"><label>Where do new leads or requests come from?</label><textarea required value={form.leadSources} onChange={(e) => update("leadSources", e.target.value)} /><small>Website, phone, Facebook, walk-ins, referrals, email, marketplace, etc.</small></div>
        <div className="field"><label>Describe a normal day.</label><textarea required value={form.dailyWork} onChange={(e) => update("dailyWork", e.target.value)} /></div>
        <div className="field"><label>What work gets repeated over and over?</label><textarea required value={form.repetitiveWork} onChange={(e) => update("repetitiveWork", e.target.value)} /></div>
        <div className="field"><label>What software/tools do you use?</label><textarea required placeholder="Gmail, Square, QuickBooks, Google Calendar…" value={form.tools} onChange={(e) => update("tools", e.target.value)} /></div>
        <div className="field"><label>How does your website and customer inquiry flow work today?</label><textarea placeholder="No website, simple brochure site, contact form, DMs, online store…" value={form.websiteAndInquiryFlow} onChange={(e) => update("websiteAndInquiryFlow", e.target.value)} /></div>
        <div className="field"><label>How do you currently handle social media and marketing?</label><textarea placeholder="Who creates/posts content? Which channels? How often?" value={form.marketingAndSocial} onChange={(e) => update("marketingAndSocial", e.target.value)} /></div>
        <div className="field"><label>How do booking and scheduling work?</label><textarea placeholder="Phone calls, paid booking app, Google Calendar, walk-ins…" value={form.bookingAndScheduling} onChange={(e) => update("bookingAndScheduling", e.target.value)} /></div>
        <div className="field"><label>What regularly slows the business down?</label><textarea required value={form.bottlenecks} onChange={(e) => update("bottlenecks", e.target.value)} /></div>
        <div className="field"><label>What must a human always approve or decide?</label><textarea value={form.humanApprovalAreas} onChange={(e) => update("humanApprovalAreas", e.target.value)} /></div>
        <div className="field"><label>Cost priority</label><select value={form.costPriority} onChange={(e) => update("costPriority", e.target.value as typeof form.costPriority)}><option value="lowest-cost">Lowest ongoing cost</option><option value="balanced">Balance cost and convenience</option><option value="best-fit">Best fit even if it costs more</option></select></div>
        <button className="primary" disabled={loading}>{loading ? "Analyzing…" : "Generate intel report"}</button>
        {error ? <div className="error">{error}</div> : null}
      </form>

      {result ? (
        <section className="results">
          <div className="card"><div className="eyebrow">Intel report</div><h2>Assessment summary</h2><p>{result.businessSummary}</p></div>
          <div>
            <div className="eyebrow">Process map</div>
            {result.processes.map((process) => (
              <div className="card process" key={process.name} style={{ marginTop: 12 }}>
                <div><strong>{process.name}</strong><p>{process.purpose}</p></div>
                <div className="steps">
                  {process.steps.map((step, index) => (
                    <div className="step" key={`${process.name}-${step.name}`}>
                      <span>Step {index + 1} · {step.actor}</span>
                      <strong style={{ marginTop: 6 }}>{step.name}</strong>
                      <span>{step.manual ? "Manual today" : "Already event/system driven"}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="eyebrow">Proposed missions</div>
            {result.opportunities.map((item) => (
              <div className="card opportunity" key={item.title} style={{ marginTop: 12 }}>
                <div>
                  <strong>{item.title}</strong>
                  <p><b>Current:</b> {item.currentProblem}</p>
                  <p><b>Proposed:</b> {item.proposedAutomation}</p>
                  <p><b>Human role:</b> {item.humanRole}</p>
                  <p>{item.estimatedHoursSavedPerMonth} hrs/mo estimated · {item.implementationEffort} effort · {item.riskLevel} risk · {Math.round(item.confidence * 100)}% confidence</p>
                </div>
                <div className="score"><span>Priority</span><br/><strong>{item.priorityScore}</strong></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
