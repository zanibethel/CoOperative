import "server-only";

export type UserOAuthProviderKey = "github" | "gmail" | "roblox";

export type UserOAuthProvider = {
  key: UserOAuthProviderKey;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  clientIdEnvironment: string;
  clientSecretEnvironment: string;
  scopes: string[];
  pkce: boolean;
  tokenEncoding: "json" | "form";
  authorizationExtras?: Record<string, string>;
};

const providers: Record<UserOAuthProviderKey, UserOAuthProvider> = {
  github: {
    key: "github",
    name: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    clientIdEnvironment: "COOP_GITHUB_APP_CLIENT_ID",
    clientSecretEnvironment: "COOP_GITHUB_APP_CLIENT_SECRET",
    // Use a GitHub App user authorization (not an overbroad OAuth App repo scope).
    // Repository access still requires a separate user-selected GitHub App installation.
    scopes: ["offline_access"],
    pkce: false,
    tokenEncoding: "json",
  },
  gmail: {
    key: "gmail",
    name: "Gmail",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    clientIdEnvironment: "COOP_GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnvironment: "COOP_GOOGLE_OAUTH_CLIENT_SECRET",
    // Gmail readonly is a restricted scope; public launch needs Google verification.
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
    pkce: true,
    tokenEncoding: "form",
    authorizationExtras: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
  },
  roblox: {
    key: "roblox",
    name: "Roblox",
    authorizeUrl: "https://apis.roblox.com/oauth/v1/authorize",
    tokenUrl: "https://apis.roblox.com/oauth/v1/token",
    userInfoUrl: "https://apis.roblox.com/oauth/v1/userinfo",
    clientIdEnvironment: "COOP_ROBLOX_OAUTH_CLIENT_ID",
    clientSecretEnvironment: "COOP_ROBLOX_OAUTH_CLIENT_SECRET",
    scopes: ["openid", "profile"],
    pkce: true,
    tokenEncoding: "form",
  },
};

export function userOAuthProvider(value: string): UserOAuthProvider | null {
  return Object.prototype.hasOwnProperty.call(providers, value)
    ? providers[value as UserOAuthProviderKey]
    : null;
}

export function oauthProviderCredentials(provider: UserOAuthProvider) {
  const clientId = process.env[provider.clientIdEnvironment];
  const clientSecret = process.env[provider.clientSecretEnvironment];
  if (!clientId || !clientSecret) {
    throw new Error(provider.name + " sign-in is not configured yet.");
  }
  return { clientId, clientSecret };
}

export function oauthPublicOrigin(): string {
  const supplied = process.env.COOP_PUBLIC_ORIGIN;
  if (!supplied) throw new Error("COOP_PUBLIC_ORIGIN must be configured.");
  const url = new URL(supplied);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("OAuth callback origin must be HTTPS.");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("OAuth callback origin must not include a path or credentials.");
  }
  return url.origin;
}

export function oauthCallbackUrl(): string {
  return oauthPublicOrigin() + "/api/local-ai/oauth-connect/callback";
}

export function oauthAuthorizationUrl(
  provider: UserOAuthProvider,
  state: string,
  codeChallenge?: string,
): string {
  const { clientId } = oauthProviderCredentials(provider);
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", oauthCallbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (provider.scopes.length) url.searchParams.set("scope", provider.scopes.join(" "));
  if (provider.pkce) {
    if (!codeChallenge) throw new Error("PKCE challenge is required.");
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(provider.authorizationExtras || {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

export async function exchangeUserOAuthToken(
  provider: UserOAuthProvider,
  parameters: { code?: string; refreshToken?: string; verifier?: string },
): Promise<OAuthTokenResponse> {
  const { clientId, clientSecret } = oauthProviderCredentials(provider);
  const payload: Record<string, string> = {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: parameters.refreshToken ? "refresh_token" : "authorization_code",
  };
  if (parameters.refreshToken) {
    payload.refresh_token = parameters.refreshToken;
  } else {
    if (!parameters.code) throw new Error("Missing authorization code.");
    payload.code = parameters.code;
    payload.redirect_uri = oauthCallbackUrl();
    if (parameters.verifier) payload.code_verifier = parameters.verifier;
  }
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: provider.tokenEncoding === "json"
      ? { "Content-Type": "application/json", Accept: "application/json" }
      : { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: provider.tokenEncoding === "json"
      ? JSON.stringify(payload)
      : new URLSearchParams(payload).toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("OAuth provider token request failed.");
  const parsed = await response.json() as OAuthTokenResponse;
  if (parsed.error || !parsed.access_token || parsed.access_token.length < 8) {
    throw new Error("OAuth provider did not issue an access token.");
  }
  return parsed;
}

export async function userOAuthExternalAccount(
  provider: UserOAuthProvider,
  accessToken: string,
): Promise<{ id: string; label: string }> {
  const response = await fetch(provider.userInfoUrl, {
    headers: {
      Authorization: "Bearer " + accessToken,
      Accept: "application/json",
      "User-Agent": "CoOperative-Connections",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Could not verify the provider account.");
  const data = await response.json() as Record<string, unknown>;
  const rawId = provider.key === "github" ? data.id : data.sub;
  const id = typeof rawId === "string" || typeof rawId === "number"
    ? String(rawId)
    : "";
  const rawLabel = provider.key === "github"
    ? data.login
    : provider.key === "gmail"
      ? data.email
      : (data.preferred_username || data.name);
  const label = typeof rawLabel === "string" ? rawLabel.slice(0, 180) : id;
  if (!id || id.length > 180) throw new Error("Invalid account identity from provider.");
  return { id, label };
}

export function tokenExpiry(expiresIn?: number): string | null {
  if (!Number.isFinite(expiresIn) || !expiresIn || expiresIn <= 0) return null;
  return new Date(Date.now() + Math.min(expiresIn, 31536000) * 1000).toISOString();
}
