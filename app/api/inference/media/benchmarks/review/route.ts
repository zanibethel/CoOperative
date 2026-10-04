import { NextResponse } from "next/server";
import { z } from "zod";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  MEDIA_QUALITY_BENCHMARK_CASES,
  MEDIA_QUALITY_BENCHMARK_SUITE,
} from "@/lib/inference/media-quality-benchmark";
import {
  mediaBenchmarkEvidenceForOwner,
  mediaBenchmarkSummaryForRoute,
} from "@/lib/inference/media-model-benchmarks";

export const runtime = "nodejs";
export const maxDuration = 30;

const reviewDimensionSchema = z.enum([
  "visual_quality",
  "prompt_adherence",
  "anatomy",
]);
type ReviewDimension = z.infer<typeof reviewDimensionSchema>;

const reviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        sourceJobId: z.string().uuid(),
        scores: z.object({
          visual_quality: z.number().min(0).max(100).optional(),
          prompt_adherence: z.number().min(0).max(100).optional(),
          anatomy: z.number().min(0).max(100).optional(),
        }),
      }),
    )
    .min(1)
    .max(12),
});

function ownerRef(userId: string) {
  return `coop-user:${userId}`;
}

function reviewableDimensions(caseId: string): ReviewDimension[] {
  const testCase = MEDIA_QUALITY_BENCHMARK_CASES.find((item) => item.id === caseId);
  if (!testCase) return [];
  return testCase.primaryDimensions.filter(
    (dimension) => dimension !== "speed",
  ) as ReviewDimension[];
}

async function scorecardsForOwner(owner: string) {
  const evidence = await mediaBenchmarkEvidenceForOwner(owner);
  return {
    zImageTurbo: mediaBenchmarkSummaryForRoute(evidence, {
      provider: "nous",
      model: "fal-ai/z-image/turbo",
      endpoint: "",
    }),
    nanoBananaPro: mediaBenchmarkSummaryForRoute(evidence, {
      provider: "nous",
      model: "fal-ai/nano-banana-pro",
      endpoint: "",
    }),
  };
}

