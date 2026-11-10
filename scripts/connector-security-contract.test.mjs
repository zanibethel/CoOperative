import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const get = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("per-user grant, flow, and refresh tables are RLS-on, client-denied", () => {
  const sql = get("supabase/migrations/20261110163000_per_user_oauth_connections.sql");
  for (const name of [
    "user_oauth_connections",
    "user_oauth_flows",
    "user_oauth_refresh_leases",
  ]) {
    assert.match(sql, new RegExp("alter table public\\." + name + " enable row level security;", "i"));
    assert.match(sql, new RegExp("revoke all on public\\." + name + " from public, anon, authenticated;", "i"));
  }
  assert.match(sql, /unique \(user_id, provider_key, provider_account_id\)/);
  for (const name of [
    "store_user_oauth_grant",
    "read_user_oauth_grant",
    "disconnect_user_oauth_grant",
    "try_acquire_user_oauth_refresh_lease",
    "release_user_oauth_refresh_lease",
  ]) {
    assert.match(sql, new RegExp("revoke all on function public\\." + name, "i"));
    assert.match(sql, new RegExp("grant execute on function public\\." + name, "i"));
  }
  assert.match(sql, /vault\.create_secret\(/);
  assert.match(sql, /vault\.update_secret\(/);
  assert.match(sql, /vault\.decrypted_secrets/);
});

test("callback consumes user-bound, expiring, one-time state and never sends token to browser", () => {
  const src = get("app/api/local-ai/oauth-connect/callback/route.ts");
  assert.match(src, /\.eq\("state_hash", stateHash\)/);
  assert.match(src, /\.eq\("user_id", userId\)/);
  assert.match(src, /\.is\("consumed_at", null\)/);
  assert.match(src, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(src, /\.update\(\{ consumed_at:/);
  assert.match(src, /store_user_oauth_grant/);
  assert.doesNotMatch(src, /response\.json\(\{\s*access_token:/);
});

test("public connection endpoints require authenticated caller and owner scope", () => {
  const src = get("app/api/local-ai/oauth-connect/route.ts");
  assert.match(src, /await authenticatedUserId\(\)/);
  assert.match(src, /\.eq\("user_id", userId\)/);
  assert.match(src, /\.eq\("id", parsed\.data\.connectionId\)/);
  assert.match(src, /authenticatedOrigin\(request\)/);
  assert.match(src, /configured,/);
});

test("broker rechecks active session identity and refuses arbitrary owner userId", () => {
  const src = get("lib/integrations/user-oauth-token-broker.ts");
  assert.match(src, /const currentUserId = await authenticatedUserId\(\)/);
  assert.match(src, /currentUserId !== userId/);
  assert.match(src, /\.eq\("user_id", userId\)/);
  assert.match(src, /connection_status", "connected"/);
  assert.match(src, /try_acquire_user_oauth_refresh_lease/);
});

test("GitHub API connector only uses fixed API host with GET and installed repositories", () => {
  const src = get("lib/integrations/github-user-tools.ts");
  assert.match(src, /const GITHUB_API = "https:\/\/api.github.com"/);
  assert.match(src, /method: "GET"/);
  assert.match(src, /redirect: "error"/);
  assert.match(src, /"\/user\/installations"/);
  assert.match(src, /"\/repositories"/);
  assert.match(src, /githubAccountToken\(userId, connectionId\)/);
  assert.match(src, /\.eq\("user_id", userId\)/);
});

test("provider OAuth redirects are fixed and not arbitrary user URLs", () => {
  const src = get("lib/integrations/user-oauth-providers.ts");
  assert.match(src, /"https:\/\/github.com\/login\/oauth\/authorize"/);
  assert.match(src, /"https:\/\/accounts.google.com\/o\/oauth2\/v2\/auth"/);
  assert.match(src, /"https:\/\/apis.roblox.com\/oauth\/v1\/authorize"/);
  assert.match(src, /COOP_PUBLIC_ORIGIN/);
  assert.match(src, /oauthCallbackUrl/);
});
