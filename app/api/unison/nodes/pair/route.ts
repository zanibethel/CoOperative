import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const pairSchema = z.object({
  pairingCode: z.string().min(8).max(200),
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  displayName: z.string().min(1).max(160),
});

export async function POST(request: Request) {
  try {
    const input = pairSchema.parse(await request.json());
    const codeHash = createHash("sha256")
      .update(input.pairingCode.trim())
      .digest("hex");
    const nodeToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(nodeToken).digest("hex");

    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.rpc("claim_unison_pairing_code", {
      p_code_hash: codeHash,
      p_node_id: input.nodeId,
      p_display_name: input.displayName,
      p_token_hash: tokenHash,
    });

    if (error) {
      const duplicateNode = error.code === "23505";
      return NextResponse.json(
        {
          error: duplicateNode
            ? "This node ID is already registered."
            : "Could not pair Unison node.",
        },
        { status: duplicateNode ? 409 : 502 },
      );
    }

    const pairing = Array.isArray(data) ? data[0] : null;
    if (!pairing) {
      return NextResponse.json(
        { error: "Pairing code is invalid, expired, or already used." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        nodeId: input.nodeId,
        nodeToken,
        ownerRef: pairing.owner_ref,
        nodeClass: pairing.node_class,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid pairing request.", detail: error.message.slice(0, 800) },
        { status: 400 },
      );
    }

    const detail =
      error instanceof Error ? error.message : "Could not pair Unison node.";
    console.error("Unison pairing failed", { detail: detail.slice(0, 800) });
    return NextResponse.json(
      { error: "Could not pair Unison node." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
