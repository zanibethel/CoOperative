import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

const requestSchema = z.object({
  ownerRef: z.string().min(1).max(160).default("platform-private"),
  nodeClass: z.enum(["private", "business", "community"]).default("private"),
  expiresInMinutes: z.number().int().min(5).max(10080).default(60),
});

function ownerAuthorized(request: Request) {
  const expected = process.env.COOPERATIVE_INFERENCE_SHARED_SECRET;
  return Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(request: Request) {
  if (!ownerAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = requestSchema.parse(await request.json().catch(() => ({})));
    const pairingCode = `UNI-${randomBytes(8).toString("hex").toUpperCase()}`;
    const codeHash = createHash("sha256").update(pairingCode).digest("hex");
    const expiresAt = new Date(
      Date.now() + input.expiresInMinutes * 60_000,
    ).toISOString();

    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.from("unison_pairing_codes").insert({
      code_hash: codeHash,
      owner_ref: input.ownerRef,
      node_class: input.nodeClass,
      expires_at: expiresAt,
    });

    if (error) throw error;

    return NextResponse.json(
      {
        pairingCode,
        expiresAt,
        ownerRef: input.ownerRef,
        nodeClass: input.nodeClass,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not create pairing code.";
    return NextResponse.json(
      { error: "Could not create pairing code.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
