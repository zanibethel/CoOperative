export type CooperativeExecutionKind = "code" | "local-ai" | "community-ai" | "paid-ai";

export type CooperativePersistenceScope =
  | "profile"
  | "workflow-state"
  | "artifact"
  | "history";

export type ServiceAgentKey =
  | "business-intake"
  | "business-context"
  | "research"
  | "image"
  | "social"
  | "project"
  | "node";

export type CapabilityKey =
  | "business.intake"
  | "business.context"
  | "research.web"
  | "image.generate"
  | "social.prepare"
  | "project.change"
  | "node.manage"
  | "chat.general";

export type ServiceAgentManifest = {
  key: ServiceAgentKey;
  purpose: string;
  capabilities: readonly CapabilityKey[];
  reads: readonly CooperativePersistenceScope[];
  writes: readonly CooperativePersistenceScope[];
  aiPolicy: {
    default: "none" | "local";
    allowLocal: boolean;
    allowCommunity: boolean;
    allowPaid: boolean;
  };
};

export type CapabilityManifest = {
  key: CapabilityKey;
  purpose: string;
  agent: ServiceAgentKey | null;
  preferredExecution: CooperativeExecutionKind;
  aiOnlyWhenNeeded: boolean;
};

export type DirectConversationResult = {
  handled: boolean;
  execution: "code";
  capability?: CapabilityKey;
  agent?: ServiceAgentKey;
  text?: string;
  routeReason?: string;
  savedFacts?: string[];
};
