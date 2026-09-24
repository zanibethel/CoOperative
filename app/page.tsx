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
          CoOperative learns how your business works, maps the services you
          already pay for, finds the work that should be easier, and designs
          lower-cost missions without giving up human control.
        </p>
        <div className="cta-row">
          <Link className="cta" href="/console">Open Owner Console →</Link>\n          <Link className="secondary-cta" href="/intake">Begin mission briefing →</Link>
          <Link className="secondary-cta" href="/services">Map current services →</Link>
        </div>
      </section>

      <section className="grid">
        <div className="card"><strong>1. Gather Intel</strong><p>Capture how leads, customers, staff, money, marketing, and support actually move through the business.</p></div>
        <div className="card"><strong>2. Map the Stack</strong><p>Track the tools the business uses, what they cost, what features matter, and what could eventually be optimized or replaced.</p></div>
        <div className="card"><strong>3. Plan Missions</strong><p>Compare approved capabilities and proven playbooks to design the simplest reliable workflow at the lowest sensible cost.</p></div>
      </section>
    </main>
  );
}
