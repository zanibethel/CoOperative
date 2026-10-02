import { NextResponse } from "next/server";
import { publicAgentRegistry } from "@/lib/agents/registry";
import { currentAgentOwnerRef } from "@/lib/agents/server";
import {
  CAPABILITY_REGISTRY,
  SERVICE_AGENT_REGISTRY_REVISION,
  SERVICE_AGENTS,
} from "@/lib/runtime/registry";

export const runtime = "nodejs";

export async function GET() {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json(
    {
      ...publicAgentRegistry(),
      serviceRuntime: {
        revision: SERVICE_AGENT_REGISTRY_REVISION,
        agents: Object.values(SERVICE_AGENTS),
        capabilities: Object.values(CAPABILITY_REGISTRY),
      },
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
