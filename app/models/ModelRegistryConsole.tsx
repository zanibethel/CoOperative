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

type SmokeTest = {
  outcome?: string;
  tested_at?: string;
  notes?: string | null;
};

type SmokeRoute = {
  provider: "nous" | "openrouter";
  model: string;
  endpoint: string;
  kind: "image" | "video";
  label: string;
  estimatedProviderCostUsd: number;
  capUsd: number;
  pricingSource: string;
  request: {
    kind: "image" | "video";
    aspectRatio: string | null;
    durationSeconds: number | null;
    resolution: string | null;
    audio: boolean | null;
  };
  policy: {
    adultNonExplicit: string;
    adultNonExplicitSource: string | null;
    adultExplicit: string;
    adultExplicitSource: string | null;
    adultExplicitCheckedAt: string | null;
  };
  latestSfwTest: SmokeTest | null;
  latestAdultNonExplicitTest: SmokeTest | null;
  adultNonExplicitTestEligible: boolean;
  explicitGenerationTested: false;
  explicitClassificationSource: string;
};

type SmokeMatrixResponse = {
  matrix?: {
    routeCount: number;
    sfwCoveredCount: number;
    adultNonExplicitCoveredCount: number;
    explicitPolicyBlockedCount: number;
    explicitGenerationTestsDisabled: boolean;
    note: string;
  };
  preference?: {
    mediaContentPreference: string;
    adultContentAcknowledgedAt: string | null;
  };
  routes?: SmokeRoute[];
  activeJob?: {
    jobId: string;
    kind: "image" | "video";
    provider: string;
    model: string;
    status: string;
    promptClassification?: string | null;
    estimatedProviderCostUsd: number | null;
  } | null;
  error?: string;
  detail?: string;
};

