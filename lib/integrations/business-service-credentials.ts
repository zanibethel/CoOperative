import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type BusinessOwnedServiceCredential = {
  serviceId: string;
  organizationId: string;
  providerKey: string;
  credential: string;
};

function userIdFromOwnerRef(ownerRef: string) {
  const match = /^coop-user:([0-9a-f-]{36})$/i.exec(ownerRef);
  return match?.[1] || null;
}

export async function businessOwnedServiceCredentialForOwner(
  ownerRef: string,
  providerKey: string,
): Promise<BusinessOwnedServiceCredential | null> {
  const userId = userIdFromOwnerRef(ownerRef);
  if (!userId) return null;

  const admin = createAdminSupabaseClient();
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (organizationError || !organization) return null;

  const { data: service, error: serviceError } = await admin
    .from("connected_services")
    .select("id,organization_id,provider_key,connection_status")
    .eq("organization_id", organization.id)
    .eq("provider_key", providerKey)
    .eq("connection_status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (serviceError || !service) return null;

  const { data: credential, error: credentialError } = await admin.rpc(
    "read_connected_service_credential",
    { p_service_id: service.id },
  );

  if (
    credentialError ||
    typeof credential !== "string" ||
    credential.length < 8
  ) {
    return null;
  }

  return {
    serviceId: service.id,
    organizationId: service.organization_id,
    providerKey: service.provider_key,
    credential,
  };
}


export async function connectedServiceStatusesForOwner(ownerRef: string) {
  const userId = userIdFromOwnerRef(ownerRef);
  if (!userId) return [];

  const admin = createAdminSupabaseClient();
  const { data: organizations, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId);
  if (organizationError) throw organizationError;

  const organizationIds = (organizations || []).map((row) => row.id);
  if (!organizationIds.length) return [];

  const { data: services, error: serviceError } = await admin
    .from("connected_services")
    .select("provider_key,connection_status,updated_at")
    .in("organization_id", organizationIds)
    .order("updated_at", { ascending: false });
  if (serviceError) throw serviceError;

  const latest = new Map<
    string,
    { providerKey: string; status: string; updatedAt: string | null }
  >();

  for (const service of services || []) {
    const providerKey =
      typeof service.provider_key === "string" ? service.provider_key : "";
    if (!providerKey || latest.has(providerKey)) continue;
    latest.set(providerKey, {
      providerKey,
      status:
        typeof service.connection_status === "string"
          ? service.connection_status
          : "unknown",
      updatedAt:
        typeof service.updated_at === "string" ? service.updated_at : null,
    });
  }

  return Array.from(latest.values());
}
