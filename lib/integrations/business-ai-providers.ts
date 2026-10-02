import "server-only";

export const BUSINESS_AI_PROVIDER_KEYS = [
  "openai-api",
  "anthropic-claude",
  "google-gemini",
  "openrouter-api",
] as const;

export type BusinessAiProviderKey =
  (typeof BUSINESS_AI_PROVIDER_KEYS)[number];

export type BusinessAiCredentialCheck = {
  providerKey: BusinessAiProviderKey;
  models: string[];
};

export function isBusinessAiProviderKey(
  value: string,
): value is BusinessAiProviderKey {
  return (BUSINESS_AI_PROVIDER_KEYS as readonly string[]).includes(value);
}

async function checkedFetch(
  url: string,
  init: RequestInit,
  providerName: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`${providerName} rejected that credential.`);
    }
    if (!response.ok) {
      throw new Error(
        `${providerName} could not verify this credential right now (HTTP ${response.status}).`,
      );
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateBusinessAiCredential(
  providerKey: BusinessAiProviderKey,
  credential: string,
): Promise<BusinessAiCredentialCheck> {
  const secret = credential.trim();
  if (secret.length < 8 || secret.length > 20_000) {
    throw new Error("Credential is missing or invalid.");
  }

  if (providerKey === "openai-api") {
    const response = await checkedFetch(
      "https://api.openai.com/v1/models",
      { headers: { Authorization: `Bearer ${secret}` } },
      "OpenAI",
    );
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = (payload.data || [])
      .map((item) => (typeof item.id === "string" ? item.id : ""))
      .filter(Boolean)
      .slice(0, 30);

    return { providerKey, models };
  }

  if (providerKey === "anthropic-claude") {
    const response = await checkedFetch(
      "https://api.anthropic.com/v1/models?limit=30",
      {
        headers: {
          "x-api-key": secret,
          "anthropic-version": "2023-06-01",
        },
      },
      "Claude",
    );
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = (payload.data || [])
      .map((item) => (typeof item.id === "string" ? item.id : ""))
      .filter(Boolean)
      .slice(0, 30);

    return { providerKey, models };
  }

  if (providerKey === "openrouter-api") {
    await checkedFetch(
      "https://openrouter.ai/api/v1/key",
      { headers: { Authorization: `Bearer ${secret}` } },
      "OpenRouter",
    );

    const response = await checkedFetch(
      "https://openrouter.ai/api/v1/models",
      { headers: { Authorization: `Bearer ${secret}` } },
      "OpenRouter",
    );
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = (payload.data || [])
      .map((item) => (typeof item.id === "string" ? item.id : ""))
      .filter(Boolean)
      .slice(0, 30);

    return { providerKey, models };
  }

  const response = await checkedFetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=30",
    { headers: { "x-goog-api-key": secret } },
    "Gemini",
  );
  const payload = (await response.json()) as {
    models?: Array<{ name?: unknown }>;
  };
  const models = (payload.models || [])
    .map((item) =>
      typeof item.name === "string"
        ? item.name.replace(/^models\//, "")
        : "",
    )
    .filter(Boolean)
    .slice(0, 30);

  return { providerKey, models };
}
