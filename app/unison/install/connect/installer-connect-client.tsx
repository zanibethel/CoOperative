"use client";

import { useEffect, useRef, useState } from "react";

export default function InstallerConnectClient({
  port,
  nonce,
}: {
  port: number;
  nonce: string;
}) {
  const [status, setStatus] = useState("Linking this browser session to the installer…");
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const pairingResponse = await fetch("/api/unison/contributor/pairing-code", {
          method: "POST",
          cache: "no-store",
        });
        const pairing = await pairingResponse.json();
        if (!pairingResponse.ok || !pairing.pairingCode) {
          throw new Error(pairing.error || "Could not create a one-time device credential.");
        }

        setStatus("Authorizing the Windows installer…");

        const localResponse = await fetch(`http://127.0.0.1:${port}/pair/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nonce,
            pairingCode: pairing.pairingCode,
          }),
        });

        if (!localResponse.ok) {
          throw new Error("The local Windows installer did not accept the authorization.");
        }

        setStatus("Authorized. You can return to the installer window.");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not authorize the Windows installer.",
        );
        setStatus("Installer authorization needs attention.");
      }
    })();
  }, [nonce, port]);

  return (
    <section className="hero compact-hero">
      <div className="eyebrow">CoOperative Unison Setup</div>
      <h1>{error ? "Could not finish linking." : "Connecting this PC…"}</h1>
      <p>{status}</p>
      {error ? (
        <div className="card">
          <strong>{error}</strong>
          <p>
            Leave the installer open, refresh this page once, and try again. If the
            installer was closed, reopen it to create a fresh secure link.
          </p>
        </div>
      ) : (
        <div className="card">
          <strong>No pairing code needs to be copied.</strong>
          <p>
            This page is sending a one-time credential directly to the installer
            running on localhost. The credential expires after one use.
          </p>
        </div>
      )}
    </section>
  );
}
