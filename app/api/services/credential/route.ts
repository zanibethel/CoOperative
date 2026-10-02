import { NextResponse } from "next/server";
import { z } from "zod";

import {
  isBusinessAiProviderKey,
  validateBusinessAiCredential,
} from "@/lib/integrations/business-ai-providers";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const connectSchema = z.object({
  serviceId: z.string().uuid(),
  credential: z.string().min(8).max(20_000),
});

const disconnectSchema = z.object({
  serviceId: z.string().uuid(),
});

async function serviceForCurrentOwner(serviceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: service, error } = await supabase
    .from("connected_services")
    .select("id,organization_id,provider_key,connection_method,service_name")
    .eq("id", serviceId)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: "Could not load service." }, { status: 502 }) };
  }
  if (!service) {
    return { error: NextResponse.json({ error: "Service not found." }, { status: 404 }) };
  }

  return { supabase, user, service };
}

export async function POST(request: Request) {
  try {
    const input = connectSchema.parse(await request.json());
    const context = await serviceForCurrentOwner(input.serviceId);
    if ("error" in context) return context.error;

    const { supabase, service } = context;
    const providerKey =
      typeof service.provider_key === "string" ? service.provider_key : "";

    if (
      service.connection_method !== "api" ||
      !isBusinessAiProviderKey(providerKey)
    ) {
      return NextResponse.json(
        { error: "This service does not support direct AI credential connection." },
        { status: 409 },
      );
    }

    const check = await validateBusinessAiCredential(
      providerKey,
      input.credential,
    );

    const admin = createAdminSupabaseClient();
    const { error: storeError } = await admin.rpc(
      "store_connected_service_credential",
      {
        p_service_id: service.id,
        p_secret: input.credential.trim(),
      },
    );

    if (storeError) {
      console.error("Could not store connected service credential", {
        serviceId: service.id,
        providerKey,
        detail: storeError.message.slice(0, 500),
      });
      return NextResponse.json(
        { error: "Credential was verified but could not be stored securely." },
        { status: 502 },
      );
    }

    const modelTags = check.models.slice(0, 20).map((model) => `model:${model}`);
    const mediaCapabilities =
      providerKey === "openrouter-api"
        ? ["image-generation", "video-generation"]
        : [];
    const { error: updateError } = await supabase
      .from("connected_services")
      .update({
        connection_status: "connected",
        data_available: [
          "text-generation",
          ...mediaCapabilities,
          "migration-assist",
          ...modelTags,
        ],
        permissions:
          providerKey === "openrouter-api"
            ? ["inference:execute", "media:generate"]
            : ["inference:execute"],
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", service.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Credential connected, but service metadata could not be updated." },
        { status: 502 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        connected: true,
        providerKey,
        availableModels: check.models.slice(0, 20),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not connect AI service.";
    return NextResponse.json(
      { error: detail.slice(0, 400) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = disconnectSchema.parse(await request.json());
    const context = await serviceForCurrentOwner(input.serviceId);
    if ("error" in context) return context.error;

    const { supabase, service } = context;
    const admin = createAdminSupabaseClient();
    const { error: clearError } = await admin.rpc(
      "clear_connected_service_credential",
      { p_service_id: service.id },
    );

    if (clearError) {
      console.error("Could not clear connected service credential", {
        serviceId: service.id,
        detail: clearError.message.slice(0, 500),
      });
      return NextResponse.json(
        { error: "Could not disconnect this service." },
        { status: 502 },
      );
    }

    await supabase
      .from("connected_services")
      .update({
        connection_status: "disconnected",
        data_available: [],
        permissions: [],
        last_synced_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", service.id);

    return NextResponse.json(
      { ok: true, connected: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not disconnect service.";
    return NextResponse.json(
      { error: detail.slice(0, 400) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
