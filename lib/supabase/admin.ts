import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Elevated Supabase client for trusted backend-only Cloud Operative routes.
 *
 * SUPABASE_SECRET_KEY is the modern replacement for the legacy service_role
 * JWT key. It bypasses RLS, so callers MUST perform their own authentication
 * and authorization checks before using this client.
 *
 * Never expose this client or key to browser/client bundles.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Missing server-only Supabase configuration.");
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
