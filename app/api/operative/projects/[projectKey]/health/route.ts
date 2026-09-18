import { NextResponse } from "next/server";

import { getLinkedProject } from "@/lib/operative/project-registry";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectKey: string }> },
) {
  const { projectKey } = await params;
  const project = getLinkedProject(projectKey);
  if (!project) {
    return NextResponse.json({ error: "Unknown linked project." }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!project.integrationHealthUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: "This project does not expose an allow-listed integration health endpoint yet.",
      },
      { status: 409 },
    );
  }

  try {
    const response = await fetch(project.integrationHealthUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { text: (await response.text()).slice(0, 4000) };

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      project: project.key,
      checkedUrl: project.integrationHealthUrl,
      data,
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        project: project.key,
        error:
          error instanceof Error
            ? error.message
            : "Unable to reach the linked project's integration health endpoint.",
      },
      { status: 502 },
    );
  }
}
