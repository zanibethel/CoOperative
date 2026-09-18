import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  OwnerTaskIntentSchema,
  evaluateOwnerTaskPolicy,
} from "@/lib/operative/task-policy";

function adminUnavailable(error: unknown) {
  return error instanceof Error && error.message.includes("Missing server-only Supabase configuration");
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("operative_tasks")
    .select(
      "id, conversation_id, title, description, status, risk_level, requires_owner_approval, playbook_key, selected_executor, max_spend_microunits, actual_spend_microunits, result, error, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = OwnerTaskIntentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid task request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (organizationError) {
    return NextResponse.json({ error: organizationError.message }, { status: 500 });
  }
  if (!organization) {
    return NextResponse.json(
      { error: "Create a workspace before creating an operative task.", code: "NO_ORGANIZATION" },
      { status: 409 },
    );
  }

  if (parsed.data.conversationId) {
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", parsed.data.conversationId)
      .eq("organization_id", organization.id)
      .maybeSingle();

    if (conversationError) {
      return NextResponse.json({ error: conversationError.message }, { status: 500 });
    }
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
  }

  const policy = evaluateOwnerTaskPolicy(parsed.data);

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    if (adminUnavailable(error)) {
      return NextResponse.json(
        {
          error: "Trusted Cloud Operative writes are not configured yet.",
          code: "SERVER_SECRET_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }
    throw error;
  }

  const { data: task, error: taskError } = await admin
    .from("operative_tasks")
    .insert({
      organization_id: organization.id,
      conversation_id: parsed.data.conversationId ?? null,
      created_by: user.id,
      source_channel: "owner-console",
      title: parsed.data.title,
      description: parsed.data.description,
      status: "queued",
      risk_level: policy.riskLevel,
      requires_owner_approval: policy.requiresOwnerApproval,
      max_spend_microunits: policy.maxSpendMicrounits,
    })
    .select(
      "id, conversation_id, title, description, status, risk_level, requires_owner_approval, max_spend_microunits, actual_spend_microunits, created_at",
    )
    .single();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  const { error: eventError } = await admin.from("task_events").insert({
    task_id: task.id,
    organization_id: organization.id,
    event_type: "created",
    actor: user.id,
    detail: {
      source: "owner-console",
      policyReasons: policy.reasons,
      safetyFlags: parsed.data.flags ?? {},
      maxSpendMicrounits: policy.maxSpendMicrounits,
    },
  });

  if (eventError) {
    await admin
      .from("operative_tasks")
      .update({
        status: "failed",
        error: "Unable to persist initial task audit event.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", organization.id);

    return NextResponse.json(
      { error: "Task was created but its audit event could not be persisted." },
      { status: 500 },
    );
  }

  return NextResponse.json({ task, policy }, { status: 201 });
}
