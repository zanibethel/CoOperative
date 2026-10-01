import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { unisonNodeHeartbeatSchema } from "@/lib/unison/contracts";

export const runtime = "nodejs";
export const maxDuration = 30;

function nodeAuthorized(request: Request) {
  const expected =
    process.env.UNISON_NODE_SHARED_SECRET ||
    process.env.INFERENCE_LOCAL_TOKEN;

  return Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!nodeAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = unisonNodeHeartbeatSchema.parse(await request.json());
    const now = new Date().toISOString();
    const supabase = createAdminSupabaseClient();

    const { error } = await supabase.from("unison_nodes").upsert(
      {
        id: input.nodeId,
        display_name: input.displayName,
        owner_ref: input.ownerRef,
        node_class: input.nodeClass,
        state: input.state,
        platform: input.platform,
        capabilities: input.capabilities,
        resources: input.resources,
        policy: input.policy,
        worker_version: input.workerVersion,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "id" },
    );

    if (error) throw error;

    return NextResponse.json(
      {
        ok: true,
        nodeId: input.nodeId,
        state: input.state,
        serverTime: now,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not record Unison node heartbeat.";

    console.error("Unison node heartbeat failed", { detail: detail.slice(0, 800) });

    return NextResponse.json(
      { error: "Could not record Unison node heartbeat.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
