import Link from "next/link";
import LocalAiChat from "./LocalAiChat";

export default function LocalAiPage() {
  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative AI</Link>
        <div className="nav-links">
          <Link href="/services">Services</Link>
          <Link href="/agents">Agents</Link>
          <div className="badge">Chat</div>
        </div>
      </nav>

      <LocalAiChat />
    </main>
  );
}
