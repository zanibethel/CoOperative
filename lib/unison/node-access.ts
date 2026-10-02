import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export type UnisonNodeMembership = {
  nodeId: string;
  role: "owner" | "admin" | "member";
};

export async function activeNodeMemberships(
  admin: AdminClient,
  userId: string,
): Promise<UnisonNodeMembership[]> {
  const { data, error } = await admin
    .from("unison_node_users")
    .select("node_id,role")
    .eq("user_id", userId)
    .eq("status", "active");

  if (error) throw error;

  return (data || [])
    .filter(
      (row): row is { node_id: string; role: "owner" | "admin" | "member" } =>
        typeof row.node_id === "string" &&
        (row.role === "owner" || row.role === "admin" || row.role === "member"),
    )
    .map((row) => ({ nodeId: row.node_id, role: row.role }));
}

export async function activeNodeIds(
  admin: AdminClient,
  userId: string,
): Promise<string[]> {
  return (await activeNodeMemberships(admin, userId)).map((row) => row.nodeId);
}

export async function nodeMembership(
  admin: AdminClient,
  userId: string,
  nodeId: string,
): Promise<UnisonNodeMembership | null> {
  const { data, error } = await admin
    .from("unison_node_users")
    .select("node_id,role,status")
    .eq("node_id", nodeId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.status !== "active") return null;
  if (data.role !== "owner" && data.role !== "admin" && data.role !== "member") {
    return null;
  }

  return { nodeId: data.node_id, role: data.role };
}

export async function canManageNode(
  admin: AdminClient,
  userId: string,
  nodeId: string,
) {
  const membership = await nodeMembership(admin, userId, nodeId);
  return membership?.role === "owner" || membership?.role === "admin";
}


export async function resolveNodeProfileToken(
  admin: AdminClient,
  nodeId: string,
  rawToken: string | null | undefined,
): Promise<UnisonNodeMembership | null> {
  const token = (rawToken || "").trim();
  if (!token) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data: profileToken, error: tokenError } = await admin
    .from("unison_node_profile_tokens")
    .select("id,user_id,node_id,revoked_at")
    .eq("token_hash", tokenHash)
    .eq("node_id", nodeId)
    .maybeSingle();

  if (tokenError) throw tokenError;
  if (!profileToken || profileToken.revoked_at) return null;

  const membership = await nodeMembership(admin, profileToken.user_id, nodeId);
  if (!membership) return null;

  await admin
    .from("unison_node_profile_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", profileToken.id);

  return membership;
}
