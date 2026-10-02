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
        <a className="brand" href="/">CoOperative</a>
        <div className="nav-links">
          <a href="/local-ai">AI</a>
          <a href="/personal-ai">Personal AI</a>
          <div className="badge">Balance</div>
        </div>
      </nav>
      <AiBalanceClient />
    </main>
  );
}
