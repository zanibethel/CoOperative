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
  negativePrompt: z.string().max(3000).optional(),
  steps: z.number().int().min(1).max(80).optional(),
  guidanceScale: z.number().min(0).max(30).optional(),
  strength: z.number().min(0).max(1).optional(),
});

export const imageInferenceApiRequestSchema = imageInferenceRequestSchema.extend({
  referenceUrls: z.array(imageReferenceUrlSchema).max(4).default([]),
});

export const imageInferenceResponseSchema = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  model: z.string(),
  provider: z.string(),
  referencesUsed: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().optional(),
});

export type ImageInferenceRequest = z.infer<typeof imageInferenceRequestSchema>;
export type ImageInferenceResponse = z.infer<typeof imageInferenceResponseSchema>;

export type InferenceWorker = {
  id: "local" | "cloud";
  url: string;
  token?: string;
};
