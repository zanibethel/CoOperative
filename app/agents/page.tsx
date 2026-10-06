import Link from "next/link";
import AgentConsole from "./AgentConsole";

export default function AgentsPage() {
  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative AI</Link>
        <div className="nav-links">
          <Link href="/local-ai">Local AI</Link>
          <Link href="/models">Models</Link>
          <div className="badge">Agent Runtime</div>
        </div>
      </nav>

      <section className="compact-hero">
        <div className="eyebrow">Bounded local agents</div>
        <h1>Give CoOperative a job.</h1>
        <p>
          Agents inspect approved repos with deterministic tools first, use the local
          models only when reasoning is needed, and prepare changes in isolated local
          worktrees. Pushes, deployments, secrets, destructive changes, and risky
          migrations remain outside automatic authority.
        </p>
      </section>

      <AgentConsole />
    </main>
  );
}
