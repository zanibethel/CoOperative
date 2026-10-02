"use client";

export type ModelMixerAgent =
  | "research"
  | "planner"
  | "builder"
  | "verifier"
  | "media";

export type ModelMixerLevel = 0 | 1 | 2 | 3 | 4;
export type ModelMixerPreset = "economy" | "balanced" | "premium" | "custom";

export type ModelMixerSettings = {
  preset: ModelMixerPreset;
  maxSpendUsd: number;
  agents: Record<ModelMixerAgent, ModelMixerLevel>;
};

type ModelMixerProps = {
  open: boolean;
  settings: ModelMixerSettings;
  paidAiEligible: boolean;
  onChange: (settings: ModelMixerSettings) => void;
  onClose: () => void;
};

const LEVELS = ["Free", "Low", "Balanced", "High", "Premium"] as const;

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
    maxSpendUsd: 0.25,
    agents: {
      research: 0,
      planner: 1,
      builder: 1,
      verifier: 1,
      media: 0,
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
  preset: "balanced",
  ...PRESETS.balanced,
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
  onChange,
  onClose,
}: ModelMixerProps) {
  if (!open) return null;

  const estimate = estimateModelMixer(settings);

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
                    {agent.modelMix[level].map((model) => (
                      <span key={model}>{model}</span>
                    ))}
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
          </label>
        </div>

        {!paidAiEligible ? (
          <div className="model-mixer-funding-note">
            <strong>Paid routing is currently unavailable.</strong>
            <span>
              Free and owned/local routes remain available. Paid portions will activate only when
              the profile has funded AI balance and a connected paid executor.
            </span>
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
            level. Cost values are planning estimates until live provider pricing is synced.
          </p>
        </div>
      </aside>
    </>
  );
}
