import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (organizationError) {
    return NextResponse.json({ error: organizationError.message }, { status: 500 });
  }

  if (!organization) {
    return NextResponse.json({
      organization: null,
      conversation: null,
      messages: [],
      tasks: [],
      pendingDecisions: [],
    });
  }

  const { data: conversations, error: conversationError } = await supabase
    .from("conversations")
    .select("id, title, primary_channel, status, created_at, updated_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  if (conversationError) {
    return NextResponse.json({ error: conversationError.message }, { status: 500 });
  }

  const conversation = conversations?.[0] ?? null;

  const [messagesResult, tasksResult, decisionsResult] = await Promise.all([
    conversation
      ? supabase
          .from("conversation_messages")
          .select(
            "id, actor_id, actor_type, channel, message_type, text, attachments, linked_task_id, linked_decision_id, created_at",
          )
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: true })
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("operative_tasks")
      .select(
        "id, conversation_id, title, description, status, risk_level, requires_owner_approval, selected_executor, max_spend_microunits, actual_spend_microunits, result, error, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("decisions")
      .select(
        "id, task_id, conversation_id, proposal_summary, rationale, expected_outcome_if_approved, expected_outcome_if_declined, estimated_cost_cents, estimated_savings_cents, risk_level, required_scopes, rollback_plan, recommended_action, status, created_at",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const firstError = messagesResult.error ?? tasksResult.error ?? decisionsResult.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({
    organization,
    conversation,
    messages: messagesResult.data ?? [],
    tasks: tasksResult.data ?? [],
    pendingDecisions: decisionsResult.data ?? [],
  });
}
