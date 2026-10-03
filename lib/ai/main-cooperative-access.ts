import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedIdentity } from "@/lib/supabase/auth";

export async function canAccessMainCooperative(userId: string) {
  const admin = createAdminSupabaseClient();

  const [{ data: platformOwner, error: ownerError }, { data: organization, error: organizationError }] =
    await Promise.all([
      admin
        .from("unison_platform_owners")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("organizations")
        .select("id")
        .eq("owner_user_id", userId)
        .limit(1)
        .maybeSingle(),
    ]);

  if (ownerError) throw ownerError;
  if (organizationError) throw organizationError;

  return Boolean(platformOwner || organization);
}

export async function mainCooperativeIdentity() {
  const identity = await authenticatedIdentity();
  if (!identity) return null;

  return (await canAccessMainCooperative(identity.userId)) ? identity : null;
}

export async function mainCooperativeUserId() {
  const identity = await mainCooperativeIdentity();
  return identity?.userId ?? null;
}
