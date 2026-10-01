import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export async function getUnisonViewer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminSupabaseClient();
  const [{ data: owner }, { data: contributor }] = await Promise.all([
    admin
      .from("unison_platform_owners")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    admin
      .from("unison_contributors")
      .select("user_id,display_name,contact_email,status,payout_status,joined_at")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  return {
    user,
    isOwner: Boolean(owner),
    contributor: contributor ?? null,
  };
}
