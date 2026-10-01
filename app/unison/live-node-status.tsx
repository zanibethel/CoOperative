"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveNode = {
  id: string;
  displayName: string;
  contributorUserId?: string | null;
  contributorName?: string | null;
  nodeClass: string;
  status: string;
  reportedState: string;
  workerVersion: string;
  lastSeenAt: string;
  secondsSinceHeartbeat: number | null;
  platform?: {
    system?: string;
    release?: string;
    machine?: string;
  } | null;
  resources?: {
    cpuLogical?: number;
    memoryTotalMb?: number;
    gpus?: Array<{ name?: string; memoryTotalMb?: number | null }>;
  } | null;
};

type StatusPayload = {
  serverTime?: string;
  counts?: {
    total: number;
    online: number;
    idle: number;
    busy: number;
    paused: number;
    offline: number;
  };
  nodes?: LiveNode[];
  error?: string;
};

function heartbeatLabel(seconds: number | null) {
  if (seconds === null) return "No heartbeat";
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function stateLabel(status: string) {
  if (status === "online") return "Online";
  if (status === "idle") return "Idle";
  if (status === "busy") return "Busy";
  if (status === "paused") return "Paused";
  return "Offline";
}

export default function LiveNodeStatus({
  scope,
  title,
}: {
  scope: "mine" | "owner";
  title: string;
}) {
  const [payload, setPayload] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/unison/status?scope=${scope}`, {
        cache: "no-store",
      });
      const next = (await response.json()) as StatusPayload;

      if (!response.ok) {
        throw new Error(next.error || "Could not load live node status.");
      }

      if (!mounted.current) return;
      setPayload(next);
      setUpdatedAt(new Date());
      setError("");
    } catch (err) {
      if (!mounted.current) return;
      setError(
        err instanceof Error ? err.message : "Could not load live node status.",
      );
    } finally {
      if (mounted.current) setRefreshing(false);
    }
  }, [scope]);

  useEffect(() => {
    mounted.current = true;

    const initial = window.setTimeout(() => {
      void load();
    }, 0);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void load();
      }
    }, 5000);

    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      mounted.current = false;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const counts = payload?.counts;
  const nodes = payload?.nodes || [];

  return (
    <section className="card unison-live-status">
      <div className="service-head">
        <div>
          <div className="eyebrow">Live status</div>
          <h2>{title}</h2>
          <p>
            Updates automatically every 5 seconds while this dashboard is open.
          </p>
        </div>
        <div className="unison-live-refresh">
          <span className="status-dot active" />
          <span>
            {refreshing
              ? "Checking…"
              : updatedAt
                ? `Updated ${updatedAt.toLocaleTimeString()}`
                : "Waiting…"}
          </span>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
          >
            Refresh now
          </button>
        </div>
      </div>

      {error ? <p className="unison-live-error">{error}</p> : null}

      {counts ? (
        <div className="unison-live-counts">
          <span><small>Total</small><strong>{counts.total}</strong></span>
          <span><small>Online</small><strong>{counts.online}</strong></span>
          <span><small>Idle</small><strong>{counts.idle}</strong></span>
          <span><small>Busy</small><strong>{counts.busy}</strong></span>
          <span><small>Offline</small><strong>{counts.offline}</strong></span>
        </div>
      ) : null}

      {nodes.length ? (
        <div className="unison-live-list">
          {nodes.map((node) => {
            const gpu = node.resources?.gpus?.[0]?.name;
            return (
              <div className="unison-live-node" key={node.id}>
                <div>
                  <strong>{node.displayName}</strong>
                  <small>
                    {scope === "owner" && node.contributorName
                      ? `${node.contributorName} · `
                      : ""}
                    {gpu || node.platform?.system || "Hardware pending heartbeat"}
                  </small>
                </div>

                <div className="unison-live-node-right">
                  <span className={`agent-status ${node.status === "busy" ? "running" : node.status === "idle" || node.status === "online" ? "completed" : ""}`}>
                    {stateLabel(node.status)}
                  </span>
                  <small>{heartbeatLabel(node.secondsSinceHeartbeat)}</small>
                  <small>
                    {node.workerVersion && node.workerVersion !== "paired"
                      ? `Worker ${node.workerVersion}`
                      : "Worker not checked in yet"}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p>No Unison nodes are enrolled for this view yet.</p>
      )}
    </section>
  );
}
