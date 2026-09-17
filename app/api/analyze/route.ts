import { NextResponse } from "next/server";
import { deriveDemoAssessment } from "@/lib/analysis/derive-demo-assessment";
import { BusinessIntakeSchema } from "@/lib/domain/schemas";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = BusinessIntakeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid business intake", issues: parsed.error.flatten() },
        { status: 400 },
      );
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
      return NextResponse.json(
        { error: "Create a workspace before running a Mission Briefing.", code: "NO_ORGANIZATION" },
        { status: 409 },
      );
    }

    const result = deriveDemoAssessment(parsed.data);
    const now = new Date().toISOString();

    const existingBusiness = await supabase
      .from("businesses")
      .select("id")
      .eq("organization_id", organization.id)
      .eq("name", parsed.data.businessName)
      .limit(1)
      .maybeSingle();

    if (existingBusiness.error) {
      return NextResponse.json({ error: existingBusiness.error.message }, { status: 500 });
    }

    let businessId = existingBusiness.data?.id;

    if (businessId) {
      const { error } = await supabase
        .from("businesses")
        .update({
          industry: parsed.data.industry,
          team_size: parsed.data.teamSize,
          profile: parsed.data,
          updated_at: now,
        })
        .eq("id", businessId)
        .eq("organization_id", organization.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    } else {
      const { data, error } = await supabase
        .from("businesses")
        .insert({
          organization_id: organization.id,
          name: parsed.data.businessName,
          industry: parsed.data.industry,
          team_size: parsed.data.teamSize,
          profile: parsed.data,
        })
        .select("id")
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      businessId = data.id;
    }

    const { data: assessment, error: assessmentError } = await supabase
      .from("assessments")
      .insert({
        organization_id: organization.id,
        business_id: businessId,
        created_by: user.id,
        status: "completed",
        analyzer_version: "deterministic-v0.1",
        intake: parsed.data,
        result,
      })
      .select("id")
      .single();

    if (assessmentError) {
      return NextResponse.json({ error: assessmentError.message }, { status: 500 });
    }

    return NextResponse.json({
      ...result,
      persistence: {
        organizationId: organization.id,
        businessId,
        assessmentId: assessment.id,
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to analyze this assessment." }, { status: 500 });
  }
}
