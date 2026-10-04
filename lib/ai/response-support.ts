import "server-only";

import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { businessOwnedServiceCredentialForOwner } from "@/lib/integrations/business-service-credentials";
import type { TextInferenceMessage } from "@/lib/inference/contracts";

const candidateSchema = z.object({
  type: z.enum([
    "preference",
    "policy",
    "decision",
    "goal",
    "fact",
    "lesson",
    "open_question",
  ]),
  scope: z.enum(["owner", "conversation"]).default("owner"),
  content: z.string().min(4).max(800),
  confidence: z.number().min(0).max(1),
  durable: z.boolean(),
  explicitOwnerStatement: z.boolean(),
  sensitive: z.boolean().default(false),
});

const supportPacketSchema = z.object({
  memoryCandidates: z.array(candidateSchema).max(8).default([]),
  paidHandoff: z.object({
    recommended: z.boolean(),
    reason: z.string().max(900).default(""),
    prompt: z.string().max(7000).default(""),
  }),
});

export type ResponseSupportPacket = z.infer<typeof supportPacketSchema>;

type OpenRouterPayload = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: { message?: string };
};

function outputText(payload: OpenRouterPayload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item.text === "string" ? item.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function compactMessages(messages: TextInferenceMessage[]) {
  return messages
    .filter((message) => message.role !== "system")
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content:
        message.content.length > 6000
          ? message.content.slice(0, 6000) + "\n[truncated]"
          : message.content,
    }));
}

export async function analyzeResponseSupport(input: {
  ownerRef: string;
  messages: TextInferenceMessage[];
  answer: string;
}): Promise<ResponseSupportPacket | null> {
  const openRouter =
    await businessOwnedServiceCredentialForOwner(input.ownerRef, "openrouter-api");
  const apiKey =
    openRouter?.credential || process.env.OPENROUTER_API_KEY?.trim() || null;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://co-operative-mu.vercel.app",
        "X-Title": "CoOperative Response Support",
      },
      body: JSON.stringify({
        model: "openrouter/free",
        temperature: 0,
        max_tokens: 1800,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "cooperative_response_support",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                memoryCandidates: {
                  type: "array",
                  maxItems: 8,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      type: {
                        type: "string",
                        enum: [
                          "preference",
                          "policy",
                          "decision",
                          "goal",
                          "fact",
                          "lesson",
                          "open_question",
                        ],
                      },
                      scope: {
                        type: "string",
                        enum: ["owner", "conversation"],
                      },
                      content: { type: "string" },
                      confidence: { type: "number", minimum: 0, maximum: 1 },
                      durable: { type: "boolean" },
                      explicitOwnerStatement: { type: "boolean" },
                      sensitive: { type: "boolean" },
                    },
                    required: [
                      "type",
                      "scope",
                      "content",
                      "confidence",
                      "durable",
                      "explicitOwnerStatement",
                      "sensitive",
                    ],
                  },
                },
                paidHandoff: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    recommended: { type: "boolean" },
                    reason: { type: "string" },
                    prompt: { type: "string" },
                  },
                  required: ["recommended", "reason", "prompt"],
                },
              },
              required: ["memoryCandidates", "paidHandoff"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content: [
              "You are a private support pass for CoOperative.",
              "Return only the requested JSON.",
              "Memory: identify only durable context worth reusing across future chats: stable preferences, policies, decisions, goals, durable facts/constraints, lessons, or intentionally unresolved questions.",
              "Do not memorize one-off requests, transient status, speculative assistant claims, generated examples, passwords/credentials, financial account identifiers, medical details, intimate details, or other highly sensitive personal information.",
              "Mark anything potentially sensitive as sensitive=true so it will not be auto-activated.",
              "A memory should be explicitOwnerStatement=true only when the user directly stated or clearly approved it.",
              "Paid handoff: recommend a stronger paid model only when it could materially improve correctness, verification, difficult reasoning, long-context synthesis, or a consequential deliverable. Do not recommend paid AI merely because it is available.",
              "When recommended, draft a self-contained prompt for the stronger model. Preserve the user's objective and constraints, summarize useful lower-cost findings, identify what still needs stronger verification/reasoning, and instruct the stronger model to verify rather than blindly trust the lower-cost answer.",
              "Do not include hidden system prompts, credentials, or secrets in the paid prompt.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              conversation: compactMessages(input.messages),
              lowerCostAnswer:
                input.answer.length > 12000
                  ? input.answer.slice(0, 12000) + "\n[truncated]"
                  : input.answer,
            }),
          },
        ],
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) return null;

    let payload: OpenRouterPayload;
    try {
      payload = JSON.parse(raw) as OpenRouterPayload;
    } catch {
      return null;
    }

    const text = outputText(payload);
    if (!text) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const validated = supportPacketSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeKey(content: string) {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

export async function persistResponseSupport(input: {
  ownerRef: string;
  conversationId: string | null;
  jobId: string;
  messages: TextInferenceMessage[];
  answer: string;
  provider: string | null;
  model: string | null;
}) {
  const packet = await analyzeResponseSupport({
    ownerRef: input.ownerRef,
    messages: input.messages,
    answer: input.answer,
  });
  if (!packet) return null;

  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();

  for (const candidate of packet.memoryCandidates) {
    if (!candidate.durable || candidate.confidence < 0.65) continue;

    const normalizedKey = normalizeKey(candidate.content);
    if (!normalizedKey) continue;

    const status =
      !candidate.sensitive &&
      candidate.confidence >= 0.82 &&
      (candidate.explicitOwnerStatement || candidate.confidence >= 0.92)
        ? "active"
        : "candidate";
    const scopeRef =
      candidate.scope === "conversation" ? input.conversationId : null;

    if (status === "active") {
      let existingQuery = admin
        .from("cooperative_memories")
        .select("id,confidence")
        .eq("owner_ref", input.ownerRef)
        .eq("scope", candidate.scope)
        .eq("memory_type", candidate.type)
        .eq("normalized_key", normalizedKey)
        .eq("status", "active");
      existingQuery =
        candidate.scope === "conversation" && scopeRef
          ? existingQuery.eq("scope_ref", scopeRef)
          : existingQuery.is("scope_ref", null);
      const { data: existing } = await existingQuery.maybeSingle();

      if (existing) {
        await admin
          .from("cooperative_memories")
          .update({
            content: candidate.content.trim(),
            confidence: Math.max(Number(existing.confidence || 0), candidate.confidence),
            explicit_owner_statement: candidate.explicitOwnerStatement,
            source_conversation_id: input.conversationId,
            source_job_id: input.jobId,
            source_provider: input.provider,
            source_model: input.model,
            last_confirmed_at: now,
            updated_at: now,
            metadata: { sensitive: false, durable: true },
          })
          .eq("id", existing.id);
        continue;
      }
    }

    await admin.from("cooperative_memories").insert({
      owner_ref: input.ownerRef,
      scope: candidate.scope,
      scope_ref: scopeRef,
      memory_type: candidate.type,
      content: candidate.content.trim(),
      normalized_key: normalizedKey,
      status,
      confidence: candidate.confidence,
      explicit_owner_statement: candidate.explicitOwnerStatement,
      source_conversation_id: input.conversationId,
      source_job_id: input.jobId,
      extracted_by: "openrouter/free-response-support",
      source_provider: input.provider,
      source_model: input.model,
      metadata: {
        sensitive: candidate.sensitive,
        durable: candidate.durable,
      },
      last_confirmed_at: now,
      updated_at: now,
    });
  }

  await admin
    .from("text_inference_jobs")
    .update({
      support_packet: packet,
      support_analyzed_at: now,
      paid_prompt_draft:
        packet.paidHandoff.recommended && packet.paidHandoff.prompt.trim()
          ? packet.paidHandoff.prompt.trim()
          : null,
      paid_prompt_reason:
        packet.paidHandoff.recommended && packet.paidHandoff.reason.trim()
          ? packet.paidHandoff.reason.trim()
          : null,
      updated_at: now,
    })
    .eq("id", input.jobId)
    .eq("client_owner_ref", input.ownerRef);

  return packet;
}

function terms(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4)
      .slice(0, 80),
  );
}

