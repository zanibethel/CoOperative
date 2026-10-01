import { NextResponse } from "next/server";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function statusOf(node: {
  state: string;
  last_seen_at: string;
  worker_version: string;
}) {
  if (node.worker_version?.startsWith("startup-failed-")) return "error";

  const lastSeen = Date.parse(node.last_seen_at);
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 90_000) {
    return "offline";
  }
  if (node.worker_version?.startsWith("starting-")) return "starting";
  return node.state;
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get("scope") === "owner" ? "owner" : "mine";
  const admin = createAdminSupabaseClient();

  if (scope === "owner") {
    const { data: owner, error: ownerError } = await admin
      .from("unison_platform_owners")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (ownerError) {
      return NextResponse.json(
        { error: "Could not verify owner access." },
        { status: 502 },
      );
    }

    if (!owner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  let query = admin
    .from("unison_nodes")
    .select(
      "id,display_name,contributor_user_id,node_class,state,platform,resources,capabilities,policy,worker_version,last_seen_at,first_seen_at",
    )
    .order("last_seen_at", { ascending: false });

  if (scope === "mine") {
    query = query.eq("contributor_user_id", userId);
  }

  const { data: nodes, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Could not load live node status." },
      { status: 502 },
    );
  }

  let contributorNames = new Map<string, string>();
  if (scope === "owner") {
    const contributorIds = Array.from(
      new Set(
        (nodes || [])
          .map((node) => node.contributor_user_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (contributorIds.length > 0) {
      const { data: contributors, error: contributorError } = await admin
        .from("unison_contributors")
        .select("user_id,display_name")
        .in("user_id", contributorIds);

      if (contributorError) {
        return NextResponse.json(
          { error: "Could not load contributor names." },
          { status: 502 },
        );
      }

      contributorNames = new Map(
        (contributors || []).map((item) => [item.user_id, item.display_name]),
      );
    }
  }

  const now = Date.now();
  const rows = (nodes || []).map((node) => {
    const lastSeenMs = Date.parse(node.last_seen_at);
    const status = statusOf(node);

    return {
      id: node.id,
      displayName: node.display_name,
      contributorUserId: node.contributor_user_id,
      contributorName: node.contributor_user_id
        ? contributorNames.get(node.contributor_user_id) ?? null
        : null,
      nodeClass: node.node_class,
      status,
      reportedState: node.state,
      workerVersion: node.worker_version,
      lastSeenAt: node.last_seen_at,
      secondsSinceHeartbeat: Number.isFinite(lastSeenMs)
        ? Math.max(0, Math.round((now - lastSeenMs) / 1000))
        : null,
      platform: node.platform,
      resources: node.resources,
      capabilities: node.capabilities,
      policy: node.policy,
      firstSeenAt: node.first_seen_at,
    };
  });

  const counts = {
    total: rows.length,
    online: rows.filter((node) => node.status === "online").length,
    idle: rows.filter((node) => node.status === "idle").length,
    busy: rows.filter((node) => node.status === "busy").length,
    paused: rows.filter((node) => node.status === "paused").length,
    starting: rows.filter((node) => node.status === "starting").length,
    error: rows.filter((node) => node.status === "error").length,
    offline: rows.filter((node) => node.status === "offline").length,
  };

  return NextResponse.json(
    {
      scope,
      serverTime: new Date(now).toISOString(),
      counts,
      nodes: rows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
