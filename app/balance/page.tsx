import Link from "next/link";
import { redirect } from "next/navigation";

import { authenticatedIdentity } from "@/lib/supabase/auth";
import AiBalanceClient from "./AiBalanceClient";

export const metadata = {
  title: "AI Balance | CoOperative",
  description: "Fund and review paid AI usage in CoOperative.",
};

export default async function AiBalancePage() {
  const identity = await authenticatedIdentity();
  if (!identity) redirect("/login?next=/balance");

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative</Link>
        <div className="nav-links">
          <Link href="/local-ai">AI</Link>
          <Link href="/personal-ai">Personal AI</Link>
          <div className="badge">Balance</div>
        </div>
      </nav>
      <AiBalanceClient />
    </main>
  );
}
