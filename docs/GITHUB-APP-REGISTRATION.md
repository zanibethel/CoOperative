# Register CoOperative's GitHub App (one-time platform setup)

This registers a single GitHub App for **CoOperative**, NOT one app per customer. After registration, every CoOperative user signs in to their own GitHub account and installs that same app on individually selected repositories. No account permissions are shared between CoOperative users.

## Registration

1. Sign in to GitHub with the account that should own the CoOperative integration.
2. Open **https://github.com/settings/apps/new** (GitHub > Settings > Developer settings > GitHub Apps > New GitHub App).
3. Name it **CoOperative** (if unavailable, choose an available distinguishing name); note the resulting **app slug**.
4. Homepage URL: **https://co-operative-mu.vercel.app** (update when CoOperative has an approved custom domain).
5. User authorization callback URL: **https://co-operative-mu.vercel.app/api/local-ai/oauth-connect/callback**.
6. Disable active webhooks for this first read-only connector. No webhook URL, webhook secret, or private key is required to use its **user-to-server OAuth access tokens** for read-only API calls.
7. Repository permissions: **Metadata: read** (GitHub requires this), **Contents: read**, **Pull requests: read**. Do not grant repository administration, secrets, workflows, organization admin, or write permissions yet.
8. Account permissions: none beyond any provider-required defaults.
9. Select **Any account** for installations if the app will be offered to CoOperative's other users, not only the app owner. Ensure the app's visibility/installation settings permit that intended rollout.
10. Keep user-to-server token expiration enabled. The initial connector requests `offline_access` so it can receive refresh tokens where supported.
11. Save the app. GitHub issues a **Client ID**, and you create a **Client secret** in the app settings. **Do not paste the secret into CoOperative Chat or a GitHub issue/PR.**

## Server-side Vercel configuration

On the Vercel project **co-operative**, team **zanibethels-projects**, configure these as server-side environment variables (never `NEXT_PUBLIC_`):

| Key | Value |
| --- | --- |
| `COOP_PUBLIC_ORIGIN` | `https://co-operative-mu.vercel.app` |
| `COOP_GITHUB_APP_CLIENT_ID` | GitHub App **Client ID** (not App ID) |
| `COOP_GITHUB_APP_CLIENT_SECRET` | GitHub App Client **secret**, set directly in Vercel |
| `COOP_GITHUB_APP_SLUG` | The resulting GitHub App slug |

The GitHub App's user-to-server OAuth client credentials are **platform configuration**, not users' credentials. Other users will only click Connect, sign into GitHub, authorize, and choose their repositories. Tokens are stored per CoOperative user account in the server vault.

For local/pre-production E2E testing, create a **separate test GitHub App** and a stable preview callback origin. Do not register the production callback with an ephemeral preview domain. Never route a preview-origin callback to production code that hasn't been merged.

## Supabase prerequisites

The migration `supabase/migrations/20261110163000_per_user_oauth_connections.sql` must pass review and testing on a disposable non-production database before application to CoOperative production. Vault must be installed; confirm `vault.create_secret`, `vault.update_secret`, and `vault.decrypted_secrets` work, and the functions are service-role only.

The CoOperative project `hbgyebthxmgbuoqadelb` has Vault available, but the new per-user connection tables were **not** present during the November 10 inspection. Do not enable user login until migration and two-user isolation gates pass.

## Acceptance checks

1. Sign in to CoOperative as test user A, then visit `/connections`.
2. Connect GitHub and authorize the platform's GitHub App on GitHub's login page.
3. Install the app on **selected repositories**, not "all repositories," for the test.
4. Click **View installed repositories**; only the selected repositories should appear.
5. In the owner chat, ask "Show my GitHub repositories" or "Inspect GitHub repo zanibethel/CoOperative". These read-only operations must not modify source files.
6. Sign in as completely unrelated test user B and check that none of A's linked accounts, selected repos, OAuth sessions, or tokens are accessible to B.
7. Disconnect user A and verify B's connection remains unchanged.
8. Test expired user tokens, refresh rotation, revoked access, OAuth callback replay, browser CSRF, and installed-repository permission loss.
9. Confirm no access or refresh tokens appear in API JSON, logs, chat history, browser, or model prompts.
10. Promote the draft PR only when code, security and provider live tests pass.

For Vercel and Supabase integrations, the same user-ownership model will apply, but each needs its own supported authorization scopes and tool adapters. iCloud is service-specific and cannot grant blanket access through universal OAuth.

## Current status

This document is a setup guide; it does **not** indicate the GitHub App has already been registered, secrets configured, or an OAuth login completed. Treat `/connections` on a preview branch as a UI preview until these deployment gates have been satisfied.
