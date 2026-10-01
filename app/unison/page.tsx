import Link from "next/link";

import { getUnisonViewer } from "@/lib/unison/access";

export default async function UnisonPage() {
  const viewer = await getUnisonViewer();

  return (
    <main className="shell">
      <nav className="nav">
        <Link href="/" className="brand">UNISON</Link>
        <div className="nav-links">
          <Link href="/">CoOperative</Link>
          <Link href="/unison/dashboard">Contributor dashboard</Link>
          {viewer?.isOwner ? <Link href="/unison/owner">Owner dashboard</Link> : null}
          <div className="badge">People-owned compute</div>
        </div>
      </nav>

      <section className="hero">
        <div className="eyebrow">The data center belongs to the people</div>
        <h1>Put idle computers to work for CoOperative.</h1>
        <p>
          Unison lets people and businesses contribute spare compute capacity to
          CoOperative. Your device stays yours, your limits stay yours, and the
          network only uses eligible capacity when your machine is available.
        </p>
        <div className="cta-row">
          <Link className="cta" href="/unison/join">Join Unison →</Link>
          <Link className="secondary-cta" href="/unison/dashboard">View my contribution</Link>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <strong>Your hardware first</strong>
          <p>Keep useful compute on member- and business-owned machines before renting centralized cloud capacity.</p>
        </div>
        <div className="card">
          <strong>Idle-aware by default</strong>
          <p>Windows nodes wait for inactivity before accepting work and release loaded model memory when the PC becomes active again.</p>
        </div>
        <div className="card">
          <strong>Contribution reporting</strong>
          <p>See enrolled devices, completed jobs, measured compute time, and earnings as compensation rates are enabled.</p>
        </div>
      </section>

      <section className="card unison-info-card">
        <div>
          <div className="eyebrow">Current alpha</div>
          <h2>Windows private/community nodes</h2>
          <p>
            The first workload is CoOperative image generation. A job already in progress is allowed to finish;
            hard resource preemption and public marketplace payouts are later phases.
          </p>
        </div>
        <Link className="secondary-cta" href="/api/unison/download/windows">
          Download Windows bootstrap
        </Link>
      </section>
    </main>
  );
}
