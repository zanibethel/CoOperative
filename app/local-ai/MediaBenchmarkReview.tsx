"use client";

import { useEffect, useMemo, useState } from "react";

type ReviewDimension = "visual_quality" | "prompt_adherence" | "anatomy";

type BenchmarkResult = {
  jobId: string;
  provider: string;
  model: string;
  resultUrl: string | null;
  estimatedCostUsd: number;
  completedAt: string | null;
  scores: Partial<Record<ReviewDimension, number | null>>;
};

type BenchmarkCase = {
  id: string;
  label: string;
  prompt: string;
  evaluation: string[];
  reviewableDimensions: ReviewDimension[];
  results: BenchmarkResult[];
};

type RouteSummary = {
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

type BenchmarkReviewPayload = {
  suite: string;
  cases: BenchmarkCase[];
  scorecards: {
    zImageTurbo: RouteSummary;
    nanoBananaPro: RouteSummary;
  };
  error?: string;
  detail?: string;
};

const DIMENSION_LABELS: Record<ReviewDimension, string> = {
  visual_quality: "Visual quality",
  prompt_adherence: "Prompt adherence",
  anatomy: "Anatomy / hands",
};

function scoreKey(jobId: string, dimension: ReviewDimension) {
  return jobId + ":" + dimension;
}

function modelLabel(model: string) {
  if (model === "fal-ai/z-image/turbo") return "Z-Image Turbo";
  if (model === "fal-ai/nano-banana-pro") return "Nano Banana Pro";
  return model.replace(/^fal-ai\//, "");
}

function scoreLabel(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value) + "/100"
    : "Not scored";
}

export default function MediaBenchmarkReview() {
  const [payload, setPayload] = useState<BenchmarkReviewPayload | null>(null);
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/inference/media/benchmarks/review", {
        cache: "no-store",
      });
      const next = (await response.json()) as BenchmarkReviewPayload;
      if (!response.ok) {
        throw new Error(next.detail || next.error || "Could not load benchmark review.");
      }

      const nextScores: Record<string, number | null> = {};
      for (const testCase of next.cases) {
        for (const result of testCase.results) {
          for (const dimension of testCase.reviewableDimensions) {
            nextScores[scoreKey(result.jobId, dimension)] =
              result.scores[dimension] ?? null;
          }
        }
      }
      setPayload(next);
      setScores(nextScores);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load benchmark review.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const scoredCount = useMemo(
    () => Object.values(scores).filter((value) => typeof value === "number").length,
    [scores],
  );
  const totalCount = useMemo(() => Object.keys(scores).length, [scores]);

  function setScore(jobId: string, dimension: ReviewDimension, value: number | null) {
    setScores((current) => ({
      ...current,
      [scoreKey(jobId, dimension)]:
        value === null ? null : Math.min(100, Math.max(0, Math.round(value))),
    }));
    setMessage("");
  }

  async function save() {
    if (!payload || saving) return;

    const reviews = payload.cases.flatMap((testCase) =>
      testCase.results
        .map((result) => {
          const entries = testCase.reviewableDimensions
            .map((dimension) => [
              dimension,
              scores[scoreKey(result.jobId, dimension)],
            ] as const)
            .filter((entry): entry is [ReviewDimension, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1]),
            );

          return {
            sourceJobId: result.jobId,
            scores: Object.fromEntries(entries),
          };
        })
        .filter((review) => Object.keys(review.scores).length > 0),
    );

    if (!reviews.length) {
      setMessage("Score at least one benchmark dimension before saving.");
      return;
    }

    setSaving(true);
    setMessage("Saving benchmark evidence…");
    try {
      const response = await fetch("/api/inference/media/benchmarks/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews }),
      });
      const result = (await response.json()) as {
        saved?: number;
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        throw new Error(result.detail || result.error || "Could not save benchmark scores.");
      }
      setMessage(
        "Saved " +
          (result.saved || 0) +
          " evidence scores. Model routing now uses the reviewed results.",
      );
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save benchmark scores.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) {
    return (
      <div className="benchmark-review">
        <small>Loading completed benchmark images…</small>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="benchmark-review">
        <p className="model-mixer-content-error">{message || "Benchmark review unavailable."}</p>
        <button type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="benchmark-review">
      <div className="benchmark-review-head">
        <div>
          <strong>Benchmark Review</strong>
          <span>
            Compare the exact outputs side-by-side. Saved scores become routing evidence.
          </span>
        </div>
        <small>
          {scoredCount}/{totalCount} scores filled
        </small>
      </div>

      <div className="benchmark-route-scorecards">
        <div>
          <strong>Z-Image Turbo</strong>
          <span>Visual {scoreLabel(payload.scorecards.zImageTurbo.dimensions.visualQuality)}</span>
          <span>Prompt {scoreLabel(payload.scorecards.zImageTurbo.dimensions.promptAdherence)}</span>
          <span>Anatomy {scoreLabel(payload.scorecards.zImageTurbo.dimensions.anatomy)}</span>
        </div>
        <div>
          <strong>Nano Banana Pro</strong>
          <span>Visual {scoreLabel(payload.scorecards.nanoBananaPro.dimensions.visualQuality)}</span>
          <span>Prompt {scoreLabel(payload.scorecards.nanoBananaPro.dimensions.promptAdherence)}</span>
          <span>Anatomy {scoreLabel(payload.scorecards.nanoBananaPro.dimensions.anatomy)}</span>
        </div>
      </div>

      {payload.cases.map((testCase, index) => (
        <section className="benchmark-case" key={testCase.id}>
          <div className="benchmark-case-head">
            <div>
              <small>Test {index + 1}</small>
              <strong>{testCase.label}</strong>
            </div>
            <details>
              <summary>Prompt + scoring criteria</summary>
              <p>{testCase.prompt}</p>
              <ul>
                {testCase.evaluation.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </details>
          </div>

          <div className="benchmark-pair">
            {testCase.results.map((result) => (
              <article className="benchmark-result-card" key={result.jobId}>
                <div className="benchmark-result-head">
                  <div>
                    <strong>{modelLabel(result.model)}</strong>
                    <small>
                      {"~$" + result.estimatedCostUsd.toFixed(3) + " this generation"}
                    </small>
                  </div>
                  {result.resultUrl ? (
                    <a href={result.resultUrl} target="_blank" rel="noreferrer">
                      Full image ↗
                    </a>
                  ) : null}
                </div>

                {result.resultUrl ? (
                  <a
                    className="benchmark-image-link"
                    href={result.resultUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={"Open full " + modelLabel(result.model) + " benchmark image"}
                  >
                    <img
                      className="benchmark-image"
                      src={result.resultUrl}
                      alt={modelLabel(result.model) + " output for " + testCase.label}
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <div className="benchmark-image-missing">Result image unavailable</div>
                )}

                <div className="benchmark-score-list">
                  {testCase.reviewableDimensions.map((dimension) => {
                    const key = scoreKey(result.jobId, dimension);
                    const score = scores[key];
                    const enabled = typeof score === "number";

                    return (
                      <div className="benchmark-score" key={dimension}>
                        <div className="benchmark-score-head">
                          <strong>{DIMENSION_LABELS[dimension]}</strong>
                          <button
                            type="button"
                            onClick={() =>
                              setScore(result.jobId, dimension, enabled ? null : 80)
                            }
                          >
                            {enabled ? score + "/100" : "Score"}
                          </button>
                        </div>
                        {enabled ? (
                          <div className="benchmark-score-control">
                            <input
                              type="range"
                              min="0"
                              max="100"
                              step="1"
                              value={score}
                              onChange={(event) =>
                                setScore(
                                  result.jobId,
                                  dimension,
                                  Number(event.target.value),
                                )
                              }
                              aria-label={
                                modelLabel(result.model) +
                                " " +
                                DIMENSION_LABELS[dimension] +
                                " score"
                              }
                            />
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="1"
                              value={score}
                              onChange={(event) =>
                                setScore(
                                  result.jobId,
                                  dimension,
                                  Number(event.target.value),
                                )
                              }
                              aria-label={
                                modelLabel(result.model) +
                                " " +
                                DIMENSION_LABELS[dimension] +
                                " numeric score"
                              }
                            />
                          </div>
                        ) : (
                          <small>Not scored yet. Tap Score to rate this dimension.</small>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}

      <div className="benchmark-review-actions">
        <button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save benchmark scores"}
        </button>
        <button type="button" onClick={() => void load()} disabled={saving}>
          Reload results
        </button>
      </div>

      {message ? <p className="model-mixer-capability-message">{message}</p> : null}
    </div>
  );
}
