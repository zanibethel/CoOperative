import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase
      .from("unison_nodes")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const now = Date.now();
    const nodes = (data || []).map((node) => {
      const lastSeenMs = Date.parse(node.last_seen_at);
      const stale = !Number.isFinite(lastSeenMs) || now - lastSeenMs > 90_000;

      return {
        nodeId: node.id,
        displayName: node.display_name,
        ownerRef: node.owner_ref,
        nodeClass: node.node_class,
        state: stale ? "offline" : node.state,
        platform: node.platform,
        capabilities: node.capabilities,
        resources: node.resources,
        policy: node.policy,
        workerVersion: node.worker_version,
        lastSeenAt: node.last_seen_at,
        firstSeenAt: node.first_seen_at,
      };
    });

    return NextResponse.json(
      { nodes, online: nodes.filter((node) => node.state !== "offline").length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read Unison nodes.";

    return NextResponse.json(
      { error: "Could not read Unison nodes.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
