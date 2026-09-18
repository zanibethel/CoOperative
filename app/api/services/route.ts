import { NextResponse } from "next/server";
import {
  ConnectedServiceInputSchema,
  ConnectedServiceUpdateSchema,
} from "@/lib/domain/schemas";
import { createClient } from "@/lib/supabase/server";

async function getContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("id,name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  }

  if (!organization) {
    return {
      error: NextResponse.json(
        { error: "Create a workspace before adding services.", code: "NO_ORGANIZATION" },
        { status: 409 },
      ),
    };
  }

  return { supabase, user, organization };
}

export async function GET() {
  const context = await getContext();
  if ("error" in context) return context.error;

  const { supabase, organization } = context;

  const [providersResult, servicesResult] = await Promise.all([
    supabase
      .from("service_providers")
      .select("provider_key,name,category,connection_method,connection_status,native_replacement_status")
      .order("name"),
    supabase
      .from("connected_services")
      .select("id,provider_key,service_name,external_account_label,connection_method,connection_status,monthly_cost_cents,billing_frequency,features_used,replacement_goal,native_coverage_percent,replacement_readiness_percent,estimated_monthly_savings_cents,notes,last_synced_at,created_at,updated_at")
      .eq("organization_id", organization.id)
      .order("created_at", { ascending: true }),
  ]);

  if (providersResult.error) {
    return NextResponse.json({ error: providersResult.error.message }, { status: 500 });
  }

  if (servicesResult.error) {
    return NextResponse.json({ error: servicesResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    organization,
    providers: providersResult.data ?? [],
    services: servicesResult.data ?? [],
  });
}

export async function POST(request: Request) {
  const context = await getContext();
  if ("error" in context) return context.error;

  const { supabase, user, organization } = context;
  const parsed = ConnectedServiceInputSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid connected service", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const { data, error } = await supabase
    .from("connected_services")
    .insert({
      organization_id: organization.id,
      provider_key: input.providerKey,
      service_name: input.serviceName,
      external_account_label: input.externalAccountLabel || null,
      connection_method: input.connectionMethod,
      connection_status: "manual",
      monthly_cost_cents: Math.round(input.monthlyCost * 100),
      billing_frequency: input.billingFrequency,
      features_used: input.featuresUsed,
      replacement_goal: input.replacementGoal,
      notes: input.notes || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getContext();
  if ("error" in context) return context.error;

  const { supabase, organization } = context;
  const parsed = ConnectedServiceUpdateSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid service update", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { id, ...input } = parsed.data;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.providerKey !== undefined) update.provider_key = input.providerKey;
  if (input.serviceName !== undefined) update.service_name = input.serviceName;
  if (input.externalAccountLabel !== undefined) update.external_account_label = input.externalAccountLabel || null;
  if (input.connectionMethod !== undefined) update.connection_method = input.connectionMethod;
  if (input.monthlyCost !== undefined) update.monthly_cost_cents = Math.round(input.monthlyCost * 100);
  if (input.billingFrequency !== undefined) update.billing_frequency = input.billingFrequency;
  if (input.featuresUsed !== undefined) update.features_used = input.featuresUsed;
  if (input.replacementGoal !== undefined) update.replacement_goal = input.replacementGoal;
  if (input.notes !== undefined) update.notes = input.notes || null;

  const { error } = await supabase
    .from("connected_services")
    .update(update)
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const context = await getContext();
  if ("error" in context) return context.error;

  const { supabase, organization } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing service id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("connected_services")
    .delete()
    .eq("id", id)
    .eq("organization_id", organization.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
