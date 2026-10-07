import Link from "next/link";
import { redirect } from "next/navigation";

import { mainCooperativeIdentity } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

function usd(microusd: number) {
  return (microusd / 1_000_000).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function StripeBalanceTestPage() {
  const identity = await mainCooperativeIdentity();
  if (!identity) redirect("/personal-ai");

  const admin = createAdminSupabaseClient();
  const profileRef = `stripe-test:${identity.userId}`;

  const [{ data: balance }, { data: intents }] = await Promise.all([
    admin
      .from("ai_profile_balances")
      .select("balance_microusd,reserved_microusd")
      .eq("profile_ref", profileRef)
      .maybeSingle(),
    admin
      .from("ai_balance_funding_intents")
      .select("id,status,amount_microusd,created_at,completed_at")
      .eq("profile_ref", profileRef)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const balanceMicrousd = Number(balance?.balance_microusd || 0);
  const reservedMicrousd = Number(balance?.reserved_microusd || 0);

  return (
    <main className="shell">
      <nav className="nav">
        <Link className="brand" href="/">CoOperative</Link>
        <div className="nav-links">
          <Link href="/balance">Balance</Link>
          <div className="badge">Stripe Test</div>
        </div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Owner-only verification</div>
        <h1>Stripe test balance</h1>
        <p>
          This page uses a separate test profile. Stripe test-card payments here
          cannot create spendable production AI credits.
        </p>
      </section>

      <section className="card">
        <strong>Isolated test balance</strong>
        <p>{usd(Math.max(0, balanceMicrousd - reservedMicrousd))}</p>
        <form action="/api/billing/stripe/test-topup" method="post">
          <button className="primary" type="submit">
            Start $10 Stripe test checkout
          </button>
        </form>
      </section>

      <section className="card">
        <strong>Recent test funding intents</strong>
        {intents?.length ? (
          <div>
            {intents.map((intent) => (
              <p key={intent.id}>
                {usd(Number(intent.amount_microusd || 0))} · {intent.status} ·{" "}
                {new Date(intent.created_at).toLocaleString()}
              </p>
            ))}
          </div>
        ) : (
          <p>No test checkouts yet.</p>
        )}
      </section>
    </main>
  );
}
