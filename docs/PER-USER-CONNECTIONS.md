# Per-user connected accounts — checkpoint (November 10, 2026)

## Contract

A signed-in user opens /connections or asks CoOperative Chat to link a supported provider. CoOperative opens the provider authorization page, receives a short-lived callback, verifies the user account, and stores encrypted credentials in Supabase Vault. CoOperative never asks for passwords, shares credentials with other signed-in users, or gives provider tokens to an AI model. If a user links more than one account, the account must be selected for future operations.

Authorization is per Supabase Auth user UUID, provider, and external provider account ID. OAuth state is random, short-lived, SHA-256 hashed in storage, consumed only once, and bound to the same authenticated user who began authorization. PKCE applies when the provider supports it.

The user can disconnect locally, causing the vault grant to be removed. Provider-side revocation must also be supported where available and users should retain the provider revocation option.

## In this branch

- Secure user-scoped tables: public.user_oauth_connections, user_oauth_flows, and user_oauth_refresh_leases. They have RLS enabled and grant no client access to anon or authenticated roles.
- Service-role-only functions store, read, and clear OAuth credential documents through Supabase Vault.
- Start/status/disconnect at /api/local-ai/oauth-connect; callback at /api/local-ai/oauth-connect/callback.
- Approved provider definitions under lib/integrations/user-oauth-providers.ts.
- On-demand server-only token broker with user-scoped lookups, account disambiguation, and serialized refresh.
- A self-service /connections page available to all signed-in users.
- Chat's existing OAuth card can launch the new adapters using the service registry.

## Operator prerequisites

1. Apply and review the proposed migration on a nonproduction Supabase branch first. Run advisors and RLS checks.
2. Set COOP_PUBLIC_ORIGIN to the deployed HTTPS origin. The initial intended value is https://co-operative-mu.vercel.app, until a custom domain is approved.
3. Add these secrets only to server-side Vercel settings, never NEXT_PUBLIC variables:
   - COOP_GITHUB_APP_CLIENT_ID and COOP_GITHUB_APP_CLIENT_SECRET
   - COOP_GOOGLE_OAUTH_CLIENT_ID and COOP_GOOGLE_OAUTH_CLIENT_SECRET
   - COOP_ROBLOX_OAUTH_CLIENT_ID and COOP_ROBLOX_OAUTH_CLIENT_SECRET
4. Register the callback https://<approved-host>/api/local-ai/oauth-connect/callback with each provider.
5. Install the GitHub App on specifically selected repositories and approve only required read/write permissions. User OAuth authorization alone does not install GitHub App access to repositories.
6. Configure Google OAuth consent and complete restricted Gmail scope verification for public distribution, if applicable. Existing Gmail scope is read-only.
7. Register and test the Roblox OAuth app. The initial scope authorizes only identity/profile, not editing games or experiences.

Run:
- node --experimental-strip-types --test scripts/user-oauth-registry.test.mjs
- npm run lint
- npx tsc --noEmit
- npm run build

## Manual two-user security gate

Use two separate non-owner users A and B, plus separate external provider test accounts.

1. User A connects GitHub. B sees no GitHub accounts and cannot retrieve A's session or connection.
2. B connects their own account. A never sees B's account.
3. B tries GET on A's OAuth flow session: 404. B attempts DELETE on A's connection: 404.
4. A starts an authorization and switches to B before the callback: callback must not complete.
5. Replaying a callback must fail; OAuth states expire and cannot be used twice.
6. Disconnect A; B's connection stays intact. Confirm A's token is removed from Vault.
7. Force expiry and verify rotating tokens refresh once with lock; invalid refresh requires reconnect.
8. Check browser responses, chat transcripts, model inputs, telemetry, and logs contain no passwords or provider tokens.
9. Verify provider permission scope and GitHub App repository installations.

Do not merge or deploy until these checks and CI pass.

## Readiness and limitations

- GitHub: OAuth adapter implemented; awaits application credentials, installation, and integration verification.
- Gmail: OAuth adapter implemented; awaits credentials, restricted scope approval, and verification.
- Roblox: OAuth adapter implemented; awaits credentials and tests. Requires additional approved Open Cloud scopes for game operations.
- Vercel and Supabase: connector build required; require provider-specific authorization and narrowly scoped tool adapters.
- Facebook and Instagram: connector build required; Meta permission reviews and account-type constraints apply.
- iCloud: no universal OAuth permission for all iCloud data. Service-specific supported workflows are necessary, such as supported Mail/Calendar/Contacts authorization.
- For every future service: add provider metadata, implement authorization and safe scopes, verify provider requirements, add tool actions, test with two users, and promote registry status.

The OAuth broker is not itself a general-purpose agent execution capability. Tool adapters (GitHub PRs, Vercel deployments, Supabase queries, Gmail reads, etc.) must explicitly enforce authenticated caller identity and approved grants, and never pass raw tokens through the model. Multi-account chat picker, provider-side revocation, audit logs, and personal chat card integration remain follow-on work.
