import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { authenticatedUserId } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function POST() {
  const userId = await authenticatedUserId();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const { data: contributor, error: contributorError } = await admin
    .from("unison_contributors")
    .select("user_id,status")
    .eq("user_id", userId)
    .maybeSingle();

  if (contributorError) {
    return NextResponse.json({ error: "Could not verify contributor profile." }, { status: 502 });
  }

  if (!contributor || contributor.status !== "active") {
    return NextResponse.json(
      { error: "Join Unison before adding a computer." },
      { status: 409 },
    );
  }

  const pairingCode = `UNI-${randomBytes(8).toString("hex").toUpperCase()}`;
  const codeHash = createHash("sha256").update(pairingCode).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();

  const { error } = await admin.from("unison_pairing_codes").insert({
    code_hash: codeHash,
    owner_ref: `contributor:${userId}`,
    node_class: "community",
    contributor_user_id: userId,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("Unison contributor pairing code failed", {
      detail: error.message.slice(0, 500),
    });
    return NextResponse.json({ error: "Could not create pairing code." }, { status: 502 });
  }

  const bootstrapUrl =
    "https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/bootstrap-unison-windows.ps1";

  const command = [
    `$bootstrap = "$env:TEMP\\unison-bootstrap.ps1"`,
    `Invoke-WebRequest -Uri "${bootstrapUrl}" -OutFile $bootstrap`,
    `powershell -ExecutionPolicy Bypass -File $bootstrap -PairCode "${pairingCode}" -NodeName "$env:COMPUTERNAME" -IdleMinutes 5`,
  ].join("\n");

  return NextResponse.json(
    {
      pairingCode,
      expiresAt,
      bootstrapUrl,
      command,
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}
