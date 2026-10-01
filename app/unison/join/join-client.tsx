"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

type Pairing = {
  pairingCode: string;
  expiresAt: string;
  bootstrapUrl: string;
  command: string;
};

export default function JoinClient({
  initialName,
  alreadyJoined,
}: {
  initialName: string;
  alreadyJoined: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialName);
  const [joined, setJoined] = useState(alreadyJoined);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  const expiresLabel = useMemo(() => {
    if (!pairing) return "";
    return new Date(pairing.expiresAt).toLocaleString();
  }, [pairing]);

  async function join(event: FormEvent) {
    event.preventDefault();
    setWorking(true);
    setMessage("");

    try {
      const response = await fetch("/api/unison/contributor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not join Unison.");
      setJoined(true);
      setMessage("Contributor profile created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join Unison.");
    } finally {
      setWorking(false);
    }
  }

  async function requestPairing() {
    const response = await fetch("/api/unison/contributor/pairing-code", {
      method: "POST",
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not create pairing code.");
    return payload as Pairing;
  }

  async function createPairingCode() {
    setWorking(true);
    setMessage("");

    try {
      const payload = await requestPairing();
      setPairing(payload);
      setMessage("Pairing code created. It expires in one hour and can only be used once.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create pairing code.");
    } finally {
      setWorking(false);
    }
  }

  function downloadPersonalInstaller(nextPairing: Pairing) {
    const bootstrapUrl = `${window.location.origin}/api/unison/download/windows`;
    const installer = [
      "@echo off",
      "setlocal",
      "title CoOperative Unison Setup",
      "echo.",
      "echo Setting up CoOperative Unison...",
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $b=Join-Path $env:TEMP 'cooperative-unison-bootstrap.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${bootstrapUrl}' -OutFile $b; & $b -PairCode '${nextPairing.pairingCode}' -NodeName $env:COMPUTERNAME -IdleMinutes 5"`,
      "if errorlevel 1 (",
      "  echo.",
      "  echo Setup did not finish. Leave this window open so the error can be reviewed.",
      "  pause",
      "  exit /b 1",
      ")",
      "echo.",
      "echo CoOperative Unison is installed and running.",
      "echo You can close this window and return to the browser.",
      "timeout /t 3 /nobreak >nul",
      "exit /b 0",
      "",
    ].join("\r\n");

    const blob = new Blob([installer], {
      type: "application/x-msdos-program",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Install-CoOperative-Unison.cmd";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function installThisPc() {
    setWorking(true);
    setMessage("");

    try {
      const payload = await requestPairing();
      setPairing(payload);
      downloadPersonalInstaller(payload);
      setMessage(
        "Installer downloaded. Open Install-CoOperative-Unison.cmd to finish setup. It will pair this PC automatically.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare installer.");
    } finally {
      setWorking(false);
    }
  }

  async function copyCommand() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.command);
    setMessage("Install command copied.");
  }

  return (
    <div className="unison-stack">
      <form className="card form" onSubmit={join}>
        <div className="eyebrow">Contributor profile</div>
        <h2>{joined ? "You’re part of Unison." : "Join the compute network."}</h2>
        <div className="field">
          <label>Display name</label>
          <input
            required
            maxLength={160}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Zach"
          />
          <small>This is how your contribution appears in your own dashboard and the platform owner report.</small>
        </div>
        <button className="primary" disabled={working}>
          {working ? "Working…" : joined ? "Update contributor profile" : "Join Unison"}
        </button>
      </form>

      {joined ? (
        <section className="card unison-stack">
          <div>
            <div className="eyebrow">Add this Windows PC</div>
            <h2>Install Unison on this computer.</h2>
            <p>
              CoOperative will create a one-time device credential and prepare a personalized installer.
              No pairing code or PowerShell command needs to be copied manually.
            </p>
          </div>

          <div className="cta-row">
            <a
              className="primary"
              href="/api/unison/download/installer/windows"
            >
              Try polished Setup.exe preview
            </a>
            <button className="secondary-button" type="button" onClick={installThisPc} disabled={working}>
              {working ? "Preparing fallback…" : "Use current installer fallback"}
            </button>
          </div>
          <p>
            The Setup.exe preview opens your browser for secure account approval, installs
            the proven worker silently, and waits for a verified heartbeat before showing
            Connected. The current CMD flow remains available while the preview is tested.
          </p>

          <details>
            <summary>Advanced / manual setup</summary>
            <div className="unison-stack">
              <p>
                Use this only if the one-click installer cannot run on this computer.
              </p>
              <div className="cta-row">
                <button className="secondary-button" type="button" onClick={createPairingCode} disabled={working}>
                  Create pairing code
                </button>
                <a className="secondary-cta" href="/api/unison/download/windows">
                  Download raw PowerShell script
                </a>
              </div>
            </div>
          </details>

          {pairing ? (
            <div className="unison-command">
              <div className="service-head">
                <div>
                  <strong>{pairing.pairingCode}</strong>
                  <p>Expires {expiresLabel}</p>
                </div>
                <button className="secondary-button" type="button" onClick={copyCommand}>
                  Copy install command
                </button>
              </div>
              <p>
                Manual fallback: open PowerShell, paste the full command below, and press Enter.
              </p>
              <pre className="agent-output">{pairing.command}</pre>
            </div>
          ) : null}
        </section>
      ) : null}

      {message ? <div className="card">{message}</div> : null}

      <div className="cta-row">
        <Link className="secondary-cta" href="/unison/dashboard">Open contributor dashboard</Link>
        <Link className="secondary-cta" href="/unison">Back to Unison</Link>
      </div>
    </div>
  );
}
