import { redirect } from "next/navigation";

import { getUnisonViewer } from "@/lib/unison/access";
import InstallerConnectClient from "./installer-connect-client";

export default async function UnisonInstallerConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ port?: string; nonce?: string }>;
}) {
  const params = await searchParams;
  const port = Number(params.port);
  const nonce = typeof params.nonce === "string" ? params.nonce : "";

  if (!Number.isInteger(port) || port < 1024 || port > 65535 || nonce.length < 20) {
    return (
      <main className="shell">
        <section className="card">
          <div className="eyebrow">Unison Setup</div>
          <h1>Installer link is invalid.</h1>
          <p>Close this page and reopen CoOperative Unison Setup on the Windows PC.</p>
        </section>
      </main>
    );
  }

  const viewer = await getUnisonViewer();
  if (!viewer) {
    const next = `/unison/install/connect?port=${port}&nonce=${encodeURIComponent(nonce)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (!viewer.contributor || viewer.contributor.status !== "active") {
    return (
      <main className="shell">
        <section className="card">
          <div className="eyebrow">Unison Setup</div>
          <h1>Join Unison first.</h1>
          <p>This installer can only be linked to an active contributor account.</p>
          <a className="primary" href="/unison/join">Join Unison</a>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <nav className="nav">
        <a href="/unison" className="brand">UNISON</a>
        <div className="badge">Windows setup</div>
      </nav>
      <InstallerConnectClient port={port} nonce={nonce} />
    </main>
  );
}
