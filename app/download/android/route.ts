import { NextResponse } from "next/server";

const ANDROID_ALPHA_APK =
  "https://github.com/zanibethel/CoOperative/releases/download/android-alpha/CoOperativeLocalAI.apk";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.redirect(ANDROID_ALPHA_APK, 307);
}
