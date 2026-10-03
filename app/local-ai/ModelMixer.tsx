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
const MEDIA_CONTENT_OPTIONS: Array<{
  value: MediaContentPreference;
  label: string;
  description: string;
}> = [
  {
    value: "sfw_only",
    label: "SFW only",
    description: "Keep media compatibility focused on models appropriate for general-audience content.",
  },
  {
    value: "adult_allowed",
    label: "Adult content allowed",
    description: "Allow adult-capable models to be considered when a future request requires them.",
  },
  {
    value: "prefer_adult_capable",
    label: "Prefer adult-capable models",
    description: "When otherwise comparable, future routing may prefer models that can support both SFW and adult workflows.",
  },
  {
    value: "require_adult_capable",
    label: "Require adult-capable models",
    description: "Future media routing may exclude models that are not verified for adult-capable workflows.",
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

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setMediaPreferenceError("");
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

  const selectedMediaContentOption =
    MEDIA_CONTENT_OPTIONS.find(
      (option) => option.value === mediaContentPreference,
    ) || MEDIA_CONTENT_OPTIONS[0];

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
              <strong>Media content compatibility</strong>
              <span>
                Profile preference only for now. This update does not change routing yet.
              </span>
            </div>
            <small>18+ options require acknowledgment</small>
          </div>

          <label className="model-mixer-content-select">
            <span>Preference</span>
            <select
              value={mediaContentPreference}
              disabled={!mediaPreferenceLoaded || mediaPreferenceSaving}
              onChange={(event) => {
                const next = event.target.value as MediaContentPreference;
                setMediaContentPreference(next);
                if (next === "sfw_only") {
                  setAdultContentAcknowledged(false);
                }
                setMediaPreferenceError("");
              }}
            >
              {MEDIA_CONTENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <p>{selectedMediaContentOption.description}</p>

          {mediaContentPreference !== "sfw_only" ? (
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
              <span>
                I confirm I am 18+. This preference only affects future model
                compatibility/routing; provider rules and safety boundaries still apply.
              </span>
            </label>
          ) : null}

          <div className="model-mixer-content-actions">
            <button
              type="button"
              onClick={() => void saveMediaContentPreference()}
              disabled={
                !mediaPreferenceLoaded ||
                mediaPreferenceSaving ||
                (mediaContentPreference !== "sfw_only" &&
                  !adultContentAcknowledged)
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
            CoOperative routes each subtask to the cheapest capable model within your selected cap.
            The slider is a quality/cost ceiling for that agent, not a requirement to spend at that
            level. For connected paid media, Nous subscription credits are preferred first,
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
