import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function authenticatedUserId() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error) return null;

  const subject = data?.claims?.sub;
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}
