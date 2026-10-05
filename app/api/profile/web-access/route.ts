import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  decideWebAccess,
  type WebAccessMode,
} from "@/lib/runtime/web-access-policy";

export const runtime = "nodejs";
export const maxDuration = 30;

const decisionSchema = z.object({
  url: z.string().max(4000).optional(),
  needsCurrentExternalInfo: z.boolean().default(false),
  authenticatedPrivateResource: z.boolean().default(false),
});

async function currentMode(userId: string): Promise<WebAccessMode> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("personal_ai_settings")
    .select("web_access_mode")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;

  return data?.web_access_mode === "auto" || data?.web_access_mode === "always"
    ? data.web_access_mode
    : "off";
}

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(
      { webAccessMode: await currentMode(userId) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read Web access policy.";
    return NextResponse.json(
      { error: "Could not read Web access policy.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = decisionSchema.parse(await request.json());
    const mode = await currentMode(userId);
    const decision = decideWebAccess({
      mode,
      url: input.url || null,
      needsCurrentExternalInfo: input.needsCurrentExternalInfo,
      authenticatedPrivateResource: input.authenticatedPrivateResource,
      // Public clients cannot self-assert connector authorization.
      connectorAuthorized: false,
    });

    return NextResponse.json(
      { webAccessMode: mode, decision },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not evaluate URL access.";
    return NextResponse.json(
      { error: "Could not evaluate URL access.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
