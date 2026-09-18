import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applyProjectSecret,
  getAllowedSecretRequirement,
  SecretBrokerSetupRequiredError,
} from "@/lib/operative/vercel-secret-broker";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ApplySecretSchema = z.object({
  taskId: z.string().uuid(),
  key: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_]+$/),
  target: z.enum(["preview", "production"]),
  value: z.string().min(1).max(20_000),
});

function secretRequestFromResult(result: unknown): {
  projectKey?: string;
  key?: string;
  target?: string;
} | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const request = (result as Record<string, unknown>).secretRequest;
  if (!request || typeof request !== "object" || Array.isArray(request)) return null;
  const record = request as Record<string, unknown>;
  return {
    projectKey: typeof record.projectKey === "string" ? record.projectKey : undefined,
    key: typeof record.key === "string" ? record.key : undefined,
    target: typeof record.target === "string" ? record.target : undefined,
  };
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

  const parsed = ApplySecretSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid secret application request", issues: parsed.error.issues },
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
      { error: "Secret request is not allow-listed.", code: "SECRET_NOT_ALLOW_LISTED" },
      { status: 400 },
    );
  }

  const { data: task, error: taskError } = await supabase
    .from("operative_tasks")
    .select("id,organization_id,status,result")
    .eq("id", parsed.data.taskId)
    .maybeSingle();

  if (taskError) {
    return NextResponse.json({ error: taskError.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Secret task not found." }, { status: 404 });
  }

  const secretRequest = secretRequestFromResult(task.result);
  if (
    secretRequest?.projectKey !== projectKey ||
    secretRequest.key !== parsed.data.key ||
    secretRequest.target !== parsed.data.target
  ) {
    return NextResponse.json(
      {
        error:
          "The submitted secret value does not match the exact project/key/target that was approved.",
        code: "SECRET_APPROVAL_SCOPE_MISMATCH",
      },
      { status: 409 },
    );
  }

  const { data: approvedDecision, error: decisionError } = await supabase
    .from("decisions")
    .select("id,status")
    .eq("task_id", task.id)
    .eq("status", "approved")
    .order("resolved_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (decisionError) {
    return NextResponse.json({ error: decisionError.message }, { status: 500 });
  }
  if (!approvedDecision) {
    return NextResponse.json(
      {
        error: "Owner approval is required before CoOperative can accept the secret value.",
        code: "OWNER_APPROVAL_REQUIRED",
      },
      { status: 409 },
    );
  }

  if (!["awaiting_approval", "failed"].includes(task.status)) {
    return NextResponse.json(
      {
        error: "Secret task is not ready for value application.",
        status: task.status,
      },
      { status: 409 },
    );
  }

  const admin = createAdminClient();
  const { data: claimed, error: claimError } = await admin
    .from("operative_tasks")
    .update({
      status: "executing",
      selected_executor: "deterministic-code",
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("organization_id", task.organization_id)
    .in("status", ["awaiting_approval", "failed"])
    .select("id")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json(
      { error: "Secret task changed before it could be claimed.", code: "TASK_CONFLICT" },
      { status: 409 },
    );
  }

  await admin.from("task_events").insert({
    task_id: task.id,
    organization_id: task.organization_id,
    event_type: "status_changed",
    from_status: task.status,
    to_status: "executing",
    actor: user.id,
    detail: {
      type: "secret_broker_started",
      projectKey,
      key: parsed.data.key,
      target: parsed.data.target,
      valueStoredInCoOperative: false,
      valueSharedWithHermes: false,
    },
  });

  try {
    const applied = await applyProjectSecret({
      projectKey,
      key: parsed.data.key,
      target: parsed.data.target,
      value: parsed.data.value,
    });

    const now = new Date().toISOString();
    const current =
      task.result && typeof task.result === "object" && !Array.isArray(task.result)
        ? (task.result as Record<string, unknown>)
        : {};

    const verifyingResult = {
      ...current,
      secretApplied: {
        projectKey,
        key: applied.key,
        target: applied.target,
        provider: applied.provider,
        type: applied.type,
        appliedAt: now,
        valueStoredInCoOperative: false,
        valueSharedWithHermes: false,
        deploymentPerformed: false,
      },
    };

    await admin
      .from("operative_tasks")
      .update({
        status: "verifying",
        result: verifyingResult,
        actual_spend_microunits: 0,
        updated_at: now,
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id)
      .eq("status", "executing");

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: "executing",
      to_status: "verifying",
      actor: "system",
      detail: {
        verification:
          "Vercel accepted the owner-approved allow-listed environment-variable upsert.",
        projectKey,
        key: applied.key,
        target: applied.target,
        valueStoredInCoOperative: false,
        deploymentPerformed: false,
      },
    });

    await admin
      .from("operative_tasks")
      .update({
        status: "completed",
        result: verifyingResult,
        actual_spend_microunits: 0,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id)
      .eq("status", "verifying");

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: "status_changed",
      from_status: "verifying",
      to_status: "completed",
      actor: "system",
      detail: {
        verification:
          "Secret broker completed without persisting or exposing the secret value.",
        projectKey,
        key: applied.key,
        target: applied.target,
        nextGate:
          "Environment changes take effect only on a new deployment; no redeploy was performed.",
      },
    });

    const { data: existingCost } = await admin
      .from("cost_ledger_entries")
      .select("id")
      .eq("task_id", task.id)
      .eq("executor", "deterministic-code")
      .eq("cost_category", "other")
      .limit(1)
      .maybeSingle();

    if (!existingCost) {
      await admin.from("cost_ledger_entries").insert({
        organization_id: task.organization_id,
        task_id: task.id,
        executor: "deterministic-code",
        cost_category: "other",
        amount_microunits: 0,
        currency: "USD",
        is_marginal_cost: true,
        notes:
          "Owner-approved secret broker write. Secret value was not persisted in CoOperative or exposed to Hermes. No deployment was performed.",
      });
    }

    return NextResponse.json({
      taskId: task.id,
      status: "completed",
      projectKey,
      key: applied.key,
      target: applied.target,
      valueStoredInCoOperative: false,
      valueSharedWithHermes: false,
      deploymentPerformed: false,
      nextGate:
        "A new preview or production deployment is required before the updated environment variable is used.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Secret broker write failed.";

    const setupRequired = error instanceof SecretBrokerSetupRequiredError;
    await admin
      .from("operative_tasks")
      .update({
        status: setupRequired ? "awaiting_approval" : "failed",
        error: setupRequired ? null : message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("organization_id", task.organization_id)
      .eq("status", "executing");

    await admin.from("task_events").insert({
      task_id: task.id,
      organization_id: task.organization_id,
      event_type: setupRequired ? "note" : "error",
      actor: "system",
      detail: {
        stage: "secret_broker",
        projectKey,
        key: parsed.data.key,
        target: parsed.data.target,
        message,
        valueStoredInCoOperative: false,
        valueSharedWithHermes: false,
      },
    });

    return NextResponse.json(
      {
        error: message,
        code: setupRequired
          ? "SECRET_BROKER_SETUP_REQUIRED"
          : "SECRET_BROKER_WRITE_FAILED",
        valueStoredInCoOperative: false,
      },
      { status: setupRequired ? 503 : 502 },
    );
  }
}
