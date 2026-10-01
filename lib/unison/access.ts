import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedIdentity } from "@/lib/supabase/auth";

export async function getUnisonViewer() {
  const identity = await authenticatedIdentity();
  if (!identity) return null;

  const user = {
    id: identity.userId,
    email: identity.email,
  };

  const admin = createAdminSupabaseClient();
  const [{ data: owner }, { data: contributor }] = await Promise.all([
    admin
      .from("unison_platform_owners")
      .select("user_id")
      .eq("user_id", identity.userId)
      .maybeSingle(),
    admin
      .from("unison_contributors")
      .select("user_id,display_name,contact_email,status,payout_status,joined_at")
      .eq("user_id", identity.userId)
      .maybeSingle(),
  ]);

  return {
    user,
    isOwner: Boolean(owner),
    contributor: contributor ?? null,
  };
}
