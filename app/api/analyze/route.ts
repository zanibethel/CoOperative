import { NextResponse } from "next/server";
import { deriveDemoAssessment } from "@/lib/analysis/derive-demo-assessment";
import { BusinessIntakeSchema } from "@/lib/domain/schemas";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = BusinessIntakeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid business intake", issues: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = deriveDemoAssessment(parsed.data);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Unable to analyze this assessment." }, { status: 500 });
  }
}
