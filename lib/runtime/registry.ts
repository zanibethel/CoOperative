import type {
  CapabilityKey,
  CapabilityManifest,
  ServiceAgentKey,
  ServiceAgentManifest,
} from "@/lib/runtime/contracts";

export const SERVICE_AGENT_REGISTRY_REVISION = "2026-10-04.1";

export const SERVICE_AGENTS: Record<ServiceAgentKey, ServiceAgentManifest> = {
  "business-intake": {
    key: "business-intake",
    purpose:
      "Complete and maintain structured business intake using saved state first and deterministic parsing whenever possible.",
    capabilities: ["business.intake"],
    reads: ["profile", "workflow-state"],
    writes: ["profile", "workflow-state", "history"],
    aiPolicy: {
      default: "none",
      allowLocal: true,
      allowCommunity: true,
      allowPaid: false,
    },
  },
  "business-context": {
    key: "business-context",
    purpose:
      "Assemble scoped business context from structured saved data without inventing missing facts.",
    capabilities: ["business.context"],
    reads: ["profile", "workflow-state", "artifact"],
    writes: ["history"],
    aiPolicy: {
      default: "none",
      allowLocal: false,
      allowCommunity: false,
      allowPaid: false,
    },
  },
  research: {
    key: "research",
    purpose: "Perform bounded research when current external information is actually required.",
    capabilities: ["research.web"],
    reads: ["profile", "workflow-state"],
    writes: ["artifact", "history"],
    aiPolicy: {
      default: "local",
      allowLocal: true,
      allowCommunity: true,
      allowPaid: true,
    },
  },
  image: {
    key: "image",
    purpose: "Create or transform visual assets through the approved image execution path.",
    capabilities: ["image.generate"],
    reads: ["profile", "artifact", "workflow-state"],
    writes: ["artifact", "history"],
    aiPolicy: {
      default: "local",
      allowLocal: true,
      allowCommunity: true,
      allowPaid: true,
    },
  },
  social: {
    key: "social",
    purpose:
      "Prepare and execute approved social workflows without gaining unrelated business permissions.",
    capabilities: ["social.prepare"],
    reads: ["profile", "artifact", "workflow-state"],
    writes: ["artifact", "workflow-state", "history"],
    aiPolicy: {
      default: "none",
      allowLocal: true,
      allowCommunity: true,
      allowPaid: true,
    },
  },
  project: {
    key: "project",
    purpose:
      "Inspect and modify approved project scope through governed project tooling and verification.",
    capabilities: ["project.change"],
    reads: ["profile", "artifact", "workflow-state"],
    writes: ["artifact", "workflow-state", "history"],
    aiPolicy: {
      default: "local",
      allowLocal: true,
      allowCommunity: true,
      allowPaid: true,
    },
  },
  node: {
    key: "node",
    purpose:
      "Manage eligible CoOperative/Unison node state and routing without unrelated application authority.",
    capabilities: ["node.manage"],
    reads: ["profile", "workflow-state"],
    writes: ["workflow-state", "history"],
    aiPolicy: {
      default: "none",
      allowLocal: false,
      allowCommunity: false,
      allowPaid: false,
    },
  },
};

export const CAPABILITY_REGISTRY: Record<CapabilityKey, CapabilityManifest> = {
  "business.intake": {
    key: "business.intake",
    purpose: "Ask the next useful business question and persist supported answers.",
    agent: "business-intake",
    preferredExecution: "code",
    aiOnlyWhenNeeded: true,
  },
  "business.context": {
    key: "business.context",
    purpose: "Load relevant structured business context.",
    agent: "business-context",
    preferredExecution: "code",
    aiOnlyWhenNeeded: false,
  },
  "research.web": {
    key: "research.web",
    purpose: "Retrieve and synthesize current external information.",
    agent: "research",
    preferredExecution: "local-ai",
    aiOnlyWhenNeeded: true,
  },
  "image.generate": {
    key: "image.generate",
    purpose: "Generate or edit an image.",
    agent: "image",
    preferredExecution: "local-ai",
    aiOnlyWhenNeeded: true,
  },
  "social.prepare": {
    key: "social.prepare",
    purpose: "Prepare social content or a governed social action.",
    agent: "social",
    preferredExecution: "code",
    aiOnlyWhenNeeded: true,
  },
  "project.change": {
    key: "project.change",
    purpose: "Prepare a bounded project change.",
    agent: "project",
    preferredExecution: "local-ai",
    aiOnlyWhenNeeded: true,
  },
  "node.manage": {
    key: "node.manage",
    purpose: "Read or change allowed node state.",
    agent: "node",
    preferredExecution: "code",
    aiOnlyWhenNeeded: false,
  },
  "chat.general": {
    key: "chat.general",
    purpose:
      "Try deterministic conversation handlers first, then escalate only the unresolved open-ended work.",
    agent: null,
    preferredExecution: "code",
    aiOnlyWhenNeeded: true,
  },
};

export function capabilityFor(key: CapabilityKey) {
  return CAPABILITY_REGISTRY[key];
}

export function agentForCapability(key: CapabilityKey) {
  const capability = capabilityFor(key);
  return capability.agent ? SERVICE_AGENTS[capability.agent] : null;
}
