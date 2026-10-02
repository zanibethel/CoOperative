import Link from "next/link";
import { redirect } from "next/navigation";
import { authenticatedIdentity } from "@/lib/supabase/auth";
import PersonalAiMobile from "./PersonalAiMobile";

export default async function PersonalAiPage() {
  const identity = await authenticatedIdentity();
  if (!identity) redirect("/login?next=/personal-ai");

  return (
    <main className="shell personal-ai-shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative AI</Link>
        <div className="badge">Personal AI</div>
      </nav>
      <PersonalAiMobile />
    </main>
  );
}
