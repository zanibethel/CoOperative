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
