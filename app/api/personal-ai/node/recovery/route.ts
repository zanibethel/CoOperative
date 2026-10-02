import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";
import { resolveNodeProfileToken } from "@/lib/unison/node-access";
import {
  refreshRecoveryIncident,
  startPersonalRuntimeRecovery,
} from "@/lib/recovery/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const reportSchema = z.object({
  nodeId: z.string().min(1).max(160),
  conversationId: z.string().uuid(),
  error: z.string().min(1).max(4000),
  context: z.string().max(4000).optional(),
});

async function profileForNodeRequest(request: Request, nodeId: string) {
  if (!(await authorizeUnisonNode(request, nodeId))) {
    return { error: "node" as const };
  }

  const admin = createAdminSupabaseClient();
  const profileToken = request.headers.get("x-cooperative-profile-token");
  const membership = await resolveNodeProfileToken(admin, nodeId, profileToken);

  return membership
    ? { admin, membership }
    : { error: "profile" as const };
}

export async function POST(request: Request) {
  let input: z.infer<typeof reportSchema>;
  try {
    input = reportSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const access = await profileForNodeRequest(request, input.nodeId);
    if ("error" in access) {
      return NextResponse.json(
        {
          error:
            access.error === "node"
              ? "Unauthorized node."
              : "This Windows profile is not linked to a CoOperative user.",
        },
        { status: access.error === "node" ? 401 : 409 },
      );
    }

    const { data: conversation, error: conversationError } = await access.admin
      .from("personal_ai_conversations")
      .select("id,user_id,node_id")
      .eq("id", input.conversationId)
      .eq("user_id", access.membership.userId)
      .eq("node_id", input.nodeId)
      .maybeSingle();

    if (conversationError) throw conversationError;
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }

    const incident = await startPersonalRuntimeRecovery({
      ownerRef: `personal-user:${access.membership.userId}`,
      userId: access.membership.userId,
      conversationId: input.conversationId,
      error: input.error,
      context: input.context,
    });

    return NextResponse.json(
      { incident },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not report local recovery.";
    return NextResponse.json(
      { error: "Could not report local recovery.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nodeId = (url.searchParams.get("nodeId") || "").slice(0, 160);
  const incidentId = url.searchParams.get("incidentId") || "";

  if (!nodeId || !incidentId) {
    return NextResponse.json(
      { error: "nodeId and incidentId are required." },
      { status: 400 },
    );
  }

  try {
    const access = await profileForNodeRequest(request, nodeId);
    if ("error" in access) {
      return NextResponse.json(
        { error: "Unauthorized local recovery request." },
        { status: access.error === "node" ? 401 : 409 },
      );
    }

    const result = await refreshRecoveryIncident(
      `personal-user:${access.membership.userId}`,
      incidentId,
    );
    if (!result) {
      return NextResponse.json(
        { error: "Recovery incident not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read local recovery.";
    return NextResponse.json(
      { error: "Could not read local recovery.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
