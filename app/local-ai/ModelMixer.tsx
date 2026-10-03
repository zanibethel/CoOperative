"use client";

import { useEffect, useMemo, useState } from "react";

type LiveMediaModel = {
  id: string;
  name: string;
  free: boolean;
  costLabel: string;
};

type LiveMediaTier = {
  level: number;
  model: LiveMediaModel | null;
};

type LiveMediaCatalog = {
  fetchedAt: string;
  configured: {
    nous: boolean;
    openRouter: boolean;
  };
  paidAiEligible?: boolean;
  availableAiBalanceUsd?: number;
  routingPriority?: Array<"nous" | "local-or-free" | "openrouter-paid">;
  nous?: {
    fetchedAt: string;
    image: Array<{
      model: string;
      qualityLabel: string;
      estimatedCostUsd: number;
    }>;
    video: {
      model: string;
      rates: Record<string, { withoutAudio: number; withAudio: number }>;
    } | null;
  };
  image: {
    recommended: LiveMediaTier[];
  };
  video: {
    recommended: LiveMediaTier[];
  };
};

export type ModelMixerAgent =
  | "research"
  | "planner"
  | "builder"
  | "verifier"
  | "media";

export type ModelMixerLevel = 0 | 1 | 2 | 3 | 4;
export type ModelMixerPreset = "economy" | "balanced" | "premium" | "custom";
type MediaContentPreference =
  | "sfw_only"
  | "adult_allowed"
  | "prefer_adult_capable"
  | "require_adult_capable";

type CapabilityTestRoute = {
  provider: "nous" | "openrouter";
  model: string;
  endpoint: string;
  label: string;
  estimatedCostUsd: number;
  capUsd: number;
  pricingSource: string;
  latestTest: {
    outcome: "supported" | "blocked" | "partial" | "inconclusive";
    prompt_classification: string | null;
    tested_at: string | null;
  } | null;
  benchmarkScorecard?: {
    dimensions: {
      visualQuality: number | null;
      promptAdherence: number | null;
      anatomy: number | null;
      referenceFidelity: number | null;
      editStrength: number | null;
      speed: number | null;
    };
    measuredDimensions: number;
    latestMeasuredAt: string | null;
  };
};

type CapabilityTestCatalog = {
  promptClassification: string;
  testDescription: string;
  routes: CapabilityTestRoute[];
  activeJob: {
    jobId: string;
    provider: string;
    model: string;
    status: string;
    estimatedProviderCostUsd: number | null;
  } | null;
};

type CapabilityTestState = {
  jobId: string;
  status: string;
  provider: string;
  model: string;
  mediaUrl?: string | null;
  error?: string | null;
  result?: {
    outcome: "supported" | "blocked" | "partial" | "inconclusive";
    promptClassification: string | null;
    testedAt?: string | null;
    notes?: string | null;
  } | null;
};

type MediaQualityBenchmarkPreparation = {
  suite: string;
  preparedAt: string;
  imageCount: number;
  callsPerRoute: number;
  estimatedTotalCostUsd: number;
  safeTotalCapUsd: number;
  cases: Array<{
    id: string;
    label: string;
    primaryDimensions: string[];
    prompt: string;
    evaluation: string[];
  }>;
  routes: Array<{
    provider: "nous";
    model: string;
    available: boolean;
    estimatedCostPerImageUsd: number | null;
    safeCapPerImageUsd: number | null;
    estimatedSuiteCostUsd: number | null;
    safeSuiteCapUsd: number | null;
    pricingSource: string | null;
  }>;
  executionPolicy: {
    paidCallsStartOnPrepare: boolean;
    exactRouteOnly: boolean;
    retries: boolean;
    fallbacks: boolean;
    parallelRouteSubstitution: boolean;
    identicalPromptsAcrossRoutes: boolean;
    contentClass: string;
  };
};

export type ModelMixerSettings = {
  preset: ModelMixerPreset;
  maxSpendUsd: number;
  agents: Record<ModelMixerAgent, ModelMixerLevel>;
};

type ModelMixerProps = {
  open: boolean;
  settings: ModelMixerSettings;
  paidAiEligible: boolean;
  refreshKey?: number;
  onChange: (settings: ModelMixerSettings) => void;
  onClose: () => void;
};

const LEVELS = ["Free", "Low", "Balanced", "High", "Premium"] as const;
const ADULT_CONTENT_OPTIONS: Array<{
  value: Exclude<MediaContentPreference, "sfw_only">;
  label: string;
  description: string;
}> = [
  {
    value: "adult_allowed",
    label: "Adult content allowed",
    description:
      "Allow adult output when requested while otherwise choosing the best execution recipe for the job.",
  },
  {
    value: "prefer_adult_capable",
    label: "Prefer adult-capable models",
    description:
      "When otherwise comparable, prefer verified adult-capable routes without sacrificing requested output quality.",
  },
  {
    value: "require_adult_capable",
    label: "Require adult-capable models",
    description:
      "For applicable media requests, require a route verified to support the requested adult workflow.",
  },
];


