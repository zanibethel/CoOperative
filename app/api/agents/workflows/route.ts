import { NextResponse } from "next/server";
import { z } from "zod";

import { currentAgentOwnerRef } from "@/lib/agents/server";
import {
  createAgentWorkflow,
  listAgentWorkflows,
  readAgentWorkflow,
} from "@/lib/agents/workflow-orchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

const createSchema = z.object({
  repoKey: z.enum(["cooperative", "creatorhub"]),
  objective: z.string().min(1).max(12000),
  mode: z.enum(["inspect", "prepare_change"]).default("inspect"),
  preset: z.enum(["economy", "balanced", "premium"]).default("balanced"),
  maxSpendUsd: z.number().min(0).max(100).default(0),
});

export async function POST(request: Request) {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = createSchema.parse(await request.json());
    const workflow = await createAgentWorkflow({
      ownerRef,
      repoKey: input.repoKey,
      objective: input.objective,
      mode: input.mode,
      preset: input.preset,
      maxSpendUsd: input.maxSpendUsd,
    });

    return NextResponse.json(
      { workflow },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not create agent workflow.";
    return NextResponse.json(
      { error: "Could not create agent workflow.", detail: detail.slice(0, 1200) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const workflow = await readAgentWorkflow(ownerRef, id);
      if (!workflow) {
        return NextResponse.json({ error: "Workflow not found." }, { status: 404 });
      }
      return NextResponse.json(
        { workflow },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { workflows: await listAgentWorkflows(ownerRef) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read agent workflows.";
    return NextResponse.json(
      { error: "Could not read agent workflows.", detail: detail.slice(0, 1200) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
