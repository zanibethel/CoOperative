import { z } from "zod";

export const BusinessIntakeSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
  industry: z.string().trim().min(2).max(100),
  teamSize: z.coerce.number().int().min(1).max(100000),
  customerDescription: z.string().trim().min(10).max(1200),
  leadSources: z.string().trim().min(2).max(1200),
  dailyWork: z.string().trim().min(20).max(3000),
  repetitiveWork: z.string().trim().min(10).max(3000),
  tools: z.string().trim().min(2).max(1500),
  bottlenecks: z.string().trim().min(10).max(3000),
  humanApprovalAreas: z.string().trim().max(2000).default(""),
  websiteAndInquiryFlow: z.string().trim().max(2000).default(""),
  marketingAndSocial: z.string().trim().max(2000).default(""),
  bookingAndScheduling: z.string().trim().max(2000).default(""),
  costPriority: z.enum(["lowest-cost", "balanced", "best-fit"]).default("balanced"),
});

export const ProcessStepSchema = z.object({
  name: z.string(),
  actor: z.enum(["customer", "employee", "system", "manager"]),
  manual: z.boolean(),
});

export const BusinessProcessSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  steps: z.array(ProcessStepSchema).min(2),
});

export const AutomationOpportunitySchema = z.object({
  title: z.string(),
  currentProblem: z.string(),
  proposedAutomation: z.string(),
  humanRole: z.string(),
  estimatedHoursSavedPerMonth: z.number().nonnegative(),
  implementationEffort: z.enum(["low", "medium", "high"]),
  riskLevel: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  priorityScore: z.number().min(0).max(100),
});

export const AssessmentResultSchema = z.object({
  businessSummary: z.string(),
  processes: z.array(BusinessProcessSchema),
  opportunities: z.array(AutomationOpportunitySchema),
});

export const CapabilitySchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  provider: z.string().min(2),
  category: z.enum(["communication", "calendar", "crm", "payments", "accounting", "social", "website", "automation", "ai", "storage", "other"]),
  delivery: z.enum(["native", "plugin", "api", "webhook", "workflow-engine", "manual"]),
  authMode: z.enum(["oauth", "api-key", "service-account", "none", "unknown"]),
  estimatedCostModel: z.string(),
  actions: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  status: z.enum(["research", "approved", "deprecated"]),
});

export const PlaybookSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  problemPattern: z.string(),
  prerequisites: z.array(z.string()),
  requiredCapabilityKeys: z.array(z.string()),
  humanApprovalRequired: z.boolean(),
  version: z.number().int().positive(),
  status: z.enum(["draft", "validated", "published", "retired"]),
});

export const ImprovementProposalSchema = z.object({
  title: z.string(),
  problem: z.string(),
  evidenceSummary: z.string(),
  proposedChange: z.string(),
  affectedAreas: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresCodeChange: z.boolean(),
  status: z.enum(["proposed", "ai-reviewed", "owner-reviewed", "approved-for-build", "testing", "ready-for-merge", "merged", "rejected"]),
});

export type BusinessIntake = z.infer<typeof BusinessIntakeSchema>;
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type Playbook = z.infer<typeof PlaybookSchema>;
export type ImprovementProposal = z.infer<typeof ImprovementProposalSchema>;
