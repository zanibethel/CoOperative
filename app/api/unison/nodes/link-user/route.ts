import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  proof: z.string().min(32).max(200),
});

export async function POST(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    const proofHash = createHash("sha256").update(input.proof).digest("hex");
    const profileToken = randomBytes(32).toString("base64url");
    const profileTokenHash = createHash("sha256")
      .update(profileToken)
      .digest("hex");

    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc("claim_unison_node_user_link", {
      p_proof_hash: proofHash,
      p_user_id: userId,
      p_profile_token_hash: profileTokenHash,
    });

    if (error) throw error;

    const linked = Array.isArray(data) ? data[0] : null;
    if (!linked || linked.node_id !== input.nodeId) {
      return NextResponse.json(
        { error: "This local-device authorization expired or was already used." },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: settings, error: settingsError } = await admin
      .from("personal_ai_settings")
      .select("user_id,preferred_node_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (settingsError) throw settingsError;

    if (!settings) {
      const { error: createError } = await admin.from("personal_ai_settings").insert({
        user_id: userId,
        preferred_node_id: input.nodeId,
      });
      if (createError) throw createError;
    } else if (!settings.preferred_node_id) {
      const { error: updateError } = await admin
        .from("personal_ai_settings")
        .update({
          preferred_node_id: input.nodeId,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (updateError) throw updateError;
    }

    return NextResponse.json(
      {
        nodeId: input.nodeId,
        role: linked.role,
        profileToken,
        linked: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not authorize this user on the node.";
    return NextResponse.json(
      { error: "Could not authorize this user on the node.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
