import { NextResponse } from "next/server";
import { pollHermesMediaTask } from "@/lib/inference/hermes-media-cloud";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROBE_KEY = "probe-4c41f95e8a8d4a769cc79d8b";
const SANDBOX = "cooperative-media-b4999d43-f50a-41f1-8138-d204388d73ae";
const DEADLINE = "2026-10-03T20:26:53.344Z";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("key") !== PROBE_KEY) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const result = await pollHermesMediaTask({
    sandboxName: SANDBOX,
    deadlineAt: DEADLINE,
  });

  return NextResponse.json({
    state: result.state,
    mediaUrl: result.mediaUrl,
    error: result.error,
    usage: result.usage,
    stdoutTail: result.stdout.slice(-1200),
    stderrTail: result.stderr.slice(-1200),
  }, { headers: { "Cache-Control": "no-store" } });
}