const AGENTS: Array<{
  key: ModelMixerAgent;
  name: string;
  icon: string;
  description: string;
  costWeight: number;
  modelMix: Record<ModelMixerLevel, string[]>;
}> = [
  {
    key: "research",
    name: "Research Agent",
    icon: "⌕",
    description: "Web research, docs, context",
    costWeight: 0.7,
    modelMix: {
      0: ["Local"],
      1: ["Free Hosted"],
      2: ["GLM", "Free Hosted"],
      3: ["GLM", "Claude"],
      4: ["Claude", "GPT"],
    },
  },
  {
    key: "planner",
    name: "Planner Agent",
    icon: "☷",
    description: "Planning, analysis, structure",
    costWeight: 1,
    modelMix: {
      0: ["Local"],
      1: ["Free Hosted", "Local"],
      2: ["GLM"],
      3: ["Claude", "GPT"],
      4: ["Claude", "GPT"],
    },
  },
  {
    key: "builder",
    name: "Builder Agent",
    icon: "</>",
    description: "Code generation, implementation",
    costWeight: 1.3,
    modelMix: {
      0: ["Local"],
      1: ["GLM", "Local"],
      2: ["GLM", "Claude"],
      3: ["Claude", "GPT"],
      4: ["Claude", "GPT"],
    },
  },
  {
    key: "verifier",
    name: "Verifier Agent",
    icon: "◇",
    description: "Testing, review, validation",
    costWeight: 0.85,
    modelMix: {
      0: ["Local"],
      1: ["Free Hosted", "Local"],
      2: ["GLM"],
      3: ["GLM", "Claude"],
      4: ["Claude", "GPT"],
    },
  },
  {
    key: "media",
    name: "Media Agent",
    icon: "▧",
    description: "Images, UI assets, diagrams",
    costWeight: 1.1,
    modelMix: {
      0: ["Local"],
      1: ["Free Hosted", "Local"],
      2: ["Free Hosted"],
      3: ["Paid Image"],
      4: ["Premium Image"],
    },
  },
];

const LEVEL_COST_USD = [0, 0.006, 0.02, 0.055, 0.14] as const;

const PRESETS: Record<
  Exclude<ModelMixerPreset, "custom">,
  Omit<ModelMixerSettings, "preset">
> = {
  economy: {
    maxSpendUsd: 0.05,
    agents: {
      research: 0,
      planner: 1,
      builder: 1,
      verifier: 1,
      media: 1,
    },
  },
  balanced: {
    maxSpendUsd: 1,
    agents: {
      research: 1,
      planner: 2,
      builder: 3,
      verifier: 3,
      media: 1,
    },
  },
  premium: {
    maxSpendUsd: 3,
    agents: {
      research: 2,
      planner: 3,
      builder: 4,
      verifier: 4,
      media: 2,
    },
  },
};

export const DEFAULT_MODEL_MIXER_SETTINGS: ModelMixerSettings = {
  preset: "economy",
  ...PRESETS.economy,
};

