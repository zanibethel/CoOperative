import { NextResponse } from "next/server";
import { publicAgentRegistry } from "@/lib/agents/registry";
import { currentAgentOwnerRef } from "@/lib/agents/server";

export const runtime = "nodejs";

export async function GET() {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(publicAgentRegistry(), {
    headers: { "Cache-Control": "no-store" },
  });
}
