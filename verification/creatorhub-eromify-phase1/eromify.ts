/**
 * Eromify Provider Abstraction - Phase 1
 *
 * This module defines CreatorHub's boundary for mapping an internal creator
 * identity to an external Eromify persona/model identifier.
 *
 * OWNER-GATED: persistent storage requires a separately approved database
 * change. Phase 1 intentionally contains no provider calls, secrets,
 * integration-health UI, generation jobs, publishing, or deployment work.
 */

export type EromifyProvider = "eromify";

export function isEromifyProvider(value: string): value is EromifyProvider {
  return value === "eromify";
}

export type EromifyCreatorIdentity = {
  creatorId: string;
  creatorSlug: string;
  creatorType: "human" | "business" | "ai";
  niche?: string | null;
  tone?: string | null;
};

export type EromifyPersonaReference = {
  personaId: string;
  handle?: string | null;
};

export type EromifyMappingRecord = {
  id: string;
  creatorHubIdentity: EromifyCreatorIdentity;
  eromifyPersona: EromifyPersonaReference;
  createdAt: Date;
  updatedAt: Date;
};

export type EromifyIntegrationStatus = {
  configured: boolean;
  reachable: boolean;
  detail: string;
  hasActiveMappings: boolean;
};

export type EromifyErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH_FAILED"
  | "PERSONA_NOT_FOUND"
  | "MAPPING_EXISTS"
  | "MAPPING_NOT_FOUND"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "NETWORK_ERROR";

export class EromifyError extends Error {
  constructor(
    message: string,
    public readonly code: EromifyErrorCode,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "EromifyError";
  }
}

/**
 * Contract only. Implementations are intentionally out of scope for Phase 1.
 */
export interface IEromifyClient {
  authenticate(): Promise<void>;
  createPersona(
    identity: EromifyCreatorIdentity,
  ): Promise<EromifyMappingRecord>;
  getPersonaByCreatorId(
    creatorId: string,
  ): Promise<EromifyMappingRecord | null>;
  updatePersonaMapping(
    creatorId: string,
    updatedData: Partial<EromifyMappingRecord>,
  ): Promise<EromifyMappingRecord>;
  disconnectPersona(creatorId: string): Promise<void>;
  getStatus(): Promise<EromifyIntegrationStatus>;
}

export function validateEromifyCreatorIdentity(
  identity: unknown,
): identity is EromifyCreatorIdentity {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    return false;
  }

  const record = identity as Record<string, unknown>;

  if (typeof record.creatorId !== "string") return false;
  if (typeof record.creatorSlug !== "string") return false;
  if (
    typeof record.creatorType !== "string" ||
    !["human", "business", "ai"].includes(record.creatorType)
  ) {
    return false;
  }
  if (
    record.niche !== undefined &&
    record.niche !== null &&
    typeof record.niche !== "string"
  ) {
    return false;
  }
  if (
    record.tone !== undefined &&
    record.tone !== null &&
    typeof record.tone !== "string"
  ) {
    return false;
  }

  return true;
}

export function validateEromifyPersonaReference(
  ref: unknown,
): ref is EromifyPersonaReference {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
    return false;
  }

  const record = ref as Record<string, unknown>;

  if (typeof record.personaId !== "string") return false;
  if (
    record.handle !== undefined &&
    record.handle !== null &&
    typeof record.handle !== "string"
  ) {
    return false;
  }

  return true;
}
