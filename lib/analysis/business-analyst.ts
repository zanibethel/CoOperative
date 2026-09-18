import { deriveDemoAssessment } from "@/lib/analysis/derive-demo-assessment";
import type {
  AssessmentResult,
  BusinessIntake,
  Capability,
  Playbook,
} from "@/lib/domain/schemas";

export type BusinessAnalystContext = {
  intake: BusinessIntake;
  capabilities: Capability[];
  playbooks: Playbook[];
};

export interface BusinessAnalyst {
  version: string;
  analyze(context: BusinessAnalystContext): Promise<AssessmentResult>;
}

const deterministicBusinessAnalyst: BusinessAnalyst = {
  version: "deterministic-v0.2-registry-aware",

  async analyze({ intake }) {
    return deriveDemoAssessment(intake);
  },
};

export function getBusinessAnalyst(): BusinessAnalyst {
  // Deliberate seam: the route depends on this contract, not on a specific model.
  // The first LLM-backed implementation will consume the exact same context and
  // must still return an AssessmentResult that passes runtime validation.
  return deterministicBusinessAnalyst;
}