export async function GET() {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const owner = ownerRef(userId);
  const admin = createAdminSupabaseClient();

  const { data: jobs, error: jobsError } = await admin
    .from("media_generation_jobs")
    .select(
      "id,status,provider,model,prompt,result_url,error,estimated_provider_cost_microusd,pricing_dimensions,created_at,completed_at",
    )
    .eq("owner_ref", owner)
    .eq("status", "completed")
    .contains("pricing_dimensions", { benchmarkSuite: MEDIA_QUALITY_BENCHMARK_SUITE })
    .order("created_at", { ascending: true });

  if (jobsError) throw jobsError;

  const jobIds = (jobs || []).map((job) => job.id);
  let reviewRows: Array<{
    source_job_id: string | null;
    dimension: string;
    score: number | string | null;
    measured_at: string;
  }> = [];

  if (jobIds.length) {
    const { data, error } = await admin
      .from("media_model_benchmarks")
      .select("source_job_id,dimension,score,measured_at")
      .eq("owner_ref", owner)
      .eq("benchmark_suite", MEDIA_QUALITY_BENCHMARK_SUITE)
      .eq("source_type", "manual_review")
      .in("source_job_id", jobIds)
      .order("measured_at", { ascending: false });
    if (error) throw error;
    reviewRows = data || [];
  }

  const latestScores = new Map<string, number>();
  for (const row of reviewRows) {
    if (!row.source_job_id || row.score === null) continue;
    const key = `${row.source_job_id}|${row.dimension}`;
    if (latestScores.has(key)) continue;
    latestScores.set(key, Number(row.score));
  }

  const cases = MEDIA_QUALITY_BENCHMARK_CASES.map((testCase) => ({
    id: testCase.id,
    label: testCase.label,
    prompt: testCase.prompt,
    evaluation: testCase.evaluation,
    reviewableDimensions: reviewableDimensions(testCase.id),
    results: (jobs || [])
      .filter((job) => {
        const dims =
          job.pricing_dimensions && typeof job.pricing_dimensions === "object"
            ? (job.pricing_dimensions as Record<string, unknown>)
            : {};
        return dims.benchmarkCaseId === testCase.id;
      })
      .map((job) => ({
        jobId: job.id,
        provider: job.provider,
        model: job.model,
        resultUrl: job.result_url,
        estimatedCostUsd:
          typeof job.estimated_provider_cost_microusd === "number"
            ? job.estimated_provider_cost_microusd / 1_000_000
            : Number(job.estimated_provider_cost_microusd || 0) / 1_000_000,
        completedAt: job.completed_at,
        scores: Object.fromEntries(
          reviewableDimensions(testCase.id).map((dimension) => [
            dimension,
            latestScores.get(`${job.id}|${dimension}`) ?? null,
          ]),
        ),
      })),
  }));

  return NextResponse.json(
    {
      suite: MEDIA_QUALITY_BENCHMARK_SUITE,
      cases,
      scorecards: await scorecardsForOwner(owner),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid benchmark review.", detail: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const owner = ownerRef(userId);
  const admin = createAdminSupabaseClient();
  const sourceJobIds = [...new Set(parsed.data.reviews.map((review) => review.sourceJobId))];

  const { data: jobs, error: jobsError } = await admin
    .from("media_generation_jobs")
    .select("id,status,provider,model,pricing_dimensions")
    .eq("owner_ref", owner)
    .in("id", sourceJobIds);
  if (jobsError) throw jobsError;

  const jobsById = new Map((jobs || []).map((job) => [job.id, job]));
  const inserts: Array<Record<string, unknown>> = [];
  const measuredAt = new Date().toISOString();

  for (const review of parsed.data.reviews) {
    const job = jobsById.get(review.sourceJobId);
    if (!job || job.status !== "completed") {
      return NextResponse.json(
        { error: "Benchmark source job is missing or incomplete." },
        { status: 409 },
      );
    }

    const pricing =
      job.pricing_dimensions && typeof job.pricing_dimensions === "object"
        ? (job.pricing_dimensions as Record<string, unknown>)
        : {};
    const caseId =
      typeof pricing.benchmarkCaseId === "string" ? pricing.benchmarkCaseId : "";
    if (pricing.benchmarkSuite !== MEDIA_QUALITY_BENCHMARK_SUITE || !caseId) {
      return NextResponse.json(
        { error: "Source job is not part of the active benchmark suite." },
        { status: 409 },
      );
    }

    const allowed = new Set(reviewableDimensions(caseId));
    for (const [dimension, score] of Object.entries(review.scores)) {
      if (!allowed.has(dimension as ReviewDimension)) {
        return NextResponse.json(
          { error: `${dimension} is not reviewable for benchmark case ${caseId}.` },
          { status: 400 },
        );
      }

      inserts.push({
        owner_ref: owner,
        provider: job.provider,
        model: job.model,
        endpoint: "",
        benchmark_suite: MEDIA_QUALITY_BENCHMARK_SUITE,
        dimension,
        score,
        status: "measured",
        measurement: {
          benchmarkCaseId: caseId,
          reviewer: "owner",
          scale: "0-100",
        },
        source_type: "manual_review",
        source_job_id: job.id,
        notes: "Owner review from Model Mixer benchmark comparison.",
        measured_at: measuredAt,
      });
    }
  }

  if (!inserts.length) {
    return NextResponse.json(
      { error: "No benchmark scores were supplied." },
      { status: 400 },
    );
  }

  const { error: insertError } = await admin
    .from("media_model_benchmarks")
    .insert(inserts);
  if (insertError) throw insertError;

  return NextResponse.json(
    {
      saved: inserts.length,
      scorecards: await scorecardsForOwner(owner),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
