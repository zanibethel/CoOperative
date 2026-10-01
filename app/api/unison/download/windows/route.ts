import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.redirect(
    "https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/bootstrap-unison-windows.ps1",
    307,
  );
}
