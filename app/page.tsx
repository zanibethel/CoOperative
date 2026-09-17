import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand">CO/OPERATIVE</div>
        <div className="badge">v0.1 · Intelligence Desk</div>
      </nav>

      <section className="hero">
        <div className="eyebrow">Human + AI business operations</div>
        <h1>Your business. Your team. Your AI operatives.</h1>
        <p>
          CoOperative learns how your business works, finds the work that should
          be easier, and designs cost-conscious missions that combine people,
          software, automation, and AI without giving up human control.
        </p>
        <Link className="cta" href="/intake">Begin mission briefing →</Link>
      </section>

      <section className="grid">
        <div className="card"><strong>1. Gather Intel</strong><p>Capture how leads, customers, staff, money, marketing, and support actually move through the business.</p></div>
        <div className="card"><strong>2. Plan Missions</strong><p>Compare available capabilities and design the simplest cost-effective workflow that solves the problem.</p></div>
        <div className="card"><strong>3. Learn & Improve</strong><p>Measure outcomes, promote successful patterns into reusable playbooks, and propose improvements for review.</p></div>
      </section>
    </main>
  );
}
