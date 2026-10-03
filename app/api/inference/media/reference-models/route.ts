import { NextResponse } from "next/server";

import { authenticatedUserId } from "@/lib/supabase/auth";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import { discoverNousReferenceImageModels } from "@/lib/inference/nous-reference-image-discovery";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const userId = await authenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = `coop-user:${userId}`;

  try {
    const [catalog, connected] = await Promise.all([
      discoverNousReferenceImageModels(),
      businessOwnedServiceCredentialForOwner(ownerRef, "nous-portal"),
    ]);

    let authUsable = false;
    let authDetail: string | null = null;
    if (connected) {
      try {
        authUsable = Boolean(await freshNousRuntimeAuthForOwner(ownerRef));
      } catch (error) {
        authDetail =
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Nous Portal authorization is not currently usable.";
      }
    }

    return NextResponse.json(
      {
        ...catalog,
        nousConnection: {
          connected: Boolean(connected),
          authUsable,
          authDetail,
        },
        verificationBoundary: {
          hermesCatalogCapability: "verified",
          livePricing: "checked-per-model",
          managedNousGatewayAllowlist: "not-probed",
          reason:
            "This discovery endpoint performs no generation call. A public fal endpoint and pinned Hermes edit capability do not prove that the connected Nous Subscription gateway currently allowlists that model.",
        },
      },
      {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "Could not discover reference-image capabilities.";

    return NextResponse.json(
      {
        error: "Could not discover reference-image capabilities.",
        detail: detail.slice(0, 800),
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
