import { NextResponse } from "next/server";
import { z } from "zod";

import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const taskIdSchema = z.string().uuid();

export async function GET(request: Request) {
  const userId = await mainCooperativeUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = taskIdSchema.safeParse(
    new URL(request.url).searchParams.get("taskId") || "",
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Connector build task is invalid." }, { status: 400 });
  }

  try {
    const ownerRef = `coop-user:${userId}`;
    const admin = createAdminSupabaseClient();
    const { data: task, error } = await admin
      .from("agent_tasks")
      .select(
        "id,status,branch_name,result,error,queued_at,claimed_at,completed_at,updated_at",
      )
      .eq("id", parsed.data)
      .eq("owner_ref", ownerRef)
      .eq("agent_key", "repo-engineer")
      .eq("repo_key", "cooperative")
      .maybeSingle();

    if (error) throw error;
    if (!task) {
      return NextResponse.json(
        { error: "Connector build task not found." },
        { status: 404 },
      );
    }

    const result =
      task.result && typeof task.result === "object"
        ? (task.result as Record<string, unknown>)
        : null;

    return NextResponse.json(
      {
        taskId: task.id,
        status: task.status,
        branchName: task.branch_name || null,
        error: task.error || null,
        queuedAt: task.queued_at || null,
        claimedAt: task.claimed_at || null,
        completedAt: task.completed_at || null,
        updatedAt: task.updated_at || null,
        providerKey:
          typeof result?.providerKey === "string" ? result.providerKey : null,
        providerName:
          typeof result?.providerName === "string" ? result.providerName : null,
        result,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read connector build status.";
    return NextResponse.json(
      { error: detail.slice(0, 600) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
