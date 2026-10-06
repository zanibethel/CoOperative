import { NextResponse } from "next/server";
import { z } from "zod";

import { currentAgentOwnerRef } from "@/lib/agents/server";
import { advanceAgentWorkflow } from "@/lib/agents/workflow-orchestrator";
import { approveAndExecuteWorkflowMedia } from "@/lib/agents/workflow-media-execution";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  workflowId: z.string().uuid(),
  nodeId: z.string().uuid(),
});

export async function POST(request: Request) {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    const execution = await approveAndExecuteWorkflowMedia({
      ownerRef,
      workflowId: input.workflowId,
      nodeId: input.nodeId,
    });

    await advanceAgentWorkflow(input.workflowId, ownerRef).catch((error) => {
      console.error("Could not advance workflow after media execution", {
        workflowId: input.workflowId,
        nodeId: input.nodeId,
        detail:
          error instanceof Error ? error.message.slice(0, 800) : "unknown",
      });
    });

    return NextResponse.json(
      execution,
      {
        status: execution.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not approve workflow media execution.";
    return NextResponse.json(
      {
        error: "Could not approve workflow media execution.",
        detail: detail.slice(0, 1600),
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
