import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";
import { resolveNodeProfileToken } from "@/lib/unison/node-access";

export const runtime = "nodejs";
export const maxDuration = 30;

const patchSchema = z.object({
  nodeId: z.string().min(1).max(160),
  webAccessMode: z.enum(["off", "auto", "always"]),
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

function accessError(kind: "node" | "profile") {
  return NextResponse.json(
    {
      error:
        kind === "node"
          ? "Unauthorized node."
          : "This Windows profile is not linked to a CoOperative user.",
    },
    { status: kind === "node" ? 401 : 409 },
  );
}

export async function GET(request: Request) {
  const nodeId = (new URL(request.url).searchParams.get("nodeId") || "").slice(
    0,
    160,
  );
  if (!nodeId) {
    return NextResponse.json({ error: "nodeId is required." }, { status: 400 });
  }

  try {
    const access = await profileForNodeRequest(request, nodeId);
    if (
      "error" in access &&
      (access.error === "node" || access.error === "profile")
    ) {
      return accessError(access.error);
    }

    const userId = access.membership.userId;
    const { data, error } = await access.admin
      .from("personal_ai_settings")
      .select("web_access_mode")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      const { data: created, error: createError } = await access.admin
        .from("personal_ai_settings")
        .insert({ user_id: userId })
        .select("web_access_mode")
        .single();
      if (createError) throw createError;
      return NextResponse.json(
        { webAccessMode: created.web_access_mode || "off" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        webAccessMode:
          data.web_access_mode === "auto" || data.web_access_mode === "always"
            ? data.web_access_mode
            : "off",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not load node profile settings.";
    return NextResponse.json(
      { error: "Could not load node profile settings.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  let input: z.infer<typeof patchSchema>;
  try {
    input = patchSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
      { status: 400 },
    );
  }

  try {
    const access = await profileForNodeRequest(request, input.nodeId);
    if (
      "error" in access &&
      (access.error === "node" || access.error === "profile")
    ) {
      return accessError(access.error);
    }

    const userId = access.membership.userId;
    const now = new Date().toISOString();

    const { data, error } = await access.admin
      .from("personal_ai_settings")
      .upsert(
        {
          user_id: userId,
          web_access_mode: input.webAccessMode,
          updated_at: now,
        },
        { onConflict: "user_id" },
      )
      .select("web_access_mode")
      .single();
    if (error) throw error;

    return NextResponse.json(
      {
        webAccessMode:
          data.web_access_mode === "auto" || data.web_access_mode === "always"
            ? data.web_access_mode
            : "off",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not update node profile settings.";
    return NextResponse.json(
      { error: "Could not update node profile settings.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
