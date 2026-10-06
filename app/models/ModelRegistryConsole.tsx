"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ScanRun = {
  id?: string;
  scanner_version?: string;
  trigger_source?: string;
  status?: string;
  discovered_count?: number;
  new_count?: number;
  changed_count?: number;
  missing_count?: number;
  started_at?: string;
  completed_at?: string | null;
};

type RegistryRoute = {
  id: string;
  provider: string;
  model: string;
  endpoint: string;
  route_kind: string;
  display_name: string;
  status: string;
  free: boolean;
  recommended: boolean;
  execution_ready: boolean;
  score_summary?: Record<string, Record<string, unknown>>;
  score_version?: string | null;
  score_updated_at?: string | null;
  last_seen_at: string;
  last_changed_at: string;
};

type RegistryResponse = {
  latestRun?: ScanRun | null;
  routes?: RegistryRoute[];
  error?: string;
  detail?: string;
};

type ScanResponse = {
  scanId?: string;
  status?: string;
  discoveredCount?: number;
  newCount?: number;
  changedCount?: number;
  missingCount?: number;
  scoring?: {
    scoreVersion?: string;
    routeCount?: number;
    taskScoreCount?: number;
    calculatedAt?: string;
  };
  error?: string;
  detail?: string;
};

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function numericScore(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function scoreLabel(value: unknown) {
  const score = numericScore(value);
  return score === null ? "—" : score.toFixed(1);
}

export default function ModelRegistryConsole() {
  const [latestRun, setLatestRun] = useState<ScanRun | null>(null);
  const [routes, setRoutes] = useState<RegistryRoute[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/inference/models/scan", {
      cache: "no-store",
    });
    const result = (await response.json()) as RegistryResponse;
    if (!response.ok) {
      throw new Error(
        result.detail || result.error || "Could not load model registry.",
      );
    }
    setLatestRun(result.latestRun || null);
    setRoutes(result.routes || []);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => {
      setError(
        err instanceof Error ? err.message : "Could not load model registry.",
      );
    });
  }, [refresh]);

  const summary = useMemo(() => {
    const providers = new Set(routes.map((route) => route.provider));
    const active = routes.filter((route) => route.status === "active").length;
    const executable = routes.filter((route) => route.execution_ready).length;
    const free = routes.filter((route) => route.free).length;
    return {
      total: routes.length,
      providers: providers.size,
      active,
      executable,
      free,
    };
  }, [routes]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of routes) {
      const key = `${route.provider} · ${route.route_kind}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [routes]);

  const scoredRoutes = useMemo(() => {
    const rows: Array<{
      route: RegistryRoute;
      taskType: string;
      performance: number | null;
      costEfficiency: number | null;
      overallValue: number | null;
      confidence: number | null;
      quality: number | null;
      reliability: number | null;
      speed: number | null;
    }> = [];

    for (const route of routes) {
      for (const [taskType, raw] of Object.entries(route.score_summary || {})) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        rows.push({
          route,
          taskType,
          performance: numericScore(raw.performance),
          costEfficiency: numericScore(raw.costEfficiency),
          overallValue: numericScore(raw.overallValue),
          confidence: numericScore(raw.confidence),
          quality: numericScore(raw.quality),
          reliability: numericScore(raw.reliability),
          speed: numericScore(raw.speed),
        });
      }
    }

    return rows
      .filter((row) => row.overallValue !== null)
      .sort(
        (a, b) =>
          (b.overallValue || 0) - (a.overallValue || 0) ||
          (b.confidence || 0) - (a.confidence || 0),
      );
  }, [routes]);

  async function scanNow() {
    if (scanning) return;
    setScanning(true);
    setError("");
    setLastResult(null);
    try {
      const response = await fetch("/api/inference/models/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const result = (await response.json()) as ScanResponse;
      if (!response.ok) {
        throw new Error(
          result.detail || result.error || "Model capability scan failed.",
        );
      }
      setLastResult(result);
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Model capability scan failed.",
      );
    } finally {
      setScanning(false);
    }
  }

  return (
    <section className="agent-layout">
      <div className="card">
        <div className="agent-submit-row">
          <div>
            <strong>Registry scan</strong>
            <p>
              Runs catalog discovery only. It does not generate media or spend paid
              inference credits.
            </p>
          </div>
          <button
            className="primary"
            type="button"
            onClick={() => void scanNow()}
            disabled={scanning}
          >
            {scanning ? "Scanning…" : "Scan now"}
          </button>
        </div>

        <div className="row">
          <div className="field">
            <span>Routes</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="field">
            <span>Providers</span>
            <strong>{summary.providers}</strong>
          </div>
          <div className="field">
            <span>Executable</span>
            <strong>{summary.executable}</strong>
          </div>
          <div className="field">
            <span>Free</span>
            <strong>{summary.free}</strong>
          </div>
        </div>

        <p>
          <b>Latest scan:</b> {latestRun?.status || "not run"} ·{" "}
          {formatTime(latestRun?.completed_at || latestRun?.started_at)}
        </p>

        {latestRun ? (
          <p>
            Discovered {latestRun.discovered_count || 0} · New{" "}
            {latestRun.new_count || 0} · Changed{" "}
            {latestRun.changed_count || 0} · Missing{" "}
            {latestRun.missing_count || 0}
          </p>
        ) : null}

        {lastResult ? (
          <p>
            Latest manual result: {lastResult.status || "completed"} ·{" "}
            {lastResult.discoveredCount || 0} discovered ·{" "}
            {lastResult.newCount || 0} new ·{" "}
            {lastResult.changedCount || 0} changed
          </p>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <strong>Current route coverage</strong>
        {groups.length ? (
          <ul>
            {groups.map(([label, count]) => (
              <li key={label}>
                {label}: {count}
              </li>
            ))}
          </ul>
        ) : (
          <p>No registry routes yet. Run the first scan.</p>
        )}
      </div>

      <div className="card">
        <strong>Evidence-weighted model value</strong>
        <p>
          Scores are task-specific. Performance combines capability fit with measured
          quality, reliability, and speed. Cost efficiency is normalized against
          comparable routes; confidence keeps sparse evidence close to neutral.
        </p>
        {scoredRoutes.length ? (
          <div>
            {scoredRoutes.slice(0, 25).map((row) => (
              <p key={`${row.route.id}|${row.taskType}`}>
                <b>{row.route.display_name}</b> · {row.taskType} · Value{" "}
                {scoreLabel(row.overallValue)} · Performance{" "}
                {scoreLabel(row.performance)} · Cost{" "}
                {scoreLabel(row.costEfficiency)} · Confidence{" "}
                {row.confidence === null
                  ? "—"
                  : `${Math.round(row.confidence * 100)}%`}
              </p>
            ))}
          </div>
        ) : (
          <p>No task scores yet. Run a registry scan to calculate them.</p>
        )}
      </div>

      <div className="card">
        <strong>Recently changed routes</strong>
        {routes.length ? (
          <div>
            {routes
              .slice()
              .sort(
                (a, b) =>
                  Date.parse(b.last_changed_at) - Date.parse(a.last_changed_at),
              )
              .slice(0, 25)
              .map((route) => (
                <p key={route.id}>
                  <b>{route.display_name}</b> · {route.provider} ·{" "}
                  {route.route_kind} · {route.status}
                </p>
              ))}
          </div>
        ) : (
          <p>No routes have been discovered yet.</p>
        )}
      </div>
    </section>
  );
}
