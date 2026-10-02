import { redirect } from "next/navigation";

import { getUnisonViewer } from "@/lib/unison/access";
import JoinClient from "./join-client";

export default async function UnisonJoinPage() {
  const viewer = await getUnisonViewer();
  if (!viewer) redirect("/login?next=/unison/join");

  const initialName = viewer.contributor?.display_name || "";

  return (
    <main className="shell">
      <nav className="nav">
        <a href="/unison" className="brand">UNISON</a>
        <div className="badge">Contributor setup</div>
      </nav>

      <section className="hero compact-hero">
        <div className="eyebrow">Join + install</div>
        <h1>Turn this account into a Unison contributor.</h1>
        <p>
          Your account owns its enrolled devices and reporting. Each PC receives its own credential,
          so one node can be revoked later without affecting the rest of the network.
        </p>
      </section>

      <JoinClient
        initialName={initialName}
        alreadyJoined={Boolean(viewer.contributor)}
      />
    </main>
  );
}
