import { z } from "zod";

/**
 * Cloud Operative domain contracts.
 *
 * These schemas back the primitives described in:
 * - docs/CLOUD-OPERATIVE.md (task state machine, Decision Brief, executor router)
 * - docs/OMNICHANNEL-CONVERSATIONS.md (canonical channel event format)
 * - docs/MEMORY-AND-PREFERENCES.md (memory classes, scope, provenance)
 *
 * Every channel (Owner Console primary, Telegram/ChatGPT secondary) normalizes
 * into these same shapes before touching CoOperative's canonical state, per the
 * "CoOperative is the system of record. Channels are interfaces." rule.
 */

// ---------------------------------------------------------------------------
// Channels + canonical conversation events
// ---------------------------------------------------------------------------

export const ChannelSchema = z.enum(["owner-console", "telegram", "chatgpt", "system"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const MessageTypeSchema = z.enum([
  "text",
  "decision_brief",
  "approval_response",
  "task_update",
  "system_note",
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// Matches the common event format in docs/OMNICHANNEL-CONVERSATIONS.md
// "Channel adapters" section exactly.
export const ChannelEventSchema = z.object({
  conversationId: z.string().uuid().nullable().default(null),
  actorId: z.string().min(1),
  channel: ChannelSchema,
  timestamp: z.string().datetime().optional(),
  messageType: MessageTypeSchema.default("text"),
  text: z.string().max(8000).default(""),
  attachments: z.array(z.string()).max(20).default([]),
  replyTo: z.string().uuid().nullable().default(null),
  linkedTaskId: z.string().uuid().nullable().default(null),
  /** Idempotency key so duplicate webhook delivery cannot create duplicate actions. */
  idempotencyKey: z.string().min(1).max(200).optional(),
});
export type ChannelEvent = z.infer<typeof ChannelEventSchema>;

// ---------------------------------------------------------------------------
// Operative task state machine
// ---------------------------------------------------------------------------

export const TaskStatusSchema = z.enum([
  "queued",
  "planning",
  "awaiting_approval",
  "executing",
  "verifying",
  "completed",
  "blocked",
  "failed",
  "rolled_back",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** Legal transitions per docs/CLOUD-OPERATIVE.md "Durable Task State". */
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["planning", "cancelled"],
  planning: ["awaiting_approval", "executing", "blocked", "cancelled"],
  awaiting_approval: ["executing", "cancelled", "blocked"],
  executing: ["verifying", "blocked", "failed", "awaiting_approval"],
  verifying: ["completed", "failed", "rolled_back"],
  completed: [],
  blocked: ["planning", "awaiting_approval", "cancelled"],
  failed: ["rolled_back", "queued"],
  rolled_back: [],
  cancelled: [],
};

export function isValidTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return TASK_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const SourceChannelSchema = z.enum([
  "owner-console",
  "telegram",
  "chatgpt",
  "admin",
  "scheduled",
  "github-issue",
]);
export type SourceChannel = z.infer<typeof SourceChannelSchema>;

export const OperativeTaskSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  conversationId: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  sourceChannel: SourceChannelSchema,
  title: z.string().min(2).max(200),
  description: z.string().max(4000).default(""),
  status: TaskStatusSchema,
  riskLevel: RiskLevelSchema.default("low"),
  requiresOwnerApproval: z.boolean().default(false),
  playbookKey: z.string().regex(/^[a-z0-9-]+$/).nullable().default(null),
  selectedExecutor: z
    .enum([
      "deterministic-code",
      "connected-chatgpt",
      "native-capability",
      "hermes-cloud-operative",
      "external-ai-provider",
    ])
    .nullable()
    .default(null),
  maxSpendCents: z.number().int().min(0).default(0),
  actualSpendCents: z.number().int().min(0).default(0),
  result: z.unknown().nullable().default(null),
  error: z.string().nullable().default(null),
});
export type OperativeTask = z.infer<typeof OperativeTaskSchema>;

export const TaskEventTypeSchema = z.enum([
  "created",
  "status_changed",
  "executor_selected",
  "playbook_selected",
  "sandbox_created",
  "sandbox_stopped",
  "ai_call",
  "cost_recorded",
  "artifact_saved",
  "approval_requested",
  "approval_resolved",
  "error",
  "note",
]);
export type TaskEventType = z.infer<typeof TaskEventTypeSchema>;

export const TaskEventSchema = z.object({
  taskId: z.string().uuid(),
  eventType: TaskEventTypeSchema,
  fromStatus: TaskStatusSchema.nullable().default(null),
  toStatus: TaskStatusSchema.nullable().default(null),
  actor: z.string().default("system"),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;

// ---------------------------------------------------------------------------
// Decision Brief contract (docs/CLOUD-OPERATIVE.md "Decision Brief")
// ---------------------------------------------------------------------------

export const DecisionStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "modified",
  "expired",
  "superseded",
]);
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>;

export const DecisionBriefSchema = z.object({
  taskId: z.string().uuid().nullable().default(null),
  conversationId: z.string().uuid().nullable().default(null),
  proposalSummary: z.string().min(1).max(1000),
  rationale: z.string().max(2000).default(""),
  expectedOutcomeIfApproved: z.string().max(1000).default(""),
  expectedOutcomeIfDeclined: z.string().max(1000).default(""),
  estimatedCostCents: z.number().int().min(0).default(0),
  estimatedSavingsCents: z.number().int().min(0).nullable().default(null),
  riskLevel: RiskLevelSchema.default("low"),
  requiredScopes: z.array(z.string()).default([]),
  rollbackPlan: z.string().max(1000).default(""),
  recommendedAction: z.string().max(500).default(""),
});
export type DecisionBrief = z.infer<typeof DecisionBriefSchema>;

export const DecisionResolutionSchema = z.object({
  decisionId: z.string().uuid(),
  action: z.enum(["approve", "reject", "modify", "ask_question"]),
  resolvedBy: z.string().uuid(),
  resolvedViaChannel: ChannelSchema,
  note: z.string().max(2000).optional(),
});
export type DecisionResolution = z.infer<typeof DecisionResolutionSchema>;

// ---------------------------------------------------------------------------
// Executor routing (docs/CORE-OPERATING-MODEL.md "Execution economics")
// ---------------------------------------------------------------------------

export const ExecutorKindSchema = z.enum([
  "deterministic-code",
  "connected-chatgpt",
  "native-capability",
  "hermes-cloud-operative",
  "external-ai-provider",
]);
export type ExecutorKind = z.infer<typeof ExecutorKindSchema>;

export const ExecutorCandidateSchema = z.object({
  kind: ExecutorKindSchema,
  /** Whether this executor is currently reachable/connected (e.g. ChatGPT session active). */
  available: z.boolean(),
  /** Whether it has the required tools/permissions for this specific task. */
  qualified: z.boolean(),
  /** Estimated incremental (marginal) cost in cents for this task. Flat-rate-covered work is 0. */
  estimatedMarginalCostCents: z.number().int().min(0),
  /** Needs cloud autonomy, shell access, persistence, or background execution. */
  requiresAutonomousExecution: z.boolean().default(false),
  estimatedLatencyMs: z.number().int().min(0).optional(),
  riskLevel: RiskLevelSchema.default("low"),
  notes: z.string().max(500).optional(),
});
export type ExecutorCandidate = z.infer<typeof ExecutorCandidateSchema>;

// ---------------------------------------------------------------------------
// Memory & Preference Engine (docs/MEMORY-AND-PREFERENCES.md)
// ---------------------------------------------------------------------------

export const MemoryScopeSchema = z.enum([
  "owner",
  "organization",
  "project",
  "workflow",
  "conversation",
]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryClassSchema = z.enum([
  "preference",
  "policy",
  "decision",
  "goal",
  "fact",
  "lesson",
  "open_question",
]);
export type MemoryClass = z.infer<typeof MemoryClassSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  scope: MemoryScopeSchema,
  memoryClass: MemoryClassSchema,
  content: z.string().min(1).max(2000),
  sourceConversationId: z.string().uuid().nullable().default(null),
  sourceMessageId: z.string().uuid().nullable().default(null),
  sourceTaskId: z.string().uuid().nullable().default(null),
  extractedBy: z.enum(["system", "owner-confirmed", "ai-advisor"]).default("system"),
  confidence: z.number().min(0).max(1).default(0.5),
  ownerConfirmed: z.boolean().default(false),
  status: z.enum(["active", "superseded", "retired"]).default("active"),
  supersedesMemoryId: z.string().uuid().nullable().default(null),
  pinned: z.boolean().default(false),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

// ---------------------------------------------------------------------------
// Channel identity mapping
// ---------------------------------------------------------------------------

export const ChannelIdentitySchema = z.object({
  organizationId: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  channel: z.enum(["telegram", "chatgpt"]),
  /** A NAME/reference only (e.g. Telegram chat id) — never a token/secret value. */
  externalIdentityRef: z.string().min(1).max(200),
  allowListed: z.boolean().default(false),
});
export type ChannelIdentity = z.infer<typeof ChannelIdentitySchema>;

// ---------------------------------------------------------------------------
// Cost ledger
// ---------------------------------------------------------------------------

export const CostCategorySchema = z.enum([
  "ai-tokens",
  "sandbox-compute",
  "storage",
  "network",
  "other",
]);
export type CostCategory = z.infer<typeof CostCategorySchema>;

export const CostLedgerEntrySchema = z.object({
  organizationId: z.string().uuid(),
  taskId: z.string().uuid().nullable().default(null),
  executor: z.enum([
    "deterministic-code",
    "connected-chatgpt",
    "native-capability",
    "hermes-cloud-operative",
    "external-ai-provider",
    "vercel-sandbox",
  ]),
  costCategory: CostCategorySchema,
  amountCents: z.number().int().min(0),
  currency: z.string().length(3).default("USD"),
  isMarginalCost: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});
export type CostLedgerEntry = z.infer<typeof CostLedgerEntrySchema>;
