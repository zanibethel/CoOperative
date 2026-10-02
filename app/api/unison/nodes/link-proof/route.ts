import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authorizeUnisonNode } from "@/lib/unison/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());

    if (!(await authorizeUnisonNode(request, input.nodeId))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const proof = randomBytes(32).toString("base64url");
    const proofHash = createHash("sha256").update(proof).digest("hex");
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const admin = createAdminSupabaseClient();

    await admin
      .from("unison_node_link_challenges")
      .delete()
      .eq("node_id", input.nodeId)
      .is("claimed_at", null)
      .lt("expires_at", new Date().toISOString());

    const { error } = await admin.from("unison_node_link_challenges").insert({
      node_id: input.nodeId,
      proof_hash: proofHash,
      expires_at: expiresAt,
    });

    if (error) throw error;

    return NextResponse.json(
      { nodeId: input.nodeId, proof, expiresAt },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not create node link proof.";
    return NextResponse.json(
      { error: "Could not create node link proof.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
