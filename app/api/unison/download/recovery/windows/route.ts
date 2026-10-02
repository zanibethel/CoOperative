import { NextResponse } from "next/server";
import { z } from "zod";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { canManageNode } from "@/lib/unison/node-access";

export const runtime = "nodejs";

const querySchema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  mode: z.enum(["repair", "restart"]),
});

function quoteBatch(value: string) {
  return value.replaceAll("%", "%%").replaceAll('"', '""');
}

export async function GET(request: Request) {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    nodeId: url.searchParams.get("nodeId"),
    mode: url.searchParams.get("mode"),
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid recovery request." }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  if (!(await canManageNode(admin, userId, parsed.data.nodeId))) {
    return NextResponse.json(
      { error: "Only a device owner or admin can repair or restart this node." },
      { status: 403 },
    );
  }

  const { data: node, error } = await admin
    .from("unison_nodes")
    .select("id,display_name")
    .eq("id", parsed.data.nodeId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not verify this node." }, { status: 502 });
  }

  if (!node) {
    return NextResponse.json({ error: "Node not found." }, { status: 404 });
  }

  const expectedNodeId = quoteBatch(node.id);
  let filename: string;
  let body: string;

  if (parsed.data.mode === "repair") {
    filename = "Repair-CoOperative-Unison.cmd";
    const repairUrl =
      "https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/repair-unison-windows.ps1";

    body = [
      "@echo off",
      "setlocal",
      "title Repair CoOperative Unison",
      "echo.",
      "echo Repairing CoOperative Unison...",
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=Join-Path $env:TEMP 'repair-cooperative-unison.ps1'; Invoke-WebRequest -UseBasicParsing -Uri '${repairUrl}' -OutFile $p; & $p -ExpectedNodeId '${expectedNodeId}'"`,
      "if errorlevel 1 (",
      "  echo.",
      "  echo Repair did not finish. Leave this window open and review the message above.",
      "  pause",
      "  exit /b 1",
      ")",
      "echo.",
      "echo Repair complete. Return to the CoOperative dashboard.",
      "timeout /t 3 /nobreak >nul",
      "exit /b 0",
      "",
    ].join("\r\n");
  } else {
    filename = "Restart-CoOperative-Unison.cmd";
    body = [
      "@echo off",
      "setlocal",
      "title Restart CoOperative Unison",
      "echo.",
      "echo Restarting CoOperative Unison...",
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $expected='${expectedNodeId}'; $machine=[Environment]::GetEnvironmentVariable('UNISON_NODE_ID','Machine'); $user=[Environment]::GetEnvironmentVariable('UNISON_NODE_ID','User'); $actual=if($machine){$machine}else{$user}; if (-not $actual) { throw 'This PC does not have a paired Unison node.' }; if ($actual -ne $expected) { throw ('This PC is paired as ' + $actual + ', not ' + $expected) }; $dir=if($machine){Join-Path $env:ProgramData 'CoOperative\\Unison'}else{Join-Path $env:LOCALAPPDATA 'CoOperative\\Unison'}; $control=Join-Path $dir 'control-unison-windows.ps1'; if (-not (Test-Path $control)) { throw 'Restart helper is missing. Use Repair connection first.' }; & $control 'restart'"`,
      "if errorlevel 1 (",
      "  echo.",
      "  echo Restart did not finish. Try Repair connection from the dashboard.",
      "  pause",
      "  exit /b 1",
      ")",
      "echo.",
      "echo Restart requested. Return to the CoOperative dashboard.",
      "timeout /t 3 /nobreak >nul",
      "exit /b 0",
      "",
    ].join("\r\n");
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
