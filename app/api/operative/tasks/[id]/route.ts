import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
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

  const { data: task, error: taskError } = await supabase
    .from("operative_tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const [eventsResult, decisionsResult, costsResult] = await Promise.all([
    supabase
      .from("task_events")
      .select("id, event_type, from_status, to_status, actor, detail, created_at")
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("decisions")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("cost_ledger_entries")
      .select("id, executor, cost_category, amount_microunits, currency, is_marginal_cost, notes, created_at")
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const firstError = eventsResult.error ?? decisionsResult.error ?? costsResult.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  return NextResponse.json({
    task,
    events: eventsResult.data ?? [],
    decisions: decisionsResult.data ?? [],
    costs: costsResult.data ?? [],
  });
}
