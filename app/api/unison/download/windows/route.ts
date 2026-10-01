const BOOTSTRAP_URL =
  "https://raw.githubusercontent.com/zanibethel/CoOperative/main/workers/bootstrap-unison-windows.ps1";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const upstream = await fetch(BOOTSTRAP_URL, {
      cache: "no-store",
      headers: {
        "User-Agent": "CoOperative-Unison-Downloader",
      },
    });

    if (!upstream.ok) {
      return new Response("Could not fetch the Unison bootstrap script.", {
        status: 502,
      });
    }

    const script = await upstream.text();

    return new Response(script, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          'attachment; filename="CoOperative-Unison-Setup.ps1"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Could not fetch the Unison bootstrap script.", {
      status: 502,
    });
  }
}
