import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());

    if (!(await authorizeUnisonNode(request, input.nodeId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminSupabaseClient();
    const { data: node, error } = await admin
      .from("unison_nodes")
      .select("id,state,worker_version,last_seen_at,platform,resources,capabilities")
      .eq("id", input.nodeId)
      .maybeSingle();

    if (error) throw error;
    if (!node) {
      return NextResponse.json({ error: "Node not found." }, { status: 404 });
    }

    const lastSeenMs = Date.parse(node.last_seen_at);
    const fresh =
      Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs <= 90_000;

    return NextResponse.json(
      {
        nodeId: node.id,
        state: fresh ? node.state : "offline",
        workerVersion: node.worker_version,
        lastSeenAt: node.last_seen_at,
        fresh,
        platform: node.platform,
        resources: node.resources,
        capabilities: node.capabilities,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read node status.";

    return NextResponse.json(
      { error: "Could not read node status.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