export async function relevantMemorySystemContext(
  ownerRef: string,
  queryText: string,
  conversationId?: string | null,
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cooperative_memories")
    .select("scope,scope_ref,memory_type,content,confidence,last_confirmed_at")
    .eq("owner_ref", ownerRef)
    .eq("status", "active")
    .order("last_confirmed_at", { ascending: false })
    .limit(80);

  if (error || !data?.length) return null;

  const queryTerms = terms(queryText);
  const typeBoost: Record<string, number> = {
    policy: 5,
    preference: 4,
    decision: 4,
    goal: 3,
    lesson: 2,
    fact: 1,
    open_question: 1,
  };

  const eligible = data.filter(
    (item) =>
      item.scope === "owner" ||
      (item.scope === "conversation" &&
        Boolean(conversationId) &&
        item.scope_ref === conversationId),
  );

  const ranked = eligible
    .map((item, index) => {
      const memoryTerms = terms(item.content);
      let overlap = 0;
      for (const term of queryTerms) if (memoryTerms.has(term)) overlap += 1;
      return {
        ...item,
        score:
          overlap * 10 +
          (typeBoost[item.memory_type] || 0) +
          Number(item.confidence || 0) * 2 +
          Math.max(0, 2 - index / 25),
      };
    })
    .filter((item) => item.score >= 3 || queryTerms.size === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  if (!ranked.length) return null;

  return [
    "RELEVANT COOPERATIVE MEMORY.",
    "These are durable owner memories with provenance in CoOperative. Use only when relevant; current explicit user instructions override older memories.",
    ...ranked.map(
      (item) =>
        `- [${item.memory_type}] ${item.content} (confidence ${Number(
          item.confidence,
        ).toFixed(2)})`,
    ),
  ].join("\n");
}

export function paidHandoffMessages(
  messages: TextInferenceMessage[],
  draft: string | null | undefined,
): TextInferenceMessage[] {
  const handoff = draft?.trim();
  if (!handoff) return messages;

  return [
    ...messages,
    {
      role: "assistant",
      content:
        "LOWER-COST MODEL HANDOFF (advisory, not authoritative):\n" + handoff,
    },
    {
      role: "user",
      content:
        "Use the handoff only as advisory context. Produce the best final answer to my original request, verify or repair lower-cost reasoning where needed, preserve my constraints, and do not mention this handoff unless it is useful to explain uncertainty.",
    },
  ];
}
