import { NextResponse } from "next/server";
import { z } from "zod";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

const contributorSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("unison_contributors")
    .select("user_id,display_name,contact_email,status,payout_status,joined_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load contributor profile." }, { status: 502 });
  }

  return NextResponse.json({ contributor: data ?? null });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Sign in with an email account first." }, { status: 401 });
  }

  const parsed = contributorSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "A display name is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("unison_contributors")
    .upsert(
      {
        user_id: user.id,
        display_name: parsed.data.displayName,
        contact_email: user.email,
        status: "active",
        updated_at: now,
      },
      { onConflict: "user_id" },
    )
    .select("user_id,display_name,contact_email,status,payout_status,joined_at")
    .single();

  if (error) {
    console.error("Unison contributor signup failed", { detail: error.message.slice(0, 500) });
    return NextResponse.json({ error: "Could not create contributor profile." }, { status: 502 });
  }

  return NextResponse.json({ contributor: data }, { status: 201 });
}
