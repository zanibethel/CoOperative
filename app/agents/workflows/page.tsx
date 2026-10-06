import Link from "next/link";

import WorkflowConsole from "./WorkflowConsole";

export default function AgentWorkflowsPage() {
  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative AI</Link>
        <div className="nav-links">
          <Link href="/agents">Agents</Link>
          <Link href="/models">Models</Link>
          <div className="badge">Parallel Workflows</div>
        </div>
      </nav>

      <section className="compact-hero">
        <div className="eyebrow">Scored multi-agent execution</div>
        <h1>Parallel specialist workflows.</h1>
        <p>
          CoOperative builds a dependency graph, assigns task-specific models from
          the scored registry, runs independent work concurrently, and keeps
          repository mutation serialized and approval-gated.
        </p>
      </section>

      <WorkflowConsole />
    </main>
  );
}
