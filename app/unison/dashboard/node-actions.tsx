"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function UnisonNodeActions({
  nodeId,
  status,
}: {
  nodeId: string;
  status: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [monitoring, setMonitoring] = useState(false);
  const [isPending, startTransition] = useTransition();
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const online = status !== "offline";

  useEffect(() => {
    if (monitoring && online) {
      setMessage("Node is online.");
      setMonitoring(false);
    }
  }, [monitoring, online]);

  useEffect(() => {
    if (!monitoring) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    intervalRef.current = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 5000);

    timeoutRef.current = window.setTimeout(() => {
      setMonitoring(false);
      setMessage(
        "No fresh heartbeat yet. If the tool showed an error, leave that window open and review it.",
      );
    }, 120000);

    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [monitoring, router]);

  function refreshStatus() {
    setMessage("Refreshing status…");
    startTransition(() => router.refresh());
    window.setTimeout(() => setMessage("Status refreshed."), 700);
  }

  function downloadRecovery(mode: "repair" | "restart") {
    const url =
      `/api/unison/download/recovery/windows?mode=${mode}&nodeId=${encodeURIComponent(nodeId)}`;
    const anchor = document.createElement("a");
    anchor.href = url;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setMessage(
      mode === "repair"
        ? "Open the downloaded Repair-CoOperative-Unison.cmd. Status will refresh automatically."
        : "Open the downloaded Restart-CoOperative-Unison.cmd. Status will refresh automatically.",
    );
    setMonitoring(true);
  }

  return (
    <div className="unison-node-actions">
      <div className="cta-row">
        <button
          className="secondary-button"
          type="button"
          onClick={refreshStatus}
          disabled={isPending}
        >
          {isPending ? "Refreshing…" : "Refresh status"}
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => downloadRecovery("restart")}
        >
          Restart node
        </button>
        <button
          className={online ? "secondary-button" : "primary"}
          type="button"
          onClick={() => downloadRecovery("repair")}
        >
          Repair connection
        </button>
      </div>

      {message ? <p className="unison-node-action-message">{message}</p> : null}
    </div>
  );
}
