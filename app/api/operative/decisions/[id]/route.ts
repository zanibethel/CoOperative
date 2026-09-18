import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveDecision } from "@/lib/operative/decision-brief";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const OwnerDecisionActionSchema = z.object({
  action: z.enum(["approve", "reject", "modify", "ask_question"]),
  note: z.string().trim().max(2000).optional(),
});

function adminUnavailable(error: unknown) {
  return error instanceof Error && error.message.includes("Missing server-only Supabase configuration");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = OwnerDecisionActionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid decision response", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (
    (parsed.data.action === "modify" || parsed.data.action === "ask_question") &&
    !parsed.data.note
  ) {
    return NextResponse.json(
      { error: "A note or question is required for this action." },
      { status: 400 },
    );
  }

  const { data: decision, error: decisionError } = await supabase
    .from("decisions")
    .select("id, organization_id, task_id, conversation_id, status")
    .eq("id", id)
    .maybeSingle();

  if (decisionError) {
    return NextResponse.json({ error: decisionError.message }, { status: 500 });
  }

  if (!decision) {
    return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  }

  if (decision.status !== "pending") {
    return NextResponse.json(
      { error: "This decision has already been resolved.", code: "ALREADY_RESOLVED" },
      { status: 409 },
    );
  }

  const outcome = resolveDecision({
    decisionId: decision.id,
    action: parsed.data.action,
    resolvedBy: user.id,
    resolvedViaChannel: "owner-console",
    note: parsed.data.note,
  });

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

  if (parsed.data.action === "ask_question") {
    const { error: questionError } = await admin
      .from("decisions")
      .update({
        resolution_note: parsed.data.note ?? null,
      })
      .eq("id", decision.id)
      .eq("organization_id", decision.organization_id)
      .eq("status", "pending");

    if (questionError) {
      return NextResponse.json({ error: questionError.message }, { status: 500 });
    }
  } else {
    const status =
      outcome.status === "approved"
        ? "approved"
        : outcome.status === "rejected"
          ? "rejected"
          : "modified";

    const { data: resolved, error: resolutionError } = await admin
      .from("decisions")
      .update({
        status,
        resolved_by: user.id,
        resolved_via_channel: "owner-console",
        resolution_note: parsed.data.note ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", decision.id)
      .eq("organization_id", decision.organization_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (resolutionError) {
      return NextResponse.json({ error: resolutionError.message }, { status: 500 });
    }

    if (!resolved) {
      return NextResponse.json(
        { error: "Decision changed before this response was saved.", code: "DECISION_CONFLICT" },
        { status: 409 },
      );
    }
  }

  if (decision.task_id) {
    const { error: eventError } = await admin.from("task_events").insert({
      task_id: decision.task_id,
      organization_id: decision.organization_id,
      event_type: parsed.data.action === "ask_question" ? "note" : "approval_resolved",
      actor: user.id,
      detail: {
        decisionId: decision.id,
        action: parsed.data.action,
        note: parsed.data.note ?? null,
        outcome,
        executionResumed: false,
      },
    });

    if (eventError) {
      return NextResponse.json(
        {
          error: "Decision was saved but its task audit event could not be persisted.",
          detail: eventError.message,
        },
        { status: 500 },
      );
    }
  }

  if (decision.conversation_id) {
    const responseText =
      parsed.data.action === "approve"
        ? "Approved."
        : parsed.data.action === "reject"
          ? "Rejected."
          : parsed.data.action === "modify"
            ? "Modification requested: " + (parsed.data.note ?? "")
            : "Question before approval: " + (parsed.data.note ?? "");

    const { error: messageError } = await admin.from("conversation_messages").insert({
      conversation_id: decision.conversation_id,
      organization_id: decision.organization_id,
      actor_id: user.id,
      actor_type: "owner",
      channel: "owner-console",
      message_type: "approval_response",
      text: responseText,
      linked_task_id: decision.task_id,
      linked_decision_id: decision.id,
    });

    if (messageError) {
      return NextResponse.json(
        {
          error: "Decision was saved but the canonical conversation event could not be persisted.",
          detail: messageError.message,
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    decisionId: decision.id,
    action: parsed.data.action,
    outcome,
    executionResumed: false,
    note:
      "Decision recorded. Execution remains paused until the governed resume/executor layer is connected.",
  });
}
