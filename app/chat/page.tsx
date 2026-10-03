import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticatedIdentity } from "@/lib/supabase/auth";
import { canAccessMainCooperative } from "@/lib/ai/main-cooperative-access";
import LocalAiChat from "../local-ai/LocalAiChat";

export default async function ChatPage() {
  const identity = await authenticatedIdentity();
  if (!identity) redirect("/login?next=/chat");
  if (!(await canAccessMainCooperative(identity.userId))) redirect("/personal-ai");

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
