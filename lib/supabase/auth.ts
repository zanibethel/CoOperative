import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function authenticatedIdentity() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error) return null;

  const subject = data?.claims?.sub;
  if (typeof subject !== "string" || subject.length === 0) return null;

  const email =
    typeof data?.claims?.email === "string" && data.claims.email.length > 0
      ? data.claims.email
      : null;

  return { userId: subject, email };
}

export async function authenticatedUserId() {
  const identity = await authenticatedIdentity();
  return identity?.userId ?? null;
}
