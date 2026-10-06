import { NextResponse } from "next/server";
import { publicTextModelRegistry } from "@/lib/inference/text-model-registry";
import { availableModelRegistryRoutes } from "@/lib/inference/model-capability-registry";

export const runtime = "nodejs";

function authorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const localRegistry = publicTextModelRegistry();
  const availability = await availableModelRegistryRoutes({
    routeKinds: ["text", "multimodal-text", "vision", "text-runtime"],
    includeNonExecutable: true,
    maxAgeHours: 36,
  }).catch(() => ({
    authoritative: false,
    latestCompletedScanAt: null,
    coverage: new Set<string>(),
    keys: new Set<string>(),
    routes: [],
  }));

  return NextResponse.json(
    {
      ...localRegistry,
      registry: {
        authoritative: availability.authoritative,
        latestCompletedScanAt: availability.latestCompletedScanAt,
        availableModels: availability.routes.map((route) => ({
          id: route.model,
          provider: route.provider,
          endpoint: route.endpoint,
          routeKind: route.routeKind,
          displayName: route.displayName,
          free: route.free,
          recommended: route.recommended,
          executionReady: route.executionReady,
          automaticExecutionReady:
            route.provider === "cooperative-local" ||
            (route.provider === "openrouter" && route.free),
          inputModalities: route.inputModalities,
          outputModalities: route.outputModalities,
          capabilitySummary: route.capabilitySummary,
          pricing: route.pricing,
          limits: route.limits,
          policySummary: route.policySummary,
          runtimeSummary: route.runtimeSummary,
          lastSeenAt: route.lastSeenAt,
          lastChangedAt: route.lastChangedAt,
        })),
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
