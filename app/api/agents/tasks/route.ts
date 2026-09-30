import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { AGENT_REGISTRY, AGENT_REPOSITORIES } from "@/lib/agents/registry";
import { currentAgentOwnerRef } from "@/lib/agents/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const createTaskSchema = z.object({
  agentKey: z.enum(["repo-engineer","project-memory","debugger","verifier"]),
  repoKey: z.enum(["cooperative","creatorhub"]),
  mode: z.enum(["inspect","prepare_change","update_memory","verify"]),
  objective: z.string().min(1).max(12000),
  profile: z.enum(["fast","quality"]).optional(),
});

export async function POST(request: Request) {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const input = createTaskSchema.parse(await request.json());
    const agent = AGENT_REGISTRY[input.agentKey];
    const repo = AGENT_REPOSITORIES[input.repoKey];

    if (!(agent.modes as readonly string[]).includes(input.mode)) {
      return NextResponse.json(
        { error: `${agent.name} does not support ${input.mode}.` },
        { status: 400 },
      );
    }

    const requestedProfile = input.profile || agent.preferredProfile;
    const admin = createAdminSupabaseClient();
    const taskId = crypto.randomUUID();

    const { error } = await admin.from("agent_tasks").insert({
      id: taskId,
      owner_ref: ownerRef,
      agent_key: input.agentKey,
      repo_key: input.repoKey,
      mode: input.mode,
      objective: input.objective.trim(),
      requested_profile: requestedProfile,
      status: "queued",
    });
    if (error) throw error;

    await admin.from("agent_task_events").insert({
      task_id: taskId,
      owner_ref: ownerRef,
      kind: "queued",
      message: `${agent.name} task queued for ${repo.name}.`,
      metadata: {
        agentRevision: "2026-09-30.1",
        githubRepo: repo.githubRepo,
        mode: input.mode,
        profile: requestedProfile,
      },
    });

    return NextResponse.json(
      { taskId, status: "queued", agent, repository: repo },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not queue agent task.";
    return NextResponse.json(
      { error: "Could not queue agent task.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const ownerRef = await currentAgentOwnerRef();
  if (!ownerRef) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const taskId = url.searchParams.get("id");
    const admin = createAdminSupabaseClient();

    if (taskId) {
      const { data: task, error } = await admin
        .from("agent_tasks")
        .select("*")
        .eq("id", taskId)
        .eq("owner_ref", ownerRef)
        .maybeSingle();
      if (error) throw error;
      if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

      const { data: events, error: eventsError } = await admin
        .from("agent_task_events")
        .select("id,kind,message,metadata,created_at")
        .eq("task_id", taskId)
        .eq("owner_ref", ownerRef)
        .order("created_at", { ascending: true });
      if (eventsError) throw eventsError;

      return NextResponse.json(
        { task, events: events || [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data, error } = await admin
      .from("agent_tasks")
      .select("id,agent_key,repo_key,mode,objective,requested_profile,status,branch_name,result,error,created_at,updated_at,completed_at")
      .eq("owner_ref", ownerRef)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw error;

    return NextResponse.json({ tasks: data || [] }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Could not read agent tasks.";
    return NextResponse.json(
      { error: "Could not read agent tasks.", detail: detail.slice(0, 800) },
      { status: 502 },
    );
  }
}
