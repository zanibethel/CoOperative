import { z } from "zod";

export const unisonNodeClassSchema = z.enum(["private", "business", "community"]);
export const unisonNodeStateSchema = z.enum(["online", "idle", "busy", "paused"]);

const gpuSchema = z.object({
  name: z.string().min(1).max(240),
  memoryTotalMb: z.number().int().nonnegative().nullable().optional(),
});

const textModelPlanSchema = z.object({
  revision: z.string().max(80).default(""),
  backend: z.string().max(80).default(""),
  models: z.object({
    fast: z.string().max(160).default(""),
    quality: z.string().max(160).default(""),
    heavy: z.string().max(160).default(""),
  }),
  selectionReason: z.string().max(1000).default(""),
});

const textBenchmarkSchema = z.object({
  profile: z.string().max(32).default(""),
  model: z.string().max(160).default(""),
  provider: z.string().max(120).default(""),
  outputTokens: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().default(0),
  tokensPerSecond: z.number().nonnegative().nullable().optional(),
  recordedAt: z.string().max(80).default(""),
});

export const unisonNodeHeartbeatSchema = z.object({
  nodeId: z.string().min(1).max(160).regex(/^[A-Za-z0-9._:-]+$/),
  displayName: z.string().min(1).max(160),
  ownerRef: z.string().min(1).max(160).default("platform-private"),
  nodeClass: unisonNodeClassSchema.default("private"),
  state: unisonNodeStateSchema.default("online"),
  platform: z.object({
    system: z.string().min(1).max(80),
    release: z.string().max(120).default(""),
    machine: z.string().max(120).default(""),
  }),
  capabilities: z.array(z.string().min(1).max(120)).max(64).default([]),
  resources: z.object({
    cpuLogical: z.number().int().positive().max(1024).nullable().optional(),
    memoryTotalMb: z.number().int().positive().nullable().optional(),
    gpus: z.array(gpuSchema).max(16).default([]),
    maxCpuPercent: z.number().min(1).max(100).default(50),
    maxGpuPercent: z.number().min(1).max(100).default(80),
    maxMemoryMb: z.number().int().positive().nullable().optional(),
    textModelPlan: textModelPlanSchema.optional(),
    textBenchmark: textBenchmarkSchema.optional(),
  }),
  policy: z.object({
    idleOnly: z.boolean().default(true),
    idleThresholdSeconds: z.number().int().min(0).max(86400).default(300),
    allowImage: z.boolean().default(false),
    allowText: z.boolean().default(false),
    idleScope: z.enum(["session", "machine"]).default("session"),
  }),
  workerVersion: z.string().min(1).max(80),
});

export type UnisonNodeHeartbeat = z.infer<typeof unisonNodeHeartbeatSchema>;