type SmokeJobResponse = {
  jobId?: string;
  status?: string;
  kind?: "image" | "video";
  scope?: "sfw_baseline" | "adult_non_explicit_boundary";
  provider?: string;
  model?: string;
  estimatedProviderCostUsd?: number;
  capUsd?: number;
  error?: string;
  detail?: string;
  result?: {
    outcome?: string;
    notes?: string | null;
  } | null;
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

function smokeOutcome(test: SmokeTest | null) {
  if (!test?.outcome) return "untested";
  return test.outcome;
}

function money(value: number) {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

export default function ModelRegistryConsole() {
  const [latestRun, setLatestRun] = useState<ScanRun | null>(null);
  const [routes, setRoutes] = useState<RegistryRoute[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);

  const [smoke, setSmoke] = useState<SmokeMatrixResponse | null>(null);
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeError, setSmokeError] = useState("");
  const [smokeCapUsd, setSmokeCapUsd] = useState("0");
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [activeSmokeJobId, setActiveSmokeJobId] = useState<string | null>(null);
  const [lastSmokeResult, setLastSmokeResult] =
    useState<SmokeJobResponse | null>(null);

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

  const refreshSmoke = useCallback(async () => {
    setSmokeLoading(true);
    try {
      const response = await fetch(
        "/api/inference/media/capabilities/test",
        { cache: "no-store" },
      );
      const result = (await response.json()) as SmokeMatrixResponse;
      if (!response.ok) {
        throw new Error(
          result.detail ||
            result.error ||
            "Could not load refusal smoke matrix.",
        );
      }
      setSmoke(result);
      if (result.activeJob?.jobId) {
        setActiveSmokeJobId(result.activeJob.jobId);
      }
      setSmokeError("");
    } finally {
      setSmokeLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch((err) => {
      setError(
        err instanceof Error ? err.message : "Could not load model registry.",
      );
    });
  }, [refresh]);

  useEffect(() => {
    void refreshSmoke().catch((err) => {
      setSmokeError(
        err instanceof Error
          ? err.message
          : "Could not load refusal smoke matrix.",
      );
    });
  }, [refreshSmoke]);

  useEffect(() => {
    const jobId = activeSmokeJobId || smoke?.activeJob?.jobId || null;
    if (!jobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/inference/media/capabilities/test?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as SmokeJobResponse;
        if (!response.ok) {
          throw new Error(
            result.detail ||
              result.error ||
              "Could not poll capability test.",
          );
        }
        if (cancelled) return;

        setLastSmokeResult(result);
        if (result.status === "queued" || result.status === "running") {
          timer = setTimeout(poll, 2500);
          return;
        }

        setActiveSmokeJobId(null);
        setSmokeRunning(false);
        await refreshSmoke();
      } catch (err) {
        if (cancelled) return;
        setSmokeError(
          err instanceof Error
            ? err.message
            : "Could not poll capability test.",
        );
        setSmokeRunning(false);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeSmokeJobId, smoke?.activeJob?.jobId, refreshSmoke]);

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

  const smokeCap = Number(smokeCapUsd);
  const nextPendingSmoke = useMemo(() => {
    if (!smoke?.routes || !Number.isFinite(smokeCap) || smokeCap < 0) {
      return null;
    }

    const sfw = smoke.routes.find(
      (route) => !route.latestSfwTest && route.capUsd <= smokeCap + 0.000001,
    );
    if (sfw) {
      return {
        route: sfw,
        scope: "sfw_baseline" as const,
      };
    }

    const adult = smoke.routes.find(
      (route) =>
        route.adultNonExplicitTestEligible &&
        !route.latestAdultNonExplicitTest &&
        route.capUsd <= smokeCap + 0.000001,
    );
    if (adult) {
      return {
        route: adult,
        scope: "adult_non_explicit_boundary" as const,
      };
    }

    return null;
  }, [smoke?.routes, smokeCap]);

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
      await Promise.all([refresh(), refreshSmoke()]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Model capability scan failed.",
      );
    } finally {
      setScanning(false);
    }
  }

  async function refreshPolicyEvidence() {
    setSmokeError("");
    setSmokeLoading(true);
    try {
      const response = await fetch(
        "/api/inference/media/capabilities/refresh",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const result = (await response.json()) as {
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(
          result.detail ||
            result.error ||
            "Could not refresh provider policy evidence.",
        );
      }
      await refreshSmoke();
    } catch (err) {
      setSmokeError(
        err instanceof Error
          ? err.message
          : "Could not refresh provider policy evidence.",
      );
    } finally {
      setSmokeLoading(false);
    }
  }

  async function runSmoke(
    route: SmokeRoute,
    scope: "sfw_baseline" | "adult_non_explicit_boundary",
  ) {
    if (smokeRunning || activeSmokeJobId || smoke?.activeJob) return;
    const cap = Number(smokeCapUsd);
    if (!Number.isFinite(cap) || cap < route.capUsd) {
      setSmokeError(
        `Set the per-test cap to at least ${money(route.capUsd)} before starting this exact route.`,
      );
      return;
    }

    setSmokeRunning(true);
    setSmokeError("");
    setLastSmokeResult(null);

    try {
      const response = await fetch(
        "/api/inference/media/capabilities/test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: route.provider,
            model: route.model,
            kind: route.kind,
            scope,
            maxSpendUsd: cap,
            confirm: true,
          }),
        },
      );
      const result = (await response.json()) as SmokeJobResponse;
      if (!response.ok) {
        throw new Error(
          result.detail ||
            result.error ||
            "Could not start the controlled capability test.",
        );
      }

      setLastSmokeResult(result);
      if (
        result.jobId &&
        (result.status === "queued" || result.status === "running")
      ) {
        setActiveSmokeJobId(result.jobId);
      } else {
        setSmokeRunning(false);
        await refreshSmoke();
      }
    } catch (err) {
      setSmokeRunning(false);
      setSmokeError(
        err instanceof Error
          ? err.message
          : "Could not start the controlled capability test.",
      );
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
        <div className="agent-submit-row">
          <div>
            <strong>Refusal smoke matrix</strong>
            <p>
              One exact route at a time. SFW and non-explicit adult boundary tests
              never retry or fall back. Explicit sexual generation is not used as a
              smoke test; explicit scope is classified from current policy evidence.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshPolicyEvidence()}
            disabled={smokeLoading || smokeRunning}
          >
            {smokeLoading ? "Refreshing…" : "Refresh policy"}
          </button>
        </div>

        <div className="row">
          <div className="field">
            <span>Testable routes</span>
            <strong>{smoke?.matrix?.routeCount ?? "—"}</strong>
          </div>
          <div className="field">
            <span>SFW covered</span>
            <strong>{smoke?.matrix?.sfwCoveredCount ?? "—"}</strong>
          </div>
          <div className="field">
            <span>Non-explicit covered</span>
            <strong>{smoke?.matrix?.adultNonExplicitCoveredCount ?? "—"}</strong>
          </div>
          <div className="field">
            <span>Explicit policy-blocked</span>
            <strong>{smoke?.matrix?.explicitPolicyBlockedCount ?? "—"}</strong>
          </div>
        </div>

        <label className="field">
          <span>Maximum provider spend for one smoke test</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.01"
            value={smokeCapUsd}
            onChange={(event) => setSmokeCapUsd(event.target.value)}
          />
        </label>

        <div className="agent-submit-row">
          <div>
            {nextPendingSmoke ? (
              <p>
                Next within cap: <b>{nextPendingSmoke.route.label}</b> ·{" "}
                {nextPendingSmoke.route.provider} · {nextPendingSmoke.route.kind} ·{" "}
                {nextPendingSmoke.scope === "sfw_baseline"
                  ? "SFW baseline"
                  : "non-explicit boundary"}{" "}
                · estimated {money(nextPendingSmoke.route.estimatedProviderCostUsd)}
              </p>
            ) : (
              <p>
                No untested eligible route currently fits this per-test cap, or the
                matrix is fully covered for the enabled scopes.
              </p>
            )}
          </div>
          <button
            className="primary"
            type="button"
            disabled={
              !nextPendingSmoke ||
              smokeRunning ||
              Boolean(activeSmokeJobId) ||
              Boolean(smoke?.activeJob)
            }
            onClick={() => {
              if (!nextPendingSmoke) return;
              void runSmoke(nextPendingSmoke.route, nextPendingSmoke.scope);
            }}
          >
            {smokeRunning || activeSmokeJobId || smoke?.activeJob
              ? "Test running…"
              : "Run next pending"}
          </button>
        </div>

        {smoke?.activeJob ? (
          <p>
            Active: <b>{smoke.activeJob.model}</b> · {smoke.activeJob.kind} ·{" "}
            {smoke.activeJob.promptClassification || "smoke test"} ·{" "}
            {smoke.activeJob.status}
          </p>
        ) : null}

        {lastSmokeResult ? (
          <p>
            Latest test: {lastSmokeResult.model || "route"} ·{" "}
            {lastSmokeResult.scope || "scope"} ·{" "}
            {lastSmokeResult.result?.outcome || lastSmokeResult.status || "pending"}
          </p>
        ) : null}

        {smokeError ? <p className="error">{smokeError}</p> : null}

        {smoke?.preference?.mediaContentPreference === "sfw_only" ? (
          <p>
            NSFW output is currently off, so the matrix will run SFW tests only.
            Non-explicit boundary testing remains disabled until the profile preference
            and 18+ acknowledgment permit it.
          </p>
        ) : null}

        <div>
          {(smoke?.routes || []).slice(0, 60).map((route) => (
            <div key={`${route.provider}|${route.model}|${route.kind}`}>
              <p>
                <b>{route.label}</b> · {route.provider} · {route.kind} · test{" "}
                {money(route.estimatedProviderCostUsd)} · SFW{" "}
                <b>{smokeOutcome(route.latestSfwTest)}</b> · non-explicit{" "}
                <b>
                  {route.policy.adultNonExplicit === "disallowed"
                    ? "policy-blocked"
                    : smokeOutcome(route.latestAdultNonExplicitTest)}
                </b>{" "}
                · explicit <b>{route.policy.adultExplicit}</b>
              </p>
              <div className="agent-submit-row">
                <button
                  type="button"
                  disabled={
                    Boolean(route.latestSfwTest) ||
                    smokeRunning ||
                    Boolean(activeSmokeJobId) ||
                    Boolean(smoke?.activeJob) ||
                    !Number.isFinite(smokeCap) ||
                    route.capUsd > smokeCap
                  }
                  onClick={() => void runSmoke(route, "sfw_baseline")}
                >
                  {route.latestSfwTest ? "SFW tested" : "Test SFW"}
                </button>
                <button
                  type="button"
                  disabled={
                    !route.adultNonExplicitTestEligible ||
                    Boolean(route.latestAdultNonExplicitTest) ||
                    smokeRunning ||
                    Boolean(activeSmokeJobId) ||
                    Boolean(smoke?.activeJob) ||
                    !Number.isFinite(smokeCap) ||
                    route.capUsd > smokeCap
                  }
                  onClick={() =>
                    void runSmoke(route, "adult_non_explicit_boundary")
                  }
                >
                  {route.policy.adultNonExplicit === "disallowed"
                    ? "Non-explicit blocked"
                    : route.latestAdultNonExplicitTest
                      ? "Boundary tested"
                      : "Test non-explicit"}
                </button>
              </div>
            </div>
          ))}
        </div>
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
