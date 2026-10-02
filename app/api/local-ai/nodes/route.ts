import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin
      .from("unison_nodes")
      .select("id,display_name,state,platform,capabilities,policy,worker_version,last_seen_at")
      .eq("contributor_user_id", userId)
      .order("last_seen_at", { ascending: false });

    if (error) throw error;

    const freshAfter = Date.now() - 90_000;
    const nodes = (data || []).map((node) => {
      const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
      const policy =
        node.policy && typeof node.policy === "object"
          ? (node.policy as { allowText?: unknown })
          : {};
      const seenAt = Date.parse(node.last_seen_at || "");
      const fresh = Number.isFinite(seenAt) && seenAt >= freshAfter;
      const textCapable =
        capabilities.includes("text_generation") && policy.allowText !== false;
      const personalAiCapable =
        textCapable && capabilities.includes("local_personal_chat");

      return {
        id: node.id,
        displayName: node.display_name,
        state: node.state,
        platform: node.platform,
        workerVersion: node.worker_version,
        lastSeenAt: node.last_seen_at,
        fresh,
        textCapable,
        personalAiCapable,
        availableForText: fresh && textCapable && node.state !== "paused",
        availableForPersonalAi:
          fresh && personalAiCapable && node.state !== "paused",
      };
    });

    return NextResponse.json(
      { nodes },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not load owned Unison nodes.";
    return NextResponse.json(
      { error: "Could not load owned Unison nodes.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
