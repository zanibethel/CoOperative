import { z } from "zod";
import type { RiskLevel } from "../domain/operative-schemas.ts";

export const TaskSafetyFlagsSchema = z.object({
  requiresShell: z.boolean().default(false),
  changesProduction: z.boolean().default(false),
  touchesSecrets: z.boolean().default(false),
  changesDatabase: z.boolean().default(false),
  movesMoney: z.boolean().default(false),
  destructive: z.boolean().default(false),
});

export type TaskSafetyFlags = z.infer<typeof TaskSafetyFlagsSchema>;

export const OwnerTaskIntentSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).default(""),
  maxSpendUsd: z.number().finite().min(0).max(1000).default(0),
  flags: TaskSafetyFlagsSchema.optional(),
});

export type OwnerTaskIntent = z.infer<typeof OwnerTaskIntentSchema>;

export interface TaskPolicyResult {
  riskLevel: RiskLevel;
  requiresOwnerApproval: boolean;
  maxSpendMicrounits: number;
  reasons: string[];
}

/**
 * Conservative deterministic policy for owner-created Cloud Operative tasks.
 *
 * This is intentionally small and explainable. It does not infer intent with AI.
 * Later policy/playbook layers may add richer rules, but they must not silently
 * weaken these owner gates.
 */
export function evaluateOwnerTaskPolicy(intent: OwnerTaskIntent): TaskPolicyResult {
  const flags = TaskSafetyFlagsSchema.parse(intent.flags ?? {});
  const reasons: string[] = [];

  if (flags.changesDatabase) reasons.push("database change");
  if (flags.touchesSecrets) reasons.push("secret access/change");
  if (flags.movesMoney) reasons.push("money movement");
  if (flags.destructive) reasons.push("destructive operation");
  if (flags.changesProduction) reasons.push("production behavior change");
  if (flags.requiresShell) reasons.push("shell/runtime execution");

  const highRisk =
    flags.changesDatabase ||
    flags.touchesSecrets ||
    flags.movesMoney ||
    flags.destructive;

  const mediumRisk = flags.changesProduction || flags.requiresShell;

  const riskLevel: RiskLevel = highRisk ? "high" : mediumRisk ? "medium" : "low";

  const requiresOwnerApproval =
    flags.changesDatabase ||
    flags.touchesSecrets ||
    flags.movesMoney ||
    flags.destructive ||
    flags.changesProduction;

  return {
    riskLevel,
    requiresOwnerApproval,
    maxSpendMicrounits: Math.round(intent.maxSpendUsd * 1_000_000),
    reasons,
  };
}
