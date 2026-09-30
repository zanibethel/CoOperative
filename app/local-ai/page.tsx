import Link from "next/link";
import LocalAiChat from "./LocalAiChat";

export default function LocalAiPage() {
  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative AI</Link>
        <div className="nav-links">
          <Link href="/agents">Agents</Link>
          <div className="badge">Local Intelligence</div>
        </div>
      </nav>

      <section className="compact-hero">
        <div className="eyebrow">Local-first inference</div>
        <h1>Talk to the Mac.</h1>
        <p>
          This is the first local LLM surface for CoOperative AI. Manual Local Fast
          and Local Quality requests stay local and never silently fall through to
          a paid hosted model.
        </p>
      </section>

      <LocalAiChat />
    </main>
  );
}
