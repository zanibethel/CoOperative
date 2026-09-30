import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function workerAuthorized(request: Request) {
  const expected = process.env.INFERENCE_LOCAL_TOKEN;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

async function countStatus(
  table: "inference_jobs" | "text_inference_jobs",
  status: string,
) {
  const supabase = createAdminSupabaseClient();
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (error) throw error;
  return count || 0;
}

async function oldestQueuedAt(
  table: "inference_jobs" | "text_inference_jobs",
) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from(table)
    .select("created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.created_at || null;
}

export async function GET(request: Request) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [
      imageQueued,
      imageRunning,
      textQueued,
      textRunning,
      imageOldestQueuedAt,
      textOldestQueuedAt,
    ] = await Promise.all([
      countStatus("inference_jobs", "queued"),
      countStatus("inference_jobs", "running"),
      countStatus("text_inference_jobs", "queued"),
      countStatus("text_inference_jobs", "running"),
      oldestQueuedAt("inference_jobs"),
      oldestQueuedAt("text_inference_jobs"),
    ]);

    return NextResponse.json(
      {
        image: {
          queued: imageQueued,
          running: imageRunning,
          oldestQueuedAt: imageOldestQueuedAt,
        },
        text: {
          queued: textQueued,
          running: textRunning,
          oldestQueuedAt: textOldestQueuedAt,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read local inference queue state.";
    return NextResponse.json(
      { error: "Could not read local inference queue state.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
