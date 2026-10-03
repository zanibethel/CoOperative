import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import {
  MEDIA_QUALITY_BENCHMARK_CASES,
  MEDIA_QUALITY_BENCHMARK_SUITE,
  prepareMediaQualityBenchmark,
} from "@/lib/inference/media-quality-benchmark";
import {
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";

export const runtime = "nodejs";
export const maxDuration = 300;

const KEY_SHA256 = "0de29d4023bb71cff026830e8d76d6e370dffa7f84c760a71a04c27a0f7cc9c9";
const APPROVED_TOTAL_CAP_USD = 0.48;
const ALLOWED_MODELS = new Set([
  "fal-ai/z-image/turbo",
  "fal-ai/nano-banana-pro",
]);

async function ownerRef() {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("unison_platform_owners")
    .select("user_id")
    .limit(1)
    .single();
  if (error) throw error;
  return `coop-user:${data.user_id}`;
}

async function validKey(value: string | null) {
  if (!value) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex === KEY_SHA256;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!(await validKey(url.searchParams.get("key")))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const action = url.searchParams.get("action") || "status";
  const admin = createAdminSupabaseClient();
  const owner = await ownerRef();

  if (action === "status") {
    const { data, error } = await admin
      .from("media_generation_jobs")
      .select("id,status,provider,model,prompt,result_url,error,started_at,completed_at,created_at,pricing_dimensions")
      .eq("owner_ref", owner)
      .contains("pricing_dimensions", { benchmarkSuite: MEDIA_QUALITY_BENCHMARK_SUITE })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ jobs: data || [] }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "start") {
    const model = url.searchParams.get("model") || "";
    const caseId = url.searchParams.get("case") || "";
    if (!ALLOWED_MODELS.has(model)) {
      return NextResponse.json({ error: "Model not allowed." }, { status: 400 });
    }
    const testCase = MEDIA_QUALITY_BENCHMARK_CASES.find((item) => item.id === caseId);
    if (!testCase) {
      return NextResponse.json({ error: "Benchmark case not found." }, { status: 400 });
    }

    const plan = await prepareMediaQualityBenchmark();
    if (plan.safeTotalCapUsd > APPROVED_TOTAL_CAP_USD + 0.000001) {
      return NextResponse.json(
        {
          error: "Current live benchmark ceiling exceeds approved total.",
          approvedTotalCapUsd: APPROVED_TOTAL_CAP_USD,
          currentSafeTotalCapUsd: plan.safeTotalCapUsd,
        },
        { status: 409 },
      );
    }
    const route = plan.routes.find((item) => item.model === model && item.available);
    if (
      !route ||
      route.safeCapPerImageUsd === null ||
      route.estimatedCostPerImageUsd === null
    ) {
      return NextResponse.json({ error: "Exact route is not currently live-priced." }, { status: 409 });
    }

    const { data: existing, error: existingError } = await admin
      .from("media_generation_jobs")
      .select("id,status,provider,model,result_url,error,started_at,completed_at,pricing_dimensions")
      .eq("owner_ref", owner)
      .eq("provider", "nous")
      .eq("model", model)
      .contains("pricing_dimensions", {
        benchmarkSuite: MEDIA_QUALITY_BENCHMARK_SUITE,
        benchmarkCaseId: caseId,
      })
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return NextResponse.json({ existing: true, job: existing }, { headers: { "Cache-Control": "no-store" } });
    }

    const auth = await freshNousRuntimeAuthForOwner(owner);
    if (!auth?.sandboxAuthJson) {
      return NextResponse.json({ error: "Nous Portal authorization is unavailable." }, { status: 409 });
    }

    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error: insertError } = await admin.from("media_generation_jobs").insert({
      id: jobId,
      status: "queued",
      owner_ref: owner,
      conversation_id: null,
      kind: "image",
      prompt: testCase.prompt,
      provider: "nous",
      model,
      model_mixer: null,
      request_max_spend_microusd: Math.round(route.safeCapPerImageUsd * 1_000_000),
      media_level: 1,
      estimated_provider_cost_microusd: Math.round(route.estimatedCostPerImageUsd * 1_000_000),
      estimated_user_charge_microusd: 0,
      estimated_infrastructure_cost_microusd: null,
      estimated_margin_microusd: null,
      provider_cost_bearer: "user-connected",
      pricing_dimensions: {
        benchmarkTest: true,
        benchmarkSuite: MEDIA_QUALITY_BENCHMARK_SUITE,
        benchmarkCaseId: caseId,
        noRetry: true,
        noFallback: true,
        exactPrompt: true,
        approvedTotalCapUsd: APPROVED_TOTAL_CAP_USD,
      },
      pricing_source: route.pricingSource,
      created_at: now,
      updated_at: now,
    });
    if (insertError) throw insertError;

    try {
      const started = await startHermesMediaTask({
        jobId,
        kind: "image",
        userRequest: testCase.prompt,
        provider: "nous",
        model,
        nousAuthJson: auth.sandboxAuthJson,
        benchmarkTest: true,
      });

      const { error: startError } = await admin
        .from("media_generation_jobs")
        .update({
          status: "running",
          sandbox_name: started.sandboxName,
          started_at: started.startedAt,
          deadline_at: started.deadlineAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("owner_ref", owner);
      if (startError) throw startError;

      return NextResponse.json({
        jobId,
        status: "running",
        model,
        caseId,
        estimatedCostUsd: route.estimatedCostPerImageUsd,
        capUsd: route.safeCapPerImageUsd,
      }, { status: 202, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Benchmark could not start.";
      const completedAt = new Date().toISOString();
      await admin
        .from("media_generation_jobs")
        .update({
          status: "failed",
          error: detail.slice(0, 1200),
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq("id", jobId)
        .eq("owner_ref", owner);
      return NextResponse.json({ jobId, status: "failed", error: detail }, { status: 200 });
    }
  }

  if (action === "poll") {
    const jobId = url.searchParams.get("jobId") || "";
    const { data: job, error } = await admin
      .from("media_generation_jobs")
      .select("id,status,owner_ref,provider,model,sandbox_name,result_url,usage,error,started_at,deadline_at,completed_at,pricing_dimensions")
      .eq("id", jobId)
      .eq("owner_ref", owner)
      .maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    const dims = job.pricing_dimensions && typeof job.pricing_dimensions === "object"
      ? job.pricing_dimensions as Record<string, unknown>
      : {};
    if (dims.benchmarkSuite !== MEDIA_QUALITY_BENCHMARK_SUITE) {
      return NextResponse.json({ error: "Not a benchmark job." }, { status: 400 });
    }

    if (job.status === "running" && job.sandbox_name && job.deadline_at) {
      const polled = await pollHermesMediaTask({
        sandboxName: job.sandbox_name,
        deadlineAt: job.deadline_at,
      });
      if (polled.state !== "running") {
        const completedAt = new Date().toISOString();
        await admin
          .from("media_generation_jobs")
          .update({
            status: polled.state,
            result_url: polled.mediaUrl,
            usage: polled.usage,
            error: polled.error,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", job.id)
          .eq("owner_ref", owner);
        return NextResponse.json({
          jobId: job.id,
          status: polled.state,
          model: job.model,
          caseId: dims.benchmarkCaseId || null,
          mediaUrl: polled.mediaUrl,
          error: polled.error,
          startedAt: job.started_at,
          completedAt,
        }, { headers: { "Cache-Control": "no-store" } });
      }
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      model: job.model,
      caseId: dims.benchmarkCaseId || null,
      mediaUrl: job.result_url,
      error: job.error,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
