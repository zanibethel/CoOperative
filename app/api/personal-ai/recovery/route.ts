import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import {
  listRecoveryIncidents,
  refreshRecoveryIncident,
  startRecoveryForJob,
} from "@/lib/recovery/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const startSchema = z.object({
  sourceJobId: z.string().uuid(),
});

function ownerRefFor(userId: string) {
  return "personal-user:" + userId;
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = startSchema.parse(await request.json());
    const incident = await startRecoveryForJob(
      ownerRefFor(userId),
      input.sourceJobId,
    );

    return NextResponse.json(
      {
        incident,
        message:
          incident.current_message ||
          "Recovery Agent started for your local Personal AI.",
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not start Personal AI recovery.";
    return NextResponse.json(
      {
        error: "Could not start Personal AI recovery.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = ownerRefFor(userId);
  const url = new URL(request.url);
  const incidentId = url.searchParams.get("incidentId") || "";
  const conversationId = url.searchParams.get("conversationId") || "";

  try {
    if (incidentId) {
      const result = await refreshRecoveryIncident(ownerRef, incidentId);
      if (!result) {
        return NextResponse.json(
          { error: "Recovery incident not found." },
          { status: 404 },
        );
      }
      return NextResponse.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId or incidentId is required." },
        { status: 400 },
      );
    }

    const incidents = await listRecoveryIncidents(
      ownerRef,
      conversationId,
      "personal",
    );

    return NextResponse.json(
      { incidents },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not read Personal AI recovery.";
    return NextResponse.json(
      {
        error: "Could not read Personal AI recovery.",
        detail: detail.slice(0, 800),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
