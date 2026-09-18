import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDecisionBrief,
  renderDecisionBriefText,
} from "@/lib/operative/decision-brief";
import {
  OwnerTaskIntentSchema,
  evaluateOwnerTaskPolicy,
} from "@/lib/operative/task-policy";

function adminUnavailable(error: unknown) {
  return error instanceof Error && error.message.includes("Missing server-only Supabase configuration");
}

function requiredScopes(flags: {
  changesProduction?: boolean;
  touchesSecrets?: boolean;
  changesDatabase?: boolean;
  movesMoney?: boolean;
  destructive?: boolean;
}) {
  const scopes: string[] = [];
  if (flags.changesProduction) scopes.push("production-change");
  if (flags.touchesSecrets) scopes.push("secret-access");
  if (flags.changesDatabase) scopes.push("database-or-rls-change");
  if (flags.movesMoney) scopes.push("money-movement");
  if (flags.destructive) scopes.push("destructive-action");
  return scopes;
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

  let decisionId: string | null = null;

  if (policy.requiresOwnerApproval) {
    const now = new Date().toISOString();

    const { error: planningError } = await admin
      .from("operative_tasks")
      .update({ status: "planning", updated_at: now })
      .eq("id", task.id)
      .eq("organization_id", organization.id)
      .eq("status", "queued");

    if (planningError) {
      return NextResponse.json({ error: planningError.message }, { status: 500 });
    }

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: organization.id,
      event_type: "status_changed",
      from_status: "queued",
      to_status: "planning",
      actor: "system",
      detail: { reason: "owner-gated task requires a Decision Brief before execution" },
    });

    const maxSpendDollars = (policy.maxSpendMicrounits / 1_000_000).toFixed(2);
    const brief = buildDecisionBrief({
      taskId: task.id,
      conversationId: parsed.data.conversationId ?? null,
      proposalSummary: parsed.data.title,
      rationale:
        "CoOperative policy paused this task because it includes: " +
        policy.reasons.join(", ") +
        ". The maximum incremental spend authorized on the task is $" +
        maxSpendDollars +
        "; that value is a cap, not an estimated cost.",
      expectedOutcomeIfApproved:
        "The task becomes eligible for governed executor selection. Approval does not bypass later policy, permission, cost, verification, or rollback checks.",
      expectedOutcomeIfDeclined:
        "No guarded execution will begin. The task remains stopped unless the owner later creates or modifies a replacement task.",
      estimatedCostCents: 0,
      riskLevel: policy.riskLevel,
      requiredScopes: requiredScopes(parsed.data.flags ?? {}),
      rollbackPlan:
        "No guarded execution has occurred yet. Rejecting at this gate prevents the protected action from starting.",
      recommendedAction:
        "Review the requested scope and spend cap. Approve, reject, modify, or ask a question from the same canonical thread.",
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
        estimated_cost_cents: brief.estimatedCostCents,
        estimated_savings_cents: brief.estimatedSavingsCents,
        risk_level: brief.riskLevel,
        required_scopes: brief.requiredScopes,
        rollback_plan: brief.rollbackPlan,
        recommended_action: brief.recommendedAction,
        status: "pending",
        idempotency_key: "initial-owner-gate",
      })
      .select("id")
      .single();

    if (decisionError) {
      await admin
        .from("operative_tasks")
        .update({
          status: "blocked",
          error: "Unable to create required Decision Brief.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", task.id)
        .eq("organization_id", organization.id);

      await admin.from("task_events").insert({
        task_id: task.id,
        organization_id: organization.id,
        event_type: "error",
        actor: "system",
        detail: { stage: "decision_brief", message: decisionError.message },
      });

      return NextResponse.json(
        { error: "Task was created but its required Decision Brief could not be persisted." },
        { status: 500 },
      );
    }

    decisionId = decision.id;

    const { error: awaitingError } = await admin
      .from("operative_tasks")
      .update({ status: "awaiting_approval", updated_at: new Date().toISOString() })
      .eq("id", task.id)
      .eq("organization_id", organization.id)
      .eq("status", "planning");

    if (awaitingError) {
      return NextResponse.json({ error: awaitingError.message }, { status: 500 });
    }

    const { error: approvalEventError } = await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: organization.id,
      event_type: "approval_requested",
      from_status: "planning",
      to_status: "awaiting_approval",
      actor: "system",
      detail: { decisionId: decision.id, policyReasons: policy.reasons },
    });

    if (approvalEventError) {
      return NextResponse.json(
        { error: "Decision Brief exists but its approval audit event could not be persisted." },
        { status: 500 },
      );
    }

    if (parsed.data.conversationId) {
      const { error: messageError } = await admin.from("conversation_messages").insert({
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

      if (messageError) {
        return NextResponse.json(
          { error: "Decision Brief exists but could not be appended to the canonical thread." },
          { status: 500 },
        );
      }
    }
  }

  const { data: finalTask, error: finalTaskError } = await admin
    .from("operative_tasks")
    .select(
      "id, conversation_id, title, description, status, risk_level, requires_owner_approval, max_spend_microunits, actual_spend_microunits, created_at, updated_at",
    )
    .eq("id", task.id)
    .eq("organization_id", organization.id)
    .single();

  if (finalTaskError) {
    return NextResponse.json({ error: finalTaskError.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      task: finalTask,
      policy,
      decisionId,
    },
    { status: 201 },
  );
}
