import { NextResponse } from "next/server";

import {
  latestModelRegistrySnapshot,
  scanModelCapabilities,
} from "@/lib/inference/model-capability-registry";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";

export const runtime = "nodejs";
export const maxDuration = 300;

async function scannerActor(request: Request) {
  const userId = await mainCooperativeUserId();
  if (userId) {
    return {
      authorized: true as const,
      triggerSource: "authenticated-user",
      actor: `user:${userId}`,
    };
  }

  const secret = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET?.trim();
  const bearer = request.headers.get("authorization") || "";
  if (secret && bearer === `Bearer ${secret}`) {
    return {
      authorized: true as const,
      triggerSource: "service-secret",
      actor: "service-secret",
    };
  }

  return {
    authorized: false as const,
    triggerSource: "unauthorized",
    actor: null,
  };
}

export async function GET(request: Request) {
  const actor = await scannerActor(request);
  if (!actor.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await latestModelRegistrySnapshot();
    return NextResponse.json(
      {
        ...snapshot,
        actor: actor.actor,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not load the model capability registry.";
    return NextResponse.json(
      {
        error: "Could not load the model capability registry.",
        detail: detail.slice(0, 1200),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const actor = await scannerActor(request);
  if (!actor.authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await scanModelCapabilities({
      triggerSource: actor.triggerSource,
    });

    return NextResponse.json(
      {
        ...result,
        actor: actor.actor,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Model capability scan failed.";
    return NextResponse.json(
      {
        error: "Model capability scan failed.",
        detail: detail.slice(0, 1600),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
