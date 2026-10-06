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
  input_modalities?: string[];
  output_modalities?: string[];
  capability_summary?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  policy_summary?: Record<string, unknown>;
  runtime_summary?: Record<string, unknown>;
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
  return `${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function routeKey(route: {
  provider: string;
  model: string;
  endpoint?: string | null;
  kind?: string;
  route_kind?: string;
}) {
  return [
    route.provider,
    route.model,
    route.endpoint || "",
    route.kind || route.route_kind || "",
  ].join("|");
}

function providerPath(provider: string) {
  if (provider === "nous") return "Nous → FAL hosted route";
  if (provider === "openrouter") return "OpenRouter hosted route";
  if (provider === "cooperative-local") return "CoOperative owned/local route";
  return `${provider} route`;
}

function adultPolicyFromRegistry(route: RegistryRoute) {
  const adult =
    route.policy_summary?.adult &&
    typeof route.policy_summary.adult === "object" &&
    !Array.isArray(route.policy_summary.adult)
      ? (route.policy_summary.adult as Record<string, unknown>)
      : {};

  return {
    nonExplicit:
      typeof adult.nonExplicit === "string" ? adult.nonExplicit : "unknown",
    nonExplicitSource:
      typeof adult.nonExplicitSource === "string"
        ? adult.nonExplicitSource
        : null,
    explicit:
      typeof adult.explicit === "string" ? adult.explicit : "unknown",
    explicitSource:
      typeof adult.explicitSource === "string" ? adult.explicitSource : null,
  };
}

function explicitPolicyLabel(policy: string, source: string | null) {
  if (policy === "allowed") {
    return {
      short: "Policy allows explicit",
      detail:
        "The current policy evidence allows the scope. CoOperative still requires exact-route verification before using explicit output.",
    };
  }

  if (policy === "disallowed") {
    if (source?.startsWith("runtime-policy-refusal:")) {
      return {
        short: "Observed runtime refusal",
        detail:
          "This exact hosted route previously refused an explicit request. This is route evidence, not a statement about the underlying model weights.",
      };
    }
    if (
      source?.includes("fal.ai") ||
      source?.includes("nousresearch.com")
    ) {
      return {
        short: "Host policy blocks explicit",
        detail:
          "The underlying model may or may not be technically capable. This Nous/FAL hosted route is restricted by the host/provider policy.",
      };
    }
    return {
      short: "Route policy blocks explicit",
      detail:
        "Current policy evidence blocks explicit output for this exact route.",
    };
  }

  return {
    short: "Explicit not verified",
    detail:
      "No exact-route evidence currently verifies explicit output. CoOperative will not probe an unknown hosted route during a real user request.",
  };
}

function nonExplicitLabel(route: SmokeRoute | null, registry: RegistryRoute) {
  if (route?.latestAdultNonExplicitTest?.outcome === "supported") {
    return "Tested: supported";
  }
  if (route?.latestAdultNonExplicitTest?.outcome === "blocked") {
    return "Tested: refused";
  }

  const policy = route?.policy.adultNonExplicit ||
    adultPolicyFromRegistry(registry).nonExplicit;
  const source = route?.policy.adultNonExplicitSource ||
    adultPolicyFromRegistry(registry).nonExplicitSource;

  if (policy === "disallowed") {
    return source?.includes("fal.ai")
      ? "Host policy blocks non-explicit"
      : "Route policy blocks non-explicit";
  }
  if (policy === "allowed") return "Policy allows; untested";
  return "Not tested / unknown";
}

function sfwLabel(route: SmokeRoute | null) {
  if (!route?.latestSfwTest?.outcome) return "Not tested";
  if (route.latestSfwTest.outcome === "supported") return "Tested: supported";
  if (route.latestSfwTest.outcome === "blocked") return "Tested: refused";
  if (route.latestSfwTest.outcome === "partial") return "Tested: partial";
  return "Tested: inconclusive";
}

function mediaKind(routeKind: string): "image" | "video" | null {
  if (routeKind === "image") return "image";
  if (routeKind === "video") return "video";
  return null;
}

function testUnavailableReason(
  route: RegistryRoute,
  smokeRoute: SmokeRoute | null,
) {
  if (smokeRoute) return null;
  if (route.status !== "active") return "Route is not currently active.";
  if (!route.execution_ready) {
    return "Known in the registry, but not currently execution-ready.";
  }
  if (route.route_kind === "image-edit") {
    return "Edit/reference route needs a standard reference fixture before one-click smoke testing can be enabled.";
  }
  if (!mediaKind(route.route_kind)) {
    return "This is not an image/video generation route, so the media smoke test does not apply.";
  }
  if (route.provider === "cooperative-local") {
    return "Owned/local route is visible, but this hosted smoke-test runner is not wired to the user's live local node yet.";
  }
  if (route.provider !== "nous" && route.provider !== "openrouter") {
    return "No exact-route smoke-test executor is wired for this provider yet.";
  }
  return "The exact route cannot currently produce a bounded one-shot test price or does not have the required connected credential.";
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
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogProvider, setCatalogProvider] = useState("all");
  const [catalogKind, setCatalogKind] = useState("all");
  const [catalogReadiness, setCatalogReadiness] = useState("all");
  const [catalogLimit, setCatalogLimit] = useState(75);

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
    let consecutiveReadFailures = 0;

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

        consecutiveReadFailures = 0;
        setSmokeError("");
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
        consecutiveReadFailures += 1;
        const message =
          err instanceof Error
            ? err.message
            : "Could not poll capability test.";

        if (consecutiveReadFailures <= 5) {
          setSmokeError(
            `Temporary status read issue (${consecutiveReadFailures}/5): ${message} Retrying without starting another generation.`,
          );
          timer = setTimeout(poll, 3000);
          return;
        }

        setSmokeError(
          `${message} The generation job was not retried or duplicated. Refresh this page to reconcile its persisted state.`,
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

  const smokeRouteMap = useMemo(() => {
    const map = new Map<string, SmokeRoute>();
    for (const route of smoke?.routes || []) {
      map.set(routeKey(route), route);
    }
    return map;
  }, [smoke?.routes]);

  const catalogProviders = useMemo(
    () => [...new Set(routes.map((route) => route.provider))].sort(),
    [routes],
  );

  const filteredCatalogRoutes = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return routes.filter((route) => {
      if (
        catalogProvider !== "all" &&
        route.provider !== catalogProvider
      ) {
        return false;
      }
      if (catalogKind !== "all" && route.route_kind !== catalogKind) {
        return false;
      }
      if (
        catalogReadiness === "ready" &&
        !route.execution_ready
      ) {
        return false;
      }
      if (
        catalogReadiness === "not-ready" &&
        route.execution_ready
      ) {
        return false;
      }
      if (!query) return true;
      return [
        route.display_name,
        route.model,
        route.provider,
        route.route_kind,
        route.endpoint,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [
    routes,
    catalogQuery,
    catalogProvider,
    catalogKind,
    catalogReadiness,
  ]);

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
            <strong>Media route capability tests</strong>
            <p>
              These are exact hosted-route tests, not judgments about the underlying
              model weights. SFW and non-explicit adult tests make one generation call
              with no retry or fallback. Explicit scope is shown from policy/runtime
              evidence only; CoOperative does not generate explicit material just to
              probe a provider.
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
            <span>Explicit blocked by host/route policy</span>
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
                <b>{route.label}</b> · {providerPath(route.provider)} · {route.kind} ·
                test {money(route.estimatedProviderCostUsd)}
              </p>
              <p>
                SFW <b>{sfwLabel(route)}</b> · non-explicit{" "}
                <b>
                  {route.latestAdultNonExplicitTest?.outcome === "supported"
                    ? "Tested: supported"
                    : route.latestAdultNonExplicitTest?.outcome === "blocked"
                      ? "Tested: refused"
                      : route.policy.adultNonExplicit === "disallowed"
                        ? "Blocked by host/route policy"
                        : "Not tested / unknown"}
                </b>{" "}
                · explicit{" "}
                <b title={explicitPolicyLabel(
                  route.policy.adultExplicit,
                  route.policy.adultExplicitSource,
                ).detail}>
                  {explicitPolicyLabel(
                    route.policy.adultExplicit,
                    route.policy.adultExplicitSource,
                  ).short}
                </b>
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
        <strong>All model routes</strong>
        <p>
          Full registry browser. Every discovered route stays visible here. Image and
          video generation routes expose exact smoke-test controls when CoOperative can
          safely execute and price that route; otherwise the row explains what is
          missing.
        </p>

        <label className="field">
          <span>Search models</span>
          <input
            type="search"
            placeholder="Model, provider, route kind…"
            value={catalogQuery}
            onChange={(event) => {
              setCatalogQuery(event.target.value);
              setCatalogLimit(75);
            }}
          />
        </label>

        <div className="row">
          <label className="field">
            <span>Provider</span>
            <select
              value={catalogProvider}
              onChange={(event) => {
                setCatalogProvider(event.target.value);
                setCatalogLimit(75);
              }}
            >
              <option value="all">All providers</option>
              {catalogProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Route type</span>
            <select
              value={catalogKind}
              onChange={(event) => {
                setCatalogKind(event.target.value);
                setCatalogLimit(75);
              }}
            >
              <option value="all">All route types</option>
              {[...new Set(routes.map((route) => route.route_kind))]
                .sort()
                .map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            <span>Readiness</span>
            <select
              value={catalogReadiness}
              onChange={(event) => {
                setCatalogReadiness(event.target.value);
                setCatalogLimit(75);
              }}
            >
              <option value="all">All</option>
              <option value="ready">Execution-ready</option>
              <option value="not-ready">Known, not ready</option>
            </select>
          </label>
        </div>

        <p>
          Showing {Math.min(catalogLimit, filteredCatalogRoutes.length)} of{" "}
          {filteredCatalogRoutes.length} matching routes · {routes.length} total in
          registry.
        </p>

        <div>
          {filteredCatalogRoutes.slice(0, catalogLimit).map((route) => {
            const kind = mediaKind(route.route_kind);
            const smokeRoute = kind
              ? smokeRouteMap.get(
                  routeKey({
                    provider: route.provider,
                    model: route.model,
                    endpoint: route.endpoint,
                    kind,
                  }),
                ) || null
              : null;
            const registryPolicy = adultPolicyFromRegistry(route);
            const explicit = explicitPolicyLabel(
              smokeRoute?.policy.adultExplicit || registryPolicy.explicit,
              smokeRoute?.policy.adultExplicitSource ||
                registryPolicy.explicitSource,
            );
            const unavailable = testUnavailableReason(route, smokeRoute);

            return (
              <div key={route.id}>
                <p>
                  <b>{route.display_name}</b> · {providerPath(route.provider)} ·{" "}
                  {route.route_kind} ·{" "}
                  <b>{route.execution_ready ? "execution-ready" : "known only"}</b>
                  {route.free ? " · free" : " · paid/usage-based"}
                </p>

                {kind ? (
                  <>
                    <p>
                      SFW <b>{sfwLabel(smokeRoute)}</b> · non-explicit{" "}
                      <b>{nonExplicitLabel(smokeRoute, route)}</b> · explicit{" "}
                      <b title={explicit.detail}>{explicit.short}</b>
                    </p>
                    {smokeRoute ? (
                      <div className="agent-submit-row">
                        <span>
                          One-shot test estimate{" "}
                          {money(smokeRoute.estimatedProviderCostUsd)}
                        </span>
                        <button
                          type="button"
                          disabled={
                            Boolean(smokeRoute.latestSfwTest) ||
                            smokeRunning ||
                            Boolean(activeSmokeJobId) ||
                            Boolean(smoke?.activeJob) ||
                            !Number.isFinite(smokeCap) ||
                            smokeRoute.capUsd > smokeCap
                          }
                          onClick={() =>
                            void runSmoke(smokeRoute, "sfw_baseline")
                          }
                        >
                          {smokeRoute.latestSfwTest
                            ? "SFW tested"
                            : "Test SFW"}
                        </button>
                        <button
                          type="button"
                          disabled={
                            !smokeRoute.adultNonExplicitTestEligible ||
                            Boolean(smokeRoute.latestAdultNonExplicitTest) ||
                            smokeRunning ||
                            Boolean(activeSmokeJobId) ||
                            Boolean(smoke?.activeJob) ||
                            !Number.isFinite(smokeCap) ||
                            smokeRoute.capUsd > smokeCap
                          }
                          onClick={() =>
                            void runSmoke(
                              smokeRoute,
                              "adult_non_explicit_boundary",
                            )
                          }
                        >
                          {smokeRoute.policy.adultNonExplicit === "disallowed"
                            ? "Non-explicit blocked by policy"
                            : smokeRoute.latestAdultNonExplicitTest
                              ? "Boundary tested"
                              : "Test non-explicit"}
                        </button>
                      </div>
                    ) : (
                      <p>
                        <b>Exact smoke test unavailable:</b> {unavailable}
                      </p>
                    )}
                  </>
                ) : (
                  <p>
                    <b>Testing:</b> {unavailable}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {catalogLimit < filteredCatalogRoutes.length ? (
          <button
            type="button"
            onClick={() => setCatalogLimit((value) => value + 75)}
          >
            Show 75 more
          </button>
        ) : null}
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
