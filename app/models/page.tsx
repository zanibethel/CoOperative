import Link from "next/link";

import ModelRegistryConsole from "./ModelRegistryConsole";

export default function ModelsPage() {
  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative AI</Link>
        <div className="nav-links">
          <Link href="/local-ai">Local AI</Link>
          <Link href="/agents">Agents</Link>
          <div className="badge">Model Registry</div>
        </div>
      </nav>

      <section className="compact-hero">
        <div className="eyebrow">Live capability registry</div>
        <h1>Models, capabilities, pricing, and changes.</h1>
        <p>
          Daily scans discover current routes and preserve append-only evidence so
          CoOperative can learn from provider updates, runtime outcomes, controlled
          tests, pricing changes, and local runtimes without losing history.
        </p>
      </section>

      <ModelRegistryConsole />
    </main>
  );
}
