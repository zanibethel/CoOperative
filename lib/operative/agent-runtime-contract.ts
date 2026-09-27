import type {
  ExecutorCapability,
  ExecutorRequirements,
} from "../domain/operative-schemas.ts";

export type AgentRuntimeStatus =
  | "research"
  | "approved"
  | "disabled"
  | "deprecated";

export interface AgentRuntimeProfile {
  key: string;
  name: string;
  status: AgentRuntimeStatus;
  capabilities: readonly ExecutorCapability[];
  supportsSteering: boolean;
  supportsCancellation: boolean;
  supportsUsageReporting: boolean;
  supportsArtifactRetrieval: boolean;
  notes?: string;
}

export interface AgentRuntimeSubmitRequest {
  taskId: string;
  objective: string;
  requirements: ExecutorRequirements;
  maxSpendMicrounits: number;
  inputArtifactRefs?: string[];
  instructions?: string[];
}

export interface AgentRuntimeUsage {
  amountMicrounits: number | null;
  currency: string;
  source:
    | "provider-reported"
    | "cooperative-estimated"
    | "unknown";
  detail?: Record<string, unknown>;
}

export interface AgentRuntimeArtifact {
  id: string;
  kind: string;
  name: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRuntimeExecution {
  externalRunId: string;
  status:
    | "queued"
    | "running"
    | "awaiting_input"
    | "completed"
    | "failed"
    | "cancelled";
  summary?: string;
  usage?: AgentRuntimeUsage;
  artifacts?: AgentRuntimeArtifact[];
  rawEvidenceRef?: string;
}

export interface AgentRuntimeAdapter {
  profile: AgentRuntimeProfile;

  submit(request: AgentRuntimeSubmitRequest): Promise<AgentRuntimeExecution>;
  getStatus(externalRunId: string): Promise<AgentRuntimeExecution>;

  steer?(
    externalRunId: string,
    instruction: string,
  ): Promise<AgentRuntimeExecution>;

  cancel?(externalRunId: string): Promise<AgentRuntimeExecution>;
}

/**
 * Provider adapters are infrastructure. They do not own:
 * - CoOperative task state;
 * - approval policy;
 * - cost policy;
 * - durable memory;
 * - outcome verification;
 * - business economics.
 *
 * Those remain canonical CoOperative responsibilities so a runtime can be
 * replaced without changing the business workflow.
 */
export function assertRuntimeCanAttempt(
  profile: AgentRuntimeProfile,
  requirements: ExecutorRequirements,
) {
  if (profile.status !== "approved") {
    throw new Error(
      `Agent runtime ${profile.key} is not approved for execution.`,
    );
  }

  const capabilities = new Set(profile.capabilities);
  const missing = requirements.requiredCapabilities.filter(
    (capability) => !capabilities.has(capability),
  );

  if (
    requirements.requiresAutonomousExecution &&
    !capabilities.has("autonomous-execution")
  ) {
    missing.push("autonomous-execution");
  }

  if (missing.length > 0) {
    throw new Error(
      `Agent runtime ${profile.key} is missing required capabilities: ${[
        ...new Set(missing),
      ].join(", ")}.`,
    );
  }
}
