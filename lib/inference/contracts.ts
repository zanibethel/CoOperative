import { z } from "zod";

export const imageReferenceSchema = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  title: z.string().max(160).optional(),
});

export const imageReferenceUrlSchema = z.object({
  url: z.string().url().refine((value) => value.startsWith("https://"), "Reference URL must use HTTPS."),
  title: z.string().max(160).optional(),
});

export const imageInferenceRequestSchema = z.object({
  prompt: z.string().min(1).max(6000),
  aspectRatio: z.enum(["1:1", "4:5", "3:2", "16:9", "9:16"]).default("4:5"),
  references: z.array(imageReferenceSchema).max(4).default([]),
  profile: z.enum(["fast", "quality"]).default("fast"),
  negativePrompt: z.string().max(3000).optional(),
  steps: z.number().int().min(1).max(80).optional(),
  guidanceScale: z.number().min(0).max(30).optional(),
  strength: z.number().min(0).max(1).optional(),
  variationMode: z.enum(["preserve", "balanced", "new-scene"]).default("balanced"),
  seed: z.number().int().min(0).max(2147483647).optional(),
});

export const imageInferenceApiRequestSchema = imageInferenceRequestSchema.extend({
  referenceUrls: z.array(imageReferenceUrlSchema).max(4).default([]),
});

export const imageInferenceResponseSchema = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  model: z.string(),
  profile: z.enum(["fast", "quality"]).optional(),
  provider: z.string(),
  referencesUsed: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().optional(),
  seed: z.number().int().min(0).max(2147483647).optional(),
  variationMode: z.enum(["preserve", "balanced", "new-scene"]).optional(),
});

export type ImageInferenceRequest = z.infer<typeof imageInferenceRequestSchema>;
export type ImageInferenceResponse = z.infer<typeof imageInferenceResponseSchema>;

export type InferenceWorker = {
  id: "local" | "cloud";
  url: string;
  token?: string;
};


export const textInferenceMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(16000),
});

export const textInferenceRequestSchema = z.object({
  messages: z.array(textInferenceMessageSchema).min(1).max(40),
  profile: z.enum(["fast", "quality"]).default("fast"),
  maxTokens: z.number().int().min(16).max(4096).default(768),
  temperature: z.number().min(0).max(2).default(0.2),
});

export const textRouteModeSchema = z.enum(["auto", "local-fast", "local-quality"]);
export const textTaskClassSchema = z.enum([
  "general",
  "summary",
  "planning",
  "coding",
  "debugging",
  "reasoning",
  "long-context",
]);

export const routedTextInferenceRequestSchema = z.object({
  messages: z.array(textInferenceMessageSchema).min(1).max(40),
  mode: textRouteModeSchema.default("auto"),
  taskClass: textTaskClassSchema.default("general"),
  maxTokens: z.number().int().min(16).max(4096).default(768),
  temperature: z.number().min(0).max(2).default(0.2),
  allowPaidFallback: z.boolean().default(false),
  humanApprovalRequired: z.boolean().default(false),
});

export const textInferenceResponseSchema = z.object({
  text: z.string(),
  model: z.string(),
  profile: z.enum(["fast", "quality"]),
  provider: z.string(),
  promptTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
});

export type TextInferenceMessage = z.infer<typeof textInferenceMessageSchema>;
export type TextInferenceRequest = z.infer<typeof textInferenceRequestSchema>;
export type RoutedTextInferenceRequest = z.infer<typeof routedTextInferenceRequestSchema>;
export type TextInferenceResponse = z.infer<typeof textInferenceResponseSchema>;
