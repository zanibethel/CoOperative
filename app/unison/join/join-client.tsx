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

  async function copyCommand() {
    if (!pairing) return;
    await navigator.clipboard.writeText(pairing.command);
    setMessage("Install command copied.");
  }

  return (
    <div className="unison-stack">
      <section className="card unison-stack">
        <div>
          <div className="eyebrow">Unison + Personal AI</div>
          <h2>Install Unison and your own Local AI on this computer.</h2>
          <p>
            One setup gives this PC a private <strong>CoOperative Personal Local AI</strong> for
            everyday use — including chat, <strong>image understanding and local image creation</strong>,
            documents, voice, optional web search, local history, and project workspaces — and turns
            the machine into a Unison contributor node when the whole PC is idle. Your PC works for
            you first.
          </p>
        </div>

        <div>
          <div className="eyebrow">Included with setup</div>
          <div className="service-tags">
            <span>Private Personal Local AI</span>
            <span>Automatic model choice</span>
            <span>Image understanding + local image creation</span>
            <span>PDF / Office / code files</span>
            <span>Local voice input + spoken replies</span>
            <span>Optional web search</span>
            <span>Local chat history</span>
            <span>Project workspaces + tasks</span>
            <span>Machine-wide Unison node</span>
            <span>Whole-PC idle protection</span>
          </div>
        </div>

        <p>
          <strong>Personal AI stays local by default.</strong> Personal prompts, responses,
          project data, attached-file context, and local history do not enter the CoOperative
          community job queue. Web search is optional; when enabled, the search request can leave
          the PC while model inference still runs locally.
        </p>
      </section>

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
            placeholder="Your display name"
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
            <div className="eyebrow">Ready to install</div>
            <h2>Install Unison + Personal AI on this PC.</h2>
            <p>
              Your contributor profile is ready. Follow the steps below to install the machine-wide
              node and Personal Local AI. Windows will request one administrator approval.
            </p>
          </div>

          <div className="card">
            <div className="eyebrow">Install steps</div>
            <ol>
              <li>
                Make sure you are signed in to the CoOperative account that should own this
                computer&apos;s Unison contributions.
              </li>
              <li>
                Click <strong>Download latest Setup.exe</strong> below.
              </li>
              <li>
                If Chrome or Windows asks whether to keep the file, confirm it only when the
                download came from this Unison page. The preview installer is not code-signed yet,
                so Windows may show an additional warning.
              </li>
              <li>
                Open <strong>CoOperative-Unison-Setup.exe</strong>.
              </li>
              <li>
                Setup will open your browser. Approve linking this PC to the contributor account
                shown there.
              </li>
              <li>
                Approve the Windows administrator prompt. This installs Unison for the whole PC,
                not just the current Windows profile.
              </li>
              <li>
                Leave Setup open until it says <strong>Connected</strong>. Setup also installs
                <strong> CoOperative Local AI</strong> on the desktop with image understanding and
                local image creation, documents, voice, optional web search, local history, project
                workspaces, and automatic model choice. It is available while the PC is in use. After that, you can switch Windows
                users normally.
              </li>
            </ol>
          </div>

          <div className="cta-row">
            <a
              className="primary"
              href="https://github.com/zanibethel/CoOperative/releases/download/unison-windows-preview/CoOperative-Unison-Setup.exe"
            >
              Install Unison + Personal AI
            </a>
          </div>
          <p>
            After setup, the dashboard should show <strong>Whole-PC idle</strong>. Community
            compute remains idle-only, while <strong>CoOperative Local AI</strong> can be opened
            from the desktop or tray whenever someone is actively using this PC. Personal local
            chat stays on the computer and does not enter the CoOperative job queue.
          </p>
          <details>
            <summary>Advanced / manual setup</summary>
            <div className="unison-stack">
              <p>
                Manual machine-wide setup for troubleshooting or environments where Setup.exe cannot run.
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
                Manual machine-wide setup: open PowerShell, paste the full command below, and press Enter. Windows will request administrator approval.
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
