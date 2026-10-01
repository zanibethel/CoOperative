import Link from "next/link";
import LocalAiChat from "../local-ai/LocalAiChat";

export default function ChatPage() {
  return (
    <main className="shell cooperative-chat-shell">
      <nav className="nav cooperative-chat-nav">
        <Link className="brand" href="/">CoOperative</Link>
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
