"use client";

import { useEffect, useRef, useState } from "react";

export default function InstallerConnectClient({
  port,
  nonce,
  mode,
  nodeId,
  proof,
}: {
  port: number;
  nonce: string;
  mode: "new" | "existing";
  nodeId?: string;
  proof?: string;
}) {
  const [status, setStatus] = useState(
    mode === "existing"
      ? "Linking this Windows profile to the shared PC…"
      : "Linking this browser session to the installer…",
  );
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        let localPayload: Record<string, unknown>;

        if (mode === "existing") {
          if (!nodeId || !proof) {
            throw new Error("Existing-node authorization is incomplete.");
          }

          const linkResponse = await fetch("/api/unison/nodes/link-user", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nodeId, proof }),
          });
          const linked = await linkResponse.json();

          if (!linkResponse.ok || !linked.profileToken) {
            throw new Error(
              linked.error || "Could not authorize this account on the shared PC.",
            );
          }

          localPayload = {
            nonce,
            nodeId,
            profileToken: linked.profileToken,
            role: linked.role || "member",
          };
          setStatus("Saving this account to the current Windows profile…");
        } else {
          const pairingResponse = await fetch("/api/unison/contributor/pairing-code", {
            method: "POST",
            cache: "no-store",
          });
          const pairing = await pairingResponse.json();

          if (!pairingResponse.ok || !pairing.pairingCode) {
            throw new Error(
              pairing.error || "Could not create a one-time device credential.",
            );
          }

          localPayload = {
            nonce,
            pairingCode: pairing.pairingCode,
          };
          setStatus("Authorizing the Windows installer…");
        }

        const localResponse = await fetch("http://127.0.0.1:" + port + "/pair/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(localPayload),
        });

        if (!localResponse.ok) {
          throw new Error("The local Windows installer did not accept the authorization.");
        }

        setStatus(
          mode === "existing"
            ? "Linked. Your chats stay separate from other users of this PC. You can return to the installer."
            : "Authorized. You can return to the installer window.",
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not authorize the Windows installer.",
        );
        setStatus("Installer authorization needs attention.");
      }
    })();
  }, [mode, nodeId, nonce, port, proof]);

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
          <strong>
            {mode === "existing"
              ? "One PC, separate private profiles."
              : "No pairing code needs to be copied."}
          </strong>
          <p>
            {mode === "existing"
              ? "This authorization adds your CoOperative account to the existing physical node. It does not give you access to another user's chats or hosted history."
              : "This page is sending a one-time credential directly to the installer running on localhost. The credential expires after one use."}
          </p>
        </div>
      )}
    </section>
  );
}
