import { NextResponse } from "next/server";
import { z } from "zod";

import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import {
  answerOnboarding,
  onboardingState,
  startOnboarding,
  resumeOnboarding,
} from "@/lib/ai/user-profile-onboarding";

export const runtime = "nodejs";

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("resume"),
    mode: z.enum(["personal", "business"]).optional(),
  }),
  z.object({
    action: z.literal("answer"),
    conversationId: z.string().uuid(),
    message: z.string().min(1).max(12000),
  }),
]);

function ownerRefFor(userId: string) {
  return `coop-user:${userId}`;
}

export async function GET() {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await onboardingState(ownerRefFor(userId));
    return NextResponse.json(
      { state },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Could not load get-to-know-you state.",
        detail:
          error instanceof Error ? error.message.slice(0, 800) : "Unknown error",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = postSchema.parse(await request.json());
    const ownerRef = ownerRefFor(userId);

    if (input.action === "start" || input.action === "resume") {
      const state =
        input.action === "resume"
          ? await resumeOnboarding(ownerRef, input.mode || null)
          : await startOnboarding(ownerRef);
      return NextResponse.json(
        { state },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = await answerOnboarding({
      ownerRef,
      conversationId: input.conversationId,
      message: input.message,
    });

    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not update onboarding.";
    return NextResponse.json(
      { error: message.slice(0, 1000) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
