const INSTALLER_URL =
  "https://github.com/zanibethel/CoOperative/releases/download/unison-windows-preview/CoOperative-Unison-Setup.exe";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const upstream = await fetch(INSTALLER_URL, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent": "CoOperative-Unison-Installer-Proxy",
      },
    });

    if (!upstream.ok || !upstream.body) {
      return new Response(
        "The polished Windows installer preview is still being built. Use the current installer fallback and try again shortly.",
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }

    const contentLength = upstream.headers.get("content-length");

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.microsoft.portable-executable",
        "Content-Disposition":
          'attachment; filename="CoOperative-Unison-Setup.exe"',
        "Cache-Control": "no-store",
        ...(contentLength ? { "Content-Length": contentLength } : {}),
      },
    });
  } catch {
    return new Response(
      "The polished Windows installer preview is unavailable right now.",
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