export function estimateModelMixer(settings: ModelMixerSettings) {
  const variableCost = AGENTS.reduce((total, agent) => {
    return total + LEVEL_COST_USD[settings.agents[agent.key]] * agent.costWeight;
  }, 0);
  const estimatedUsd = Math.min(settings.maxSpendUsd, Math.max(0, variableCost + 0.01));

  const seconds = Math.round(
    45 +
      AGENTS.reduce(
        (total, agent) => total + (settings.agents[agent.key] + 1) * agent.costWeight * 8,
        0,
      ),
  );

  return {
    estimatedUsd,
    seconds,
    withinCap: estimatedUsd <= settings.maxSpendUsd,
  };
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function formatBenchmarkScore(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}/100`
    : "Not benchmarked";
}

function capabilityRouteKey(route: Pick<CapabilityTestRoute, "provider" | "model">) {
  return `${route.provider}|${route.model}`;
}

async function loadCapabilityTestCatalog() {
  const response = await fetch("/api/inference/media/capabilities/test", {
    cache: "no-store",
  });
  const payload = (await response.json()) as CapabilityTestCatalog & {
    error?: string;
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.detail || payload.error || "Could not load capability-test routes.",
    );
  }
  return payload;
}

async function loadCapabilityTestState(jobId: string) {
  const response = await fetch(
    `/api/inference/media/capabilities/test?jobId=${encodeURIComponent(jobId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as CapabilityTestState & {
    error?: string;
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.detail || payload.error || "Could not read capability-test status.",
    );
  }
  return payload;
}

async function loadMediaQualityBenchmarkPreparation() {
  const response = await fetch("/api/inference/media/benchmarks/prepare", {
    cache: "no-store",
  });
  const payload = (await response.json()) as MediaQualityBenchmarkPreparation & {
    error?: string;
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(
      payload.detail ||
        payload.error ||
        "Could not prepare the media quality benchmark.",
    );
  }
  return payload;
}

function presetSettings(preset: Exclude<ModelMixerPreset, "custom">): ModelMixerSettings {
  return {
    preset,
    maxSpendUsd: PRESETS[preset].maxSpendUsd,
    agents: { ...PRESETS[preset].agents },
  };
}

function presetSummary(preset: Exclude<ModelMixerPreset, "custom">) {
  return estimateModelMixer(presetSettings(preset));
}

function MixerGlyph() {
  return (
    <span className="model-mixer-glyph" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function ModelMixerTrigger({
  onClick,
  active,
}: {
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      className={`model-mixer-trigger${active ? " active" : ""}`}
      type="button"
      onClick={onClick}
      aria-label="Open Model Mixer"
      title="Model Mixer"
    >
      <MixerGlyph />
      <span>Model Mixer</span>
    </button>
  );
}

export default function ModelMixer({
  open,
  settings,
  paidAiEligible,
  refreshKey = 0,
  onChange,
  onClose,
}: ModelMixerProps) {
  const [mediaCatalog, setMediaCatalog] = useState<LiveMediaCatalog | null>(null);
  const [mediaCatalogError, setMediaCatalogError] = useState(false);
  const [mediaContentPreference, setMediaContentPreference] =
    useState<MediaContentPreference>("sfw_only");
  const [adultContentAcknowledged, setAdultContentAcknowledged] = useState(false);
  const [mediaPreferenceLoaded, setMediaPreferenceLoaded] = useState(false);
  const [mediaPreferenceSaving, setMediaPreferenceSaving] = useState(false);
  const [mediaPreferenceError, setMediaPreferenceError] = useState("");
  const [capabilityCatalog, setCapabilityCatalog] =
    useState<CapabilityTestCatalog | null>(null);
  const [capabilityCatalogError, setCapabilityCatalogError] = useState("");
  const [capabilityRouteSelection, setCapabilityRouteSelection] = useState("");
  const [preparedCapabilityRoute, setPreparedCapabilityRoute] = useState("");
  const [policyRefreshing, setPolicyRefreshing] = useState(false);
  const [policyRefreshMessage, setPolicyRefreshMessage] = useState("");
  const [capabilityTestJobId, setCapabilityTestJobId] = useState("");
  const [capabilityTestStatus, setCapabilityTestStatus] = useState("");
  const [capabilityTestMessage, setCapabilityTestMessage] = useState("");
  const [benchmarkPreparation, setBenchmarkPreparation] =
    useState<MediaQualityBenchmarkPreparation | null>(null);
  const [benchmarkPreparationError, setBenchmarkPreparationError] = useState("");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void fetch("/api/personal-ai/settings", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          settings?: {
            mediaContentPreference?: MediaContentPreference;
            adultContentAcknowledgedAt?: string | null;
          };
          error?: string;
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.detail || payload.error || "Could not load media content preference.",
          );
        }
        if (cancelled) return;
        setMediaPreferenceError("");
        setMediaContentPreference(
          payload.settings?.mediaContentPreference || "sfw_only",
        );
        setAdultContentAcknowledged(
          Boolean(payload.settings?.adultContentAcknowledgedAt),
        );
        setMediaPreferenceLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setMediaPreferenceError(
          error instanceof Error
            ? error.message
            : "Could not load media content preference.",
        );
        setMediaPreferenceLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void fetch("/api/inference/media/models", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Media catalog unavailable.");
        return (await response.json()) as LiveMediaCatalog;
      })
      .then((payload) => {
        if (!cancelled) {
          setMediaCatalog(payload);
          setMediaCatalogError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setMediaCatalogError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void loadMediaQualityBenchmarkPreparation()
      .then((payload) => {
        if (cancelled) return;
        setBenchmarkPreparation(payload);
        setBenchmarkPreparationError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setBenchmarkPreparation(null);
        setBenchmarkPreparationError(
          error instanceof Error
            ? error.message
            : "Could not prepare the media quality benchmark.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void loadCapabilityTestCatalog()
      .then((payload) => {
        if (cancelled) return;
        setCapabilityCatalog(payload);
        setCapabilityCatalogError("");
        setCapabilityRouteSelection((current) => {
          const activeRouteKey = payload.activeJob
            ? `${payload.activeJob.provider}|${payload.activeJob.model}`
            : "";
          if (
            activeRouteKey &&
            payload.routes.some(
              (route) => capabilityRouteKey(route) === activeRouteKey,
            )
          ) {
            return activeRouteKey;
          }
          if (
            current &&
            payload.routes.some((route) => capabilityRouteKey(route) === current)
          ) {
            return current;
          }
          return payload.routes[0] ? capabilityRouteKey(payload.routes[0]) : "";
        });
        if (payload.activeJob) {
          setCapabilityTestJobId(payload.activeJob.jobId);
          setCapabilityTestStatus(payload.activeJob.status);
          setCapabilityTestMessage(
            `Capability test is ${payload.activeJob.status} on ${payload.activeJob.model}.`,
          );
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setCapabilityCatalogError(
          error instanceof Error
            ? error.message
            : "Could not load capability-test routes.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  useEffect(() => {
    if (
      !open ||
      !capabilityTestJobId ||
      (capabilityTestStatus !== "running" && capabilityTestStatus !== "queued")
    ) {
      return;
    }

    let cancelled = false;
    let checking = false;

    const poll = async () => {
      if (cancelled || checking) return;
      checking = true;

      try {
        const payload = await loadCapabilityTestState(capabilityTestJobId);
        if (cancelled) return;

        setCapabilityTestStatus(payload.status);
        if (payload.status === "running" || payload.status === "queued") {
          setCapabilityTestMessage(
            `Capability test is ${payload.status} on ${payload.model}.`,
          );
          return;
        }

        if (payload.result) {
          setCapabilityTestMessage(
            `Capability test ${payload.result.outcome}: ${payload.result.notes || payload.model}`,
          );
        } else {
          setCapabilityTestMessage(
            payload.error ||
              `Capability test finished with status ${payload.status}.`,
          );
        }

        const catalog = await loadCapabilityTestCatalog();
        if (cancelled) return;
        setCapabilityCatalog(catalog);
      } catch (error) {
        if (cancelled) return;
        setCapabilityTestMessage(
          error instanceof Error
            ? error.message
            : "Could not refresh capability-test status.",
        );
      } finally {
        checking = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, capabilityTestJobId, capabilityTestStatus]);

  const liveMedia = useMemo(() => {
    if (!mediaCatalog) return null;
    const level = settings.agents.media;
    return {
      image:
        mediaCatalog.image.recommended.find((entry) => entry.level === level)?.model || null,
      video:
        mediaCatalog.video.recommended.find((entry) => entry.level === level)?.model || null,
    };
  }, [mediaCatalog, settings.agents.media]);

  if (!open) return null;

  const estimate = estimateModelMixer(settings);

  const nsfwEnabled = mediaContentPreference !== "sfw_only";
  const selectedAdultContentOption =
    ADULT_CONTENT_OPTIONS.find(
      (option) => option.value === mediaContentPreference,
    ) || ADULT_CONTENT_OPTIONS[0];
  const selectedCapabilityRoute =
    capabilityCatalog?.routes.find(
      (route) => capabilityRouteKey(route) === capabilityRouteSelection,
    ) || null;
  const preparedCapability =
    capabilityCatalog?.routes.find(
      (route) => capabilityRouteKey(route) === preparedCapabilityRoute,
    ) || null;

  async function saveMediaContentPreference() {
    if (mediaPreferenceSaving) return;
    if (
      mediaContentPreference !== "sfw_only" &&
      !adultContentAcknowledged
    ) {
      setMediaPreferenceError(
        "Confirm that you are 18+ before saving an adult-capable media preference.",
      );
      return;
    }

    setMediaPreferenceSaving(true);
    setMediaPreferenceError("");
    try {
      const response = await fetch("/api/personal-ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaContentPreference,
          adultContentAcknowledged:
            mediaContentPreference === "sfw_only"
              ? false
              : adultContentAcknowledged,
        }),
      });
      const payload = (await response.json()) as {
        settings?: {
          mediaContentPreference?: MediaContentPreference;
          adultContentAcknowledgedAt?: string | null;
        };
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "Could not save media content preference.",
        );
      }
      setMediaContentPreference(
        payload.settings?.mediaContentPreference || "sfw_only",
      );
      setAdultContentAcknowledged(
        Boolean(payload.settings?.adultContentAcknowledgedAt),
      );
    } catch (error) {
      setMediaPreferenceError(
        error instanceof Error
          ? error.message
          : "Could not save media content preference.",
      );
    } finally {
      setMediaPreferenceSaving(false);
    }
  }

  async function refreshPolicyEvidence() {
    if (policyRefreshing) return;
    setPolicyRefreshing(true);
    setPolicyRefreshMessage("");
    try {
      const response = await fetch("/api/inference/media/capabilities/refresh", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        refreshed?: boolean;
        sources?: Array<{ provider: string; ok: boolean; detail?: string | null }>;
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "Could not refresh policy evidence.",
        );
      }

      const okCount = payload.sources?.filter((source) => source.ok).length || 0;
      const total = payload.sources?.length || 0;
      setPolicyRefreshMessage(
        `Policy evidence refreshed from ${okCount}/${total} source groups. General provider policy is recorded as evidence, not treated as model capability.`,
      );
      const catalog = await loadCapabilityTestCatalog();
      setCapabilityCatalog(catalog);
      setCapabilityCatalogError("");
    } catch (error) {
      setPolicyRefreshMessage(
        error instanceof Error
          ? error.message
          : "Could not refresh policy evidence.",
      );
    } finally {
      setPolicyRefreshing(false);
    }
  }

  function prepareSelectedCapabilityTest() {
    if (!capabilityRouteSelection) return;
    setPreparedCapabilityRoute(capabilityRouteSelection);
    setCapabilityTestMessage("");
  }

  async function runPreparedCapabilityTest() {
    const route = capabilityCatalog?.routes.find(
      (candidate) => capabilityRouteKey(candidate) === preparedCapabilityRoute,
    );
    if (!route) return;

    if (!nsfwEnabled || !adultContentAcknowledged) {
      setCapabilityTestMessage(
        "Enable NSFW output, confirm 18+, and save the preference before running a capability test.",
      );
      return;
    }

    if (route.capUsd > settings.maxSpendUsd + 0.000001) {
      setCapabilityTestMessage(
        `Current Model Mixer cap is ${settings.maxSpendUsd.toFixed(2)}; this one-shot test requires at least ${route.capUsd.toFixed(2)}. CoOperative will not raise the cap automatically.`,
      );
      return;
    }

    setCapabilityTestMessage("Starting one exact-route capability test…");
    try {
      const response = await fetch("/api/inference/media/capabilities/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: route.provider,
          model: route.model,
          maxSpendUsd: route.capUsd,
          confirm: true,
        }),
      });
      const payload = (await response.json()) as CapabilityTestState & {
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.detail || payload.error || "Could not start capability test.",
        );
      }

      setCapabilityTestJobId(payload.jobId);
      setCapabilityTestStatus(payload.status);
      setCapabilityTestMessage(
        payload.status === "running"
          ? `One-shot test started on ${route.label}. No retry or fallback is allowed.`
          : payload.error || `Capability test finished with ${payload.status}.`,
      );
    } catch (error) {
      setCapabilityTestStatus("failed");
      setCapabilityTestMessage(
        error instanceof Error
          ? error.message
          : "Could not start capability test.",
      );
    }
  }

  function setPreset(preset: Exclude<ModelMixerPreset, "custom">) {
    onChange(presetSettings(preset));
  }

  function setLevel(agent: ModelMixerAgent, value: ModelMixerLevel) {
    onChange({
      ...settings,
      preset: "custom",
      agents: {
        ...settings.agents,
        [agent]: value,
      },
    });
  }

  return (
    <>
      <button
        className="model-mixer-backdrop"
        type="button"
        onClick={onClose}
        aria-label="Close Model Mixer"
      />
      <aside className="model-mixer-panel" aria-label="Model Mixer">
        <div className="model-mixer-head">
          <div className="model-mixer-title">
            <MixerGlyph />
            <div>
              <h2>Model Mixer</h2>
              <p>Control how each agent uses AI models for this session.</p>
            </div>
          </div>
          <button
            className="model-mixer-close"
            type="button"
            onClick={onClose}
            aria-label="Close Model Mixer"
          >
            ×
          </button>
        </div>

        <div className="model-mixer-presets">
          {(["economy", "balanced", "premium"] as const).map((preset) => {
            const summary = presetSummary(preset);
            const labels = {
              economy: ["Economy", "Fastest, lowest cost"],
              balanced: ["Balanced", "Good quality + value"],
              premium: ["Premium", "Highest quality"],
            } as const;
            return (
              <button
                key={preset}
                type="button"
                className={`model-mixer-preset${settings.preset === preset ? " active" : ""}`}
                onClick={() => setPreset(preset)}
              >
                <strong>{labels[preset][0]}</strong>
                <span>
                  ~${summary.estimatedUsd.toFixed(2)} · ~{formatDuration(summary.seconds)}
                </span>
                <small>{labels[preset][1]}</small>
              </button>
            );
          })}
        </div>

        <div className="model-mixer-agent-list">
          {AGENTS.map((agent) => {
            const level = settings.agents[agent.key];
            return (
              <div className="model-mixer-agent" key={agent.key}>
                <div className="model-mixer-agent-head">
                  <span className="model-mixer-agent-icon">{agent.icon}</span>
                  <div>
                    <strong>{agent.name}</strong>
                    <small>{agent.description}</small>
                  </div>
                  <div className="model-mixer-models" aria-label="Likely model blend">
                    {agent.key === "media" && liveMedia ? (
                      <>
                        {liveMedia.image ? (
                          <span title={liveMedia.image.id}>
                            Img · {liveMedia.image.name.replace(/^[^:]+:\s*/, "")} · {liveMedia.image.costLabel}
                          </span>
                        ) : null}
                        {liveMedia.video ? (
                          <span title={liveMedia.video.id}>
                            Vid · {liveMedia.video.name.replace(/^[^:]+:\s*/, "")} · {liveMedia.video.costLabel}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      agent.modelMix[level].map((model) => (
                        <span key={model}>{model}</span>
                      ))
                    )}
                  </div>
                </div>

                <div className="model-mixer-slider-wrap">
                  <input
                    className="model-mixer-slider"
                    type="range"
                    min="0"
                    max="4"
                    step="1"
                    value={level}
                    onChange={(event) =>
                      setLevel(agent.key, Number(event.target.value) as ModelMixerLevel)
                    }
                    aria-label={`${agent.name} model level`}
                  />
                  <div className="model-mixer-level-labels" aria-hidden="true">
                    {LEVELS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="model-mixer-summary">
          <span>
            <small>Estimated Session Cost</small>
            <strong>~${estimate.estimatedUsd.toFixed(2)}</strong>
          </span>
          <span>
            <small>Estimated Time</small>
            <strong>{formatDuration(estimate.seconds)}</strong>
          </span>
          <label>
            <small>Max spend cap</small>
            <span className="model-mixer-cap-input">
              <b>$</b>
              <input
                type="number"
                min="0"
                max="100"
                step="0.05"
                value={settings.maxSpendUsd}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  onChange({
                    ...settings,
                    preset: "custom",
                    maxSpendUsd: Number.isFinite(next) ? Math.max(0, next) : 0,
                  });
                }}
                aria-label="Maximum spend cap"
              />
            </span>
            <button
              className="model-mixer-test-cap"
              type="button"
              onClick={() =>
                onChange({
                  ...settings,
                  preset: "custom",
                  maxSpendUsd: 0.05,
                })
              }
            >
              Use $0.05 test cap
            </button>
          </label>
        </div>

        <div className="model-mixer-content-preference">
          <div className="model-mixer-content-preference-head">
            <div>
              <strong>Adult content (NSFW)</strong>
              <span>
                Output preference. Adult-capable models remain eligible for SFW work when
                they are otherwise the best fit.
              </span>
            </div>
            <label className="model-mixer-nsfw-toggle">
              <input
                type="checkbox"
                checked={nsfwEnabled}
                disabled={!mediaPreferenceLoaded || mediaPreferenceSaving}
                onChange={(event) => {
                  if (event.target.checked) {
                    setMediaContentPreference("adult_allowed");
                  } else {
                    setMediaContentPreference("sfw_only");
                    setAdultContentAcknowledged(false);
                  }
                  setMediaPreferenceError("");
                }}
                aria-label="Allow NSFW output"
              />
              <span aria-hidden="true" />
            </label>
          </div>

          {!nsfwEnabled ? (
            <div className="model-mixer-sfw-state">
              <strong>Keep generated output SFW</strong>
              <span>
                CoOperative can still use any suitable model, including adult-capable
                models. NSFW capability alone never disqualifies a model from SFW work.
              </span>
            </div>
          ) : (
            <div className="model-mixer-nsfw-expanded">
              <div className="model-mixer-adult-warning">
                <strong>18+ content setting</strong>
                <span>
                  This permits adult output when requested. It does not override provider
                  policies, platform safety boundaries, or legal restrictions.
                </span>
              </div>

              <label className="model-mixer-adult-ack">
                <input
                  type="checkbox"
                  checked={adultContentAcknowledged}
                  disabled={mediaPreferenceSaving}
                  onChange={(event) => {
                    setAdultContentAcknowledged(event.target.checked);
                    setMediaPreferenceError("");
                  }}
                />
                <span>I confirm I am 18+.</span>
              </label>

              <div className="model-mixer-adult-options" role="radiogroup" aria-label="Adult content model preference">
                {ADULT_CONTENT_OPTIONS.map((option) => (
                  <label
                    className={`model-mixer-adult-option${mediaContentPreference === option.value ? " selected" : ""}`}
                    key={option.value}
                  >
                    <input
                      type="radio"
                      name="adult-content-model-preference"
                      value={option.value}
                      checked={mediaContentPreference === option.value}
                      disabled={mediaPreferenceSaving}
                      onChange={() => {
                        setMediaContentPreference(option.value);
                        setMediaPreferenceError("");
                      }}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>

              <p className="model-mixer-adult-selection-note">
                Current selection: <strong>{selectedAdultContentOption.label}</strong>.
                Recommendation and execution routing already use scoped capability evidence.
              </p>

              <div className="model-mixer-capability-lab">
                <div className="model-mixer-capability-lab-head">
                  <div>
                    <strong>Capability lab</strong>
                    <span>
                      Source-backed policy evidence + one exact-route test at a time.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshPolicyEvidence()}
                    disabled={policyRefreshing}
                  >
                    {policyRefreshing ? "Refreshing…" : "Refresh evidence"}
                  </button>
                </div>

                {policyRefreshMessage ? (
                  <p className="model-mixer-capability-message">
                    {policyRefreshMessage}
                  </p>
                ) : null}

                <label className="model-mixer-capability-select">
                  <span>Hosted image route to test</span>
                  <select
                    value={capabilityRouteSelection}
                    onChange={(event) => {
                      setCapabilityRouteSelection(event.target.value);
                      setPreparedCapabilityRoute("");
                      setCapabilityTestMessage("");
                    }}
                    disabled={
                      !capabilityCatalog?.routes.length ||
                      capabilityTestStatus === "running" ||
                      capabilityTestStatus === "queued"
                    }
                  >
                    {(capabilityCatalog?.routes || []).map((route) => (
                      <option
                        key={capabilityRouteKey(route)}
                        value={capabilityRouteKey(route)}
                      >
                        {route.provider} · {route.label} · ~${route.estimatedCostUsd.toFixed(3)}
                      </option>
                    ))}
                  </select>
                </label>

                {capabilityCatalogError ? (
                  <p className="model-mixer-content-error">
                    {capabilityCatalogError}
                  </p>
                ) : null}

                {capabilityCatalog ? (
                  <small className="model-mixer-capability-scope">
                    {capabilityCatalog.testDescription}
                  </small>
                ) : null}

                {selectedCapabilityRoute ? (
                  <div className="model-mixer-capability-route-summary">
                    <span>
                      <small>Current route</small>
                      <strong>
                        {selectedCapabilityRoute.provider} · {selectedCapabilityRoute.label}
                      </strong>
                    </span>
                    <span>
                      <small>Live estimate</small>
                      <strong>
                        ~${selectedCapabilityRoute.estimatedCostUsd.toFixed(3)}
                      </strong>
                    </span>
                    <span>
                      <small>Latest boundary test</small>
                      <strong>
                        {selectedCapabilityRoute.latestTest?.outcome || "Not tested"}
                      </strong>
                    </span>
                    <span>
                      <small>Visual quality</small>
                      <strong>
                        {formatBenchmarkScore(
                          selectedCapabilityRoute.benchmarkScorecard?.dimensions.visualQuality,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Prompt adherence</small>
                      <strong>
                        {formatBenchmarkScore(
                          selectedCapabilityRoute.benchmarkScorecard?.dimensions.promptAdherence,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Anatomy</small>
                      <strong>
                        {formatBenchmarkScore(
                          selectedCapabilityRoute.benchmarkScorecard?.dimensions.anatomy,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Reference fidelity</small>
                      <strong>
                        {formatBenchmarkScore(
                          selectedCapabilityRoute.benchmarkScorecard?.dimensions.referenceFidelity,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Edit strength</small>
                      <strong>
                        {formatBenchmarkScore(
                          selectedCapabilityRoute.benchmarkScorecard?.dimensions.editStrength,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Speed</small>
                      <strong>
                        {formatBenchmarkScore(
                          selectedCapabilityRoute.benchmarkScorecard?.dimensions.speed,
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Benchmark evidence</small>
                      <strong>
                        {selectedCapabilityRoute.benchmarkScorecard?.measuredDimensions || 0}/6 measured
                      </strong>
                    </span>
                  </div>
                ) : null}

                {capabilityCatalog?.routes.length ? (
                  <div className="model-mixer-capability-actions">
                    <button
                      type="button"
                      onClick={prepareSelectedCapabilityTest}
                      disabled={
                        !capabilityRouteSelection ||
                        capabilityTestStatus === "running" ||
                        capabilityTestStatus === "queued"
                      }
                    >
                      Prepare one test
                    </button>
                  </div>
                ) : null}

                {preparedCapability ? (
                  <div className="model-mixer-capability-prepared">
                    <strong>
                      {preparedCapability.provider} · {preparedCapability.label}
                    </strong>
                    <span>
                      Live estimate ~${preparedCapability.estimatedCostUsd.toFixed(3)} ·
                      safe cap ${preparedCapability.capUsd.toFixed(2)}
                    </span>
                    <small>
                      This test uses a fictional adult fine-art figure study with
                      non-explicit nudity and no sexual activity. It does not certify
                      sexually explicit output.
                    </small>
                    {preparedCapability.capUsd >
                    settings.maxSpendUsd + 0.000001 ? (
                      <>
                        <small className="model-mixer-content-error">
                          Current session cap is ${settings.maxSpendUsd.toFixed(2)}.
                          Raise it manually to at least ${preparedCapability.capUsd.toFixed(2)}
                          if you want to run this test.
                        </small>
                        <button
                          className="model-mixer-test-cap"
                          type="button"
                          onClick={() =>
                            onChange({
                              ...settings,
                              preset: "custom",
                              maxSpendUsd: preparedCapability.capUsd,
                            })
                          }
                        >
                          Set test cap to ${preparedCapability.capUsd.toFixed(2)}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void runPreparedCapabilityTest()}
                      disabled={
                        preparedCapability.capUsd >
                          settings.maxSpendUsd + 0.000001 ||
                        !adultContentAcknowledged ||
                        capabilityTestStatus === "running" ||
                        capabilityTestStatus === "queued"
                      }
                    >
                      Run one test · no retry/fallback
                    </button>
                  </div>
                ) : null}

                {capabilityTestMessage ? (
                  <p className="model-mixer-capability-message">
                    {capabilityTestMessage}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          <div className="model-mixer-capability-lab">
            <div className="model-mixer-capability-lab-head">
              <div>
                <strong>Quality benchmark showdown</strong>
                <span>
                  Z-Image Turbo vs Nano Banana Pro · identical SFW prompts · prepared only.
                </span>
              </div>
            </div>

            {benchmarkPreparationError ? (
              <p className="model-mixer-content-error">
                {benchmarkPreparationError}
              </p>
            ) : null}

            {benchmarkPreparation ? (
              <>
                <div className="model-mixer-capability-route-summary">
                  {benchmarkPreparation.routes.map((route) => (
                    <span key={route.model}>
                      <small>{route.model.replace(/^fal-ai\//, "")}</small>
                      <strong>
                        {route.available &&
                        route.estimatedCostPerImageUsd !== null &&
                        route.estimatedSuiteCostUsd !== null
                          ? `${route.estimatedCostPerImageUsd.toFixed(3)} / image · ${route.estimatedSuiteCostUsd.toFixed(3)} suite`
                          : "Live price unavailable"}
                      </strong>
                    </span>
                  ))}
                  <span>
                    <small>Planned generations</small>
                    <strong>{benchmarkPreparation.imageCount} total</strong>
                  </span>
                  <span>
                    <small>Estimated provider total</small>
                    <strong>
                      ${benchmarkPreparation.estimatedTotalCostUsd.toFixed(3)}
                    </strong>
                  </span>
                  <span>
                    <small>Safe maximum approval</small>
                    <strong>${benchmarkPreparation.safeTotalCapUsd.toFixed(2)}</strong>
                  </span>
                </div>

                <small className="model-mixer-capability-scope">
                  Preparing this benchmark makes no paid generation calls. The planned run is
                  three exact prompts per route with no retry, fallback, or model substitution.
                </small>

                <div className="model-mixer-capability-prepared">
                  <strong>Benchmark cases</strong>
                  {benchmarkPreparation.cases.map((testCase, index) => (
                    <details key={testCase.id}>
                      <summary>
                        {index + 1}. {testCase.label}
                      </summary>
                      <small>{testCase.prompt}</small>
                    </details>
                  ))}
                </div>

                <p className="model-mixer-capability-message">
                  No benchmark run has started. Execution should require a separate explicit
                  approval for the ${benchmarkPreparation.safeTotalCapUsd.toFixed(2)} safe
                  maximum.
                </p>
              </>
            ) : (
              <small className="model-mixer-capability-scope">
                Loading current benchmark pricing…
              </small>
            )}
          </div>

          <div className="model-mixer-content-actions">
            <button
              type="button"
              onClick={() => void saveMediaContentPreference()}
              disabled={
                !mediaPreferenceLoaded ||
                mediaPreferenceSaving ||
                (nsfwEnabled && !adultContentAcknowledged)
              }
            >
              {mediaPreferenceSaving ? "Saving…" : "Save preference"}
            </button>
            <a href="/api/inference/media/capabilities" target="_blank" rel="noreferrer">
              View capability data
            </a>
          </div>

          {mediaPreferenceError ? (
            <small className="model-mixer-content-error">
              {mediaPreferenceError}
            </small>
          ) : null}
        </div>

        <div className="model-mixer-funding-note">
          <strong>Media provider order</strong>
          <span>
            {mediaCatalog?.configured.nous
              ? "Nous subscription/tool credits first"
              : "Nous not currently available"}
            {" → "}owned/local or zero-provider-cost hosted capacity when capable
            {" → "}
            {mediaCatalog?.configured.openRouter
              ? "paid OpenRouter backup"
              : "paid OpenRouter backup not connected"}. The request cap is a hard ceiling;
            CoOperative does not raise it automatically.
          </span>
          <small>
            CoOperative AI balance: $
            {(mediaCatalog?.availableAiBalanceUsd ?? 0).toFixed(2)}. This balance gates
            CoOperative-funded paid routes; a connected BYOK provider still uses that provider
            account&apos;s own credits.
          </small>
        </div>

        {!paidAiEligible && !mediaCatalog?.configured.nous ? (
          <div className="model-mixer-funding-note">
            <strong>CoOperative-funded paid routing is currently unavailable.</strong>
            <span>
              Free and owned/local routes remain available. Add AI balance to enable
              CoOperative-funded paid fallbacks.
            </span>
            <a href="/balance">Add AI balance</a>
          </div>
        ) : null}

        <div className="model-mixer-note">
          <span className="model-mixer-mini-bars" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p>
            CoOperative builds an execution recipe for each subtask within your selected cap.
            The mixer considers model/provider plus the requested output type, quality, configuration,
            cost, and time. The slider is a quality/cost ceiling for that agent, not a requirement to
            spend at that level. For connected paid media, Nous subscription credits are preferred first,
            owned/local or free capacity is next, and paid OpenRouter is used only as a bounded
            backup. {mediaCatalog
              ? `Media prices are live from Nous/FAL and OpenRouter as of ${new Date(mediaCatalog.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
              : mediaCatalogError
                ? "Live media pricing is temporarily unavailable, so CoOperative will not assume an unverified paid route is affordable."
                : "Loading live media pricing…"}
          </p>
        </div>

        {mediaCatalog && !mediaCatalog.configured.openRouter ? (
          <div className="model-mixer-funding-note">
            <strong>OpenRouter generation key is not connected yet.</strong>
            <span>
              The live public catalog can still be shown. Connect OpenRouter once under{" "}
              <a href="/services">Services</a>; CoOperative stores the API key in its encrypted
              server-side vault and uses it for image/video generation.
            </span>
          </div>
        ) : null}
      </aside>
    </>
  );
}
