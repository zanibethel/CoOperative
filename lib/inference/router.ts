import {
  imageInferenceRequestSchema,
  imageInferenceResponseSchema,
  type ImageInferenceRequest,
  type ImageInferenceResponse,
  type InferenceWorker,
} from "./contracts";

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function configuredWorkers(): InferenceWorker[] {
  const workers: InferenceWorker[] = [];

  if (process.env.INFERENCE_LOCAL_URL) {
    workers.push({
      id: "local",
      url: normalizeBaseUrl(process.env.INFERENCE_LOCAL_URL),
      token: process.env.INFERENCE_LOCAL_TOKEN,
    });
  }

  if (process.env.INFERENCE_CLOUD_URL) {
    workers.push({
      id: "cloud",
      url: normalizeBaseUrl(process.env.INFERENCE_CLOUD_URL),
      token: process.env.INFERENCE_CLOUD_TOKEN,
    });
  }

  return workers;
}

async function callWorker(
  worker: InferenceWorker,
  request: ImageInferenceRequest,
): Promise<ImageInferenceResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  const started = Date.now();

  try {
    const response = await fetch(`${worker.url}/v1/images/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(worker.token ? { Authorization: `Bearer ${worker.token}` } : {}),
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload: unknown = null;

    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? String((payload as { detail?: unknown }).detail ?? "")
          : raw;
      throw new Error(
        `${worker.id} inference worker returned ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`,
      );
    }

    const parsed = imageInferenceResponseSchema.parse(payload);
    return {
      ...parsed,
      latencyMs: parsed.latencyMs ?? Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateImageLocalFirst(
  input: unknown,
): Promise<ImageInferenceResponse & { worker: InferenceWorker["id"] }> {
  const request = imageInferenceRequestSchema.parse(input);
  const workers = configuredWorkers();

  if (workers.length === 0) {
    throw new Error(
      "No inference worker is configured. Set INFERENCE_LOCAL_URL and/or INFERENCE_CLOUD_URL.",
    );
  }

  const failures: string[] = [];

  for (const worker of workers) {
    try {
      const result = await callWorker(worker, request);
      return { ...result, worker: worker.id };
    } catch (error) {
      failures.push(
        `${worker.id}: ${error instanceof Error ? error.message : "unknown failure"}`,
      );
    }
  }

  throw new Error(`All configured inference workers failed. ${failures.join(" | ")}`);
}
