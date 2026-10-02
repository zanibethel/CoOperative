import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { activeNodeIds } from "@/lib/unison/node-access";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export type OwnedTextNodePreference = {
  id: string;
  displayName: string | null;
};

export function userIdFromOwnerRef(ownerRef: string | null | undefined) {
  if (!ownerRef?.startsWith("coop-user:")) return null;
  const userId = ownerRef.slice("coop-user:".length).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    userId,
  )
    ? userId
    : null;
}

export async function preferredOwnedTextNode(
  admin: AdminClient,
  userId: string,
): Promise<OwnedTextNodePreference | null> {
  const nodeIds = await activeNodeIds(admin, userId);
  if (nodeIds.length === 0) return null;

  const { data, error } = await admin
    .from("unison_nodes")
    .select("id,display_name,state,capabilities,policy,last_seen_at")
    .in("id", nodeIds)
    .order("last_seen_at", { ascending: false });

  if (error) throw error;

  const freshAfter = Date.now() - 90_000;
  const statePriority: Record<string, number> = {
    idle: 0,
    online: 1,
    busy: 2,
  };

  const candidates = (data || []).filter((node) => {
    const capabilities = Array.isArray(node.capabilities) ? node.capabilities : [];
    const policy =
      node.policy && typeof node.policy === "object"
        ? (node.policy as { allowText?: unknown })
        : {};
    const seenAt = Date.parse(node.last_seen_at || "");

    return (
      capabilities.includes("text_generation") &&
      policy.allowText !== false &&
      node.state !== "paused" &&
      Number.isFinite(seenAt) &&
      seenAt >= freshAfter
    );
  });

  candidates.sort(
    (a, b) =>
      (statePriority[a.state] ?? 9) - (statePriority[b.state] ?? 9) ||
      Date.parse(b.last_seen_at || "") - Date.parse(a.last_seen_at || ""),
  );

  const selected = candidates[0];
  return selected
    ? { id: selected.id, displayName: selected.display_name || null }
    : null;
}
