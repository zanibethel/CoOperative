import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildDecisionBrief,
  renderDecisionBriefText,
} from "@/lib/operative/decision-brief";
import {
  getAllowedSecretRequirement,
  secretBrokerConfigured,
} from "@/lib/operative/vercel-secret-broker";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SecretRequestSchema = z.object({
  key: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_]+$/),
  target: z.enum(["preview", "production"]),
  conversationId: z.string().uuid().nullable().optional(),
});

function adminUnavailable(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("Missing server-only Supabase configuration")
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectKey: string }> },
) {
  const { projectKey } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: tasks, error: taskError } = await supabase
    .from("operative_tasks")
    .select("id,title,status,result,error,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  const requests = (tasks ?? []).filter((task) => {
    const result =
      task.result && typeof task.result === "object" && !Array.isArray(task.result)
        ? (task.result as Record<string, unknown>)
        : {};
    const request =
      result.secretRequest &&
      typeof result.secretRequest === "object" &&
      !Array.isArray(result.secretRequest)
        ? (result.secretRequest as Record<string, unknown>)
        : null;
    return request?.projectKey === projectKey;
  });

  const taskIds = requests.map((task) => task.id);
  const decisionsByTask = new Map<string, string>();

  if (taskIds.length > 0) {
    const { data: decisions, error: decisionError } = await supabase
      .from("decisions")
      .select("task_id,status,resolved_at")
      .in("task_id", taskIds)
      .order("created_at", { ascending: false });

    if (decisionError) {
      return NextResponse.json({ error: decisionError.message }, { status: 500 });
    }

    for (const decision of decisions ?? []) {
      if (decision.task_id && !decisionsByTask.has(decision.task_id)) {
        decisionsByTask.set(decision.task_id, decision.status);
      }
    }
  }

  return NextResponse.json({
    projectKey,
    brokerConfigured: secretBrokerConfigured(),
    requests: requests.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      approvalStatus: decisionsByTask.get(task.id) ?? "missing",
      result: task.result,
      error: task.error,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectKey: string }> },
) {
  const { projectKey } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = SecretRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid secret request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const allowed = getAllowedSecretRequirement(
    projectKey,
    parsed.data.key,
    parsed.data.target,
  );
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "That environment variable/target is not allow-listed for this linked project.",
        code: "SECRET_NOT_ALLOW_LISTED",
      },
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
      { error: "Create a workspace before requesting a secret change." },
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

  const title =
    allowed.project.name +
    " · approve " +
    parsed.data.key +
    " for " +
    parsed.data.target;
  const description =
    "Owner-gated secret broker request. Set " +
    parsed.data.key +
    " for " +
    allowed.project.name +
    " " +
    parsed.data.target +
    ". The value will be requested only after approval and will not be stored in CoOperative, task text, logs, Git, or Hermes context.";

  const { data: task, error: taskError } = await admin
    .from("operative_tasks")
    .insert({
      organization_id: organization.id,
      conversation_id: parsed.data.conversationId ?? null,
      created_by: user.id,
      source_channel: "owner-console",
      title,
      description,
      status: "planning",
      risk_level: "high",
      requires_owner_approval: true,
      playbook_key: null,
      selected_executor: null,
      max_spend_microunits: 0,
      actual_spend_microunits: 0,
      result: {
        secretRequest: {
          projectKey: allowed.project.key,
          key: parsed.data.key,
          target: parsed.data.target,
          provider: "vercel",
          valueCaptured: false,
          deploymentRequested: false,
        },
      },
    })
    .select("id")
    .single();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }

  await admin.from("task_events").insert([
    {
      task_id: task.id,
      organization_id: organization.id,
      event_type: "created",
      actor: user.id,
      detail: {
        source: "linked-project-secret-broker",
        projectKey: allowed.project.key,
        key: parsed.data.key,
        target: parsed.data.target,
        secretValueStored: false,
      },
    },
    {
      task_id: task.id,
      organization_id: organization.id,
      event_type: "status_changed",
      from_status: "queued",
      to_status: "planning",
      actor: "system",
      detail: {
        reason: "secret/environment change always requires explicit owner approval",
      },
    },
  ]);

  const requiredScopes = [
    "secret-access",
    ...(parsed.data.target === "production" ? ["production-change"] : []),
  ];

  const brief = buildDecisionBrief({
    taskId: task.id,
    conversationId: parsed.data.conversationId ?? null,
    proposalSummary: title,
    rationale:
      "CoOperative is prepared to write one allow-listed environment variable to the " +
      allowed.project.name +
      " Vercel " +
      parsed.data.target +
      " environment. No value has been requested or stored yet.",
    expectedOutcomeIfApproved:
      "CoOperative will unlock a one-time secure value-entry form for this exact project/key/target. The value is sent directly through the server-side secret broker to Vercel and is not given to Hermes.",
    expectedOutcomeIfDeclined:
      "No secret value will be requested and no linked-project environment configuration will change.",
    estimatedCostCents: 0,
    riskLevel: "high",
    requiredScopes,
    rollbackPlan:
      "CoOperative does not retain the previous or new secret value. If reversal is required, the owner can replace or remove the variable in Vercel through a separately approved action.",
    recommendedAction:
      "Confirm the project, variable name, and target environment. Approve only if those three values are correct.",
  });

  const { data: decision, error: decisionError } = await admin
    .from("decisions")
    .insert({
      organization_id: organization.id,
      task_id: task.id,
      conversation_id: parsed.data.conversationId ?? null,
      proposal_summary: brief.proposalSummary,
      rationale: brief.rationale,
      expected_outcome_if_approved: brief.expectedOutcomeIfApproved,
      expected_outcome_if_declined: brief.expectedOutcomeIfDeclined,
      estimated_cost_cents: 0,
      estimated_savings_cents: null,
      risk_level: "high",
      required_scopes: requiredScopes,
      rollback_plan: brief.rollbackPlan,
      recommended_action: brief.recommendedAction,
      status: "pending",
      idempotency_key:
        "secret:" +
        allowed.project.key +
        ":" +
        parsed.data.key +
        ":" +
        parsed.data.target,
    })
    .select("id")
    .single();

  if (decisionError) {
    await admin
      .from("operative_tasks")
      .update({
        status: "blocked",
        error: "Unable to create required secret-change Decision Brief.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", organization.id);

    return NextResponse.json(
      { error: "Secret task was created but its Decision Brief failed." },
      { status: 500 },
    );
  }

  await admin
    .from("operative_tasks")
    .update({ status: "awaiting_approval", updated_at: new Date().toISOString() })
    .eq("id", task.id)
    .eq("organization_id", organization.id)
    .eq("status", "planning");

  await admin.from("task_events").insert({
    task_id: task.id,
    organization_id: organization.id,
    event_type: "approval_requested",
    from_status: "planning",
    to_status: "awaiting_approval",
    actor: "system",
    detail: {
      decisionId: decision.id,
      projectKey: allowed.project.key,
      key: parsed.data.key,
      target: parsed.data.target,
      secretValueStored: false,
    },
  });

  if (parsed.data.conversationId) {
    await admin.from("conversation_messages").insert({
      conversation_id: parsed.data.conversationId,
      organization_id: organization.id,
      actor_id: "system",
      actor_type: "system",
      channel: "system",
      message_type: "decision_brief",
      text: renderDecisionBriefText(brief),
      linked_task_id: task.id,
      linked_decision_id: decision.id,
    });
  }

  return NextResponse.json(
    {
      taskId: task.id,
      decisionId: decision.id,
      status: "awaiting_approval",
      brokerConfigured: secretBrokerConfigured(),
      projectKey: allowed.project.key,
      key: parsed.data.key,
      target: parsed.data.target,
      valueRequested: false,
    },
    { status: 201 },
  );
}
