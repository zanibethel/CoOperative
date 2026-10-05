import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import { mainCooperativeUserId } from "@/lib/ai/main-cooperative-access";
import { TEXT_MODEL_REGISTRY_REVISION } from "@/lib/inference/text-model-registry";
import { textInferenceMessageSchema } from "@/lib/inference/contracts";
import {
  COOPERATIVE_BUSINESS_CHAT_POLICY,
  COOPERATIVE_BUSINESS_POLICY_REVISION,
} from "@/lib/ai/business-chat-policy";
import { buildBusinessChatContext } from "@/lib/ai/business-context";
import { persistResponseSupport } from "@/lib/ai/response-support";
import {
  buildAndSaveRuntimeContext,
  refreshRuntimeContextAfterOutcome,
} from "@/lib/ai/runtime-context-markdown";
import {
  aiProfileBalanceForUser,
  cooperativeProfileRef,
  releaseAiProfileFunds,
  reserveAiProfileFunds,
  settleAiProfileFunds,
} from "@/lib/billing/ai-profile-balance";
import { paidAiPriceQuote } from "@/lib/billing/paid-ai-pricing";
import {
  fundingDirective,
  fundingQuoteForUser,
} from "@/lib/billing/ai-funding-handoff";
import { handleBusinessIntake } from "@/lib/runtime/business-intake";
import { handleCodeFirstChat } from "@/lib/runtime/code-first-chat";
import { platformFaqDataNeeds } from "@/lib/runtime/platform-faq";
import {
  answerOnboarding,
  businessScopePromptContext,
  codeFirstOwnedBusinessList,
  codeFirstProfileFieldSnapshot,
  codeFirstScopeClarification,
  onboardingState,
  resolveBusinessScope,
  resumeOnboarding,
} from "@/lib/ai/user-profile-onboarding";
import { resolveProfileExecutionPlan } from "@/lib/runtime/profile-execution-router";
import { activeNodeIds } from "@/lib/unison/node-access";
import {
  pollHermesMediaTask,
  startHermesMediaTask,
} from "@/lib/inference/hermes-media-cloud";
import {
  pollHermesVisionTask,
  startHermesVisionTask,
  type HermesVisionImage,
} from "@/lib/inference/hermes-vision-cloud";
import {
  pollHermesTextTask,
  startHermesTextTask,
  type HermesTextContextMessage,
} from "@/lib/inference/hermes-text-cloud";
import {
  adultMediaContentClass,
  mediaPromptWithResolvedControls,
  planMediaRequest,
} from "@/lib/inference/media-request";
import {
  evaluateMediaExecutionContentGate,
  mediaKnownBlockedRouteKeys,
  mediaPolicyRefusalDetected,
  mediaPolicyRefusalOrigin,
  recordMediaRuntimePolicyRefusal,
} from "@/lib/inference/media-model-capabilities";
import {
  mediaBenchmarkEvidenceForOwner,
  type MediaBenchmarkEvidence,
} from "@/lib/inference/media-model-benchmarks";
import {
  estimateOpenRouterMediaCostUsd,
  openRouterKeySpendStatus,
  openRouterMediaCatalog,
  recommendedForRequest,
  type MediaCatalogModel,
} from "@/lib/inference/openrouter-media-catalog";
import { executeOpenRouterImageDirect } from "@/lib/inference/openrouter-direct-image";
import { queueNextDirectOpenRouterImageFallback } from "@/lib/inference/openrouter-direct-image-routing";
import {
  affordableVideoSuggestion,
} from "@/lib/inference/nous-managed-media";
import {
  bestMediaRecommendationWithinCap,
  buildMediaRecommendationOptions,
  isApprovedPremiumReferenceSmokeRoute,
  requestedMediaRecommendationTier,
  type MediaAdultCapabilityEvidence,
  type MediaContentPreference,
} from "@/lib/inference/media-recommendations";
import { prepareMediaExecutionWithReasoning } from "@/lib/inference/media-preflight-reasoning";
import {
  businessOwnedServiceCredentialForOwner,
  connectedServiceStatusesForOwner,
} from "@/lib/integrations/business-service-credentials";
import { freshNousRuntimeAuthForOwner } from "@/lib/integrations/nous-portal";
import {
  createReferenceImageExecutionUrls,
  verifyNousReferenceImageTransport,
} from "@/lib/inference/nous-reference-transport-verification";
import {
  mediaReferenceModelVerificationsForOwner,
  recordMediaReferenceModelVerification,
} from "@/lib/inference/media-reference-model-verification";
import {
  looksLikeApiCredential,
  planServiceConnectIntent,
  serviceConnectAssistantMessage,
} from "@/lib/runtime/service-connect-intent";
import {
  connectorBuildAssistantMessage,
  queueConnectorBuild,
} from "@/lib/runtime/service-connector-build";
import { startRecoveryForJob } from "@/lib/recovery/server";
import { parseWebAccessModeCommand } from "@/lib/runtime/web-access-policy";
import { buildHostedWebResearch } from "@/lib/inference/public-web-research";

export const runtime = "nodejs";
export const maxDuration = 300;

const FREE_VISION_FALLBACK_GRACE_MS = 8_000;
const FREE_VISION_WORKER_ID = "cooperative-hermes-free-vision";
const FREE_TEXT_FALLBACK_GRACE_MS = 8_000;
const FREE_TEXT_WORKER_ID = "cooperative-hermes-free-text";

const modelMixerLevelSchema = z.number().int().min(0).max(4);
const modelMixerSchema = z.object({
  preset: z.enum(["economy", "balanced", "premium", "custom"]),
  maxSpendUsd: z.number().min(0).max(100),
  agents: z.object({
    research: modelMixerLevelSchema,
    planner: modelMixerLevelSchema,
    builder: modelMixerLevelSchema,
    verifier: modelMixerLevelSchema,
    media: modelMixerLevelSchema,
  }),
});

const chatRequestSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    businessId: z.string().uuid().optional(),
    message: z.string().max(16000).default(""),
    attachmentIds: z.array(z.string().uuid()).max(4).default([]),
    profile: z.enum(["fast", "quality"]).default("fast"),
    maxTokens: z.number().int().min(16).max(4096).default(768),
    temperature: z.number().min(0).max(2).default(0.2),
    nodeRouting: z.enum(["default", "prefer-owned", "require-node"]).default("default"),
    requiredNodeId: z.string().min(1).max(160).optional(),
    modelMixer: modelMixerSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.message.trim()) || value.attachmentIds.length > 0,
    "Message or image attachment is required.",
  );

async function currentOwner() {
  const userId = await mainCooperativeUserId();

  return userId
    ? { userId, ownerRef: `coop-user:${userId}` }
    : null;
}

function titleFromMessage(message: string, hasImages: boolean) {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return hasImages ? "Image question" : "New chat";
  return compact.length > 72 ? `${compact.slice(0, 69)}…` : compact;
}

function maxSpendPerPromptCommand(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  const settingIntent =
    /\b(?:set|change|make|update|raise|lower|reduce|increase)\b/.test(value) &&
    /\b(?:max(?:imum)? spend|spend (?:cap|limit)|prompt (?:budget|cap|limit)|per[- ]prompt (?:budget|cap|limit)|mixer cap)\b/.test(value);

  if (!settingIntent) return null;

  const cents = value.match(
    /(?:to|at|=|of)?\s*([0-9]+(?:\.[0-9]+)?)\s*cents?\b/,
  );
  if (cents) {
    const parsed = Number(cents[1]) / 100;
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
  }

  const dollars =
    value.match(/\$\s*([0-9]+(?:\.[0-9]{1,4})?)/) ||
    value.match(
      /(?:to|at|=|of)\s*([0-9]+(?:\.[0-9]{1,4})?)\s*(?:usd|dollars?)?\b/,
    );
  if (!dollars) return null;

  const parsed = Number(dollars[1]);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : null;
}

function asksMaxSpendPerPrompt(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(?:what(?:'s| is)|show|tell me)\b/.test(value) &&
    /\b(?:max(?:imum)? spend|spend (?:cap|limit)|prompt (?:budget|cap|limit)|per[- ]prompt|mixer cap)\b/.test(value)
  );
}

function explicitSandboxCodeChangeIntent(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  const action =
    /\b(?:fix|patch|change|update|implement|add|remove|refactor|modify|repair)\b/.test(
      value,
    );
  const platformTarget =
    /\b(?:cooperative|co-operative|code ?base|repo(?:sitory)?|platform|this app|the app|local ai|chat ui|dashboard|api route|source code)\b/.test(
      value,
    );
  const informational =
    /\b(?:explain|teach|example|sample|what is|how does)\b/.test(value) &&
    !/\b(?:fix|implement|patch|change|update)\b/.test(value);

  return action && platformTarget && !informational;
}

function sandboxContinuationIntent(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(?:that|this|the) (?:branch|fix|change) (?:didn'?t|did not|doesn'?t|does not) work\b/.test(
      value,
    ) ||
    /\b(?:still broken|still not working|update the branch|fix the branch|revise the branch|try the branch again)\b/.test(
      value,
    )
  );
}

function sandboxTaskIdFromAssistant(content: string) {
  return (
    content.match(
      /SANDBOX_CODE_TASK:([0-9a-f]{8}-[0-9a-f-]{27,})/i,
    )?.[1] || null
  );
}

function asksForSandboxBranchReport(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(?:sandbox|code) branches?\b/.test(value) &&
    /\b(?:review|report|pending|waiting|status|show|list)\b/.test(value)
  ) || (
    /\bwhat (?:code|changes?) (?:is|are) waiting for review\b/.test(value)
  ) || (
    /\bwhat branches? need review\b/.test(value)
  );
}

function asksAboutRecentFailure(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bwhat caused (the )?(failure|error)\b/.test(value) ||
    /\bwhy did (it|that|this).{0,40}(fail|error)\b/.test(value) ||
    /\bwhat (went wrong|happened)\b/.test(value) ||
    /\bwhy (did )?(it|that|this) fail\b/.test(value) ||
    /\bload failed\b/.test(value)
  );
}

function asksToRetryRecentMedia(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bretry (that|the|this|my|last)?\s*(image|video|media|generation)?\b/.test(value) ||
    /\btry (that|the|this|my|last)?\s*(image|video|media)?\s*again\b/.test(value) ||
    /\brun (that|the|this|my|last)?\s*(image|video|media)?\s*again\b/.test(value) ||
    /\bretry it\b/.test(value)
  );
}

function looksLikeMediaFollowup(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\bas long as possible\b/.test(value) ||
    /\bstay(?:ing)? within (?:the )?(?:budget|cap)\b/.test(value) ||
    /\breduce (?:the )?(?:quality|resolution|duration)\b/.test(value) ||
    /\b(?:use )?(?:my )?nous\b/.test(value) ||
    /\b(?:without|no) audio\b/.test(value) ||
    /\b(?:360p|480p|540p|720p|1080p|4k)\b/.test(value) ||
    /\b(?:vertical|landscape|square|9:16|16:9|1:1)\b/.test(value) ||
    /\b\d{1,2}\s*(?:-\s*)?(?:seconds?|secs?|s)\b/.test(value) ||
    /\b(?:compare|show|list|review)\b(?:\s+(?:the|my|those|these|media))?\s+(?:options|choices|recommendations|routes|models)\b/.test(value) ||
    /\bwhat (?:are|were) (?:the|my) (?:options|choices|recommendations|routes|models)\b/.test(value) ||
    /\b(?:high[- ]?end|premium|balanced|middle|medium|lowest[- ]?cost|cheapest|low[- ]?cost)\b.*\b(?:media )?(?:option|recommendation)\b/.test(value)
  );
}

function asksToReduceMediaToFit(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\breduce quality to fit\b/.test(value) ||
    /\breduce .{0,100}\b(?:fit|within (?:the )?(?:budget|cap))\b/.test(value)
  );
}

function asksForMediaRecommendationsOnly(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(?:show|compare|list|review)\b.{0,40}\b(?:media )?(?:options|choices|recommendations|routes|models)\b/.test(value) ||
    /\b(?:do not|don't|dont)\s+(?:generate|start|run)\b/.test(value) ||
    /\b(?:before|without)\s+(?:generating|starting|running)\b/.test(value)
  );
}

function explicitlyReusesRecentImage(message: string) {
  const value = message.toLowerCase().replace(/\s+/g, " ").trim();
  return (
    /\b(?:this|that|same|previous|last)\s+(?:image|photo|picture|reference)\b/.test(value) ||
    /\b(?:use|edit|change|modify|analyze|describe|reference)\s+(?:it|this|that|the same one)\b/.test(value) ||
    /\b(?:use|edit|change|modify|analyze|describe|reference)\s+(?:the )?(?:same|previous|last)\s+(?:image|photo|picture)\b/.test(value)
  );
}

function conciseFailureDetail(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function providerCreditBoundary(value: unknown) {
  if (typeof value !== "string") return false;
  const text = value.toLowerCase();
  return (
    text.includes("402") ||
    text.includes("insufficient credits") ||
    text.includes("purchase credits") ||
    text.includes("billing issue")
  );
}

function aspectRatioFromPrompt(value: string) {
  const match = value.match(/\b(1:1|4:5|3:2|16:9|9:16)\b/);
  return match?.[1] || "4:5";
}

function estimatedMediaProviderCostUsd(
  model: MediaCatalogModel,
  durationSeconds: number | null,
  resolution: string | null = null,
  audio: boolean | null = null,
) {
  return estimateOpenRouterMediaCostUsd(model, {
    durationSeconds,
    resolution,
    audio,
  });
}

function videoControlsFromPrompt(prompt: string) {
  const resolution =
    prompt.match(/Resolution:\s*(360p|480p|540p|720p|1080p|4k)/i)?.[1]?.toLowerCase() ||
    null;
  const audioMatch = prompt.match(/Generated audio:\s*(on|off)/i)?.[1]?.toLowerCase();
  return {
    resolution,
    audio: audioMatch === "on" ? true : audioMatch === "off" ? false : null,
  };
}

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

function attachmentExtension(mimeType: string) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

async function stageLocalImageReferences(
  admin: AdminClient,
  ownerRef: string,
  jobId: string,
  attachmentIds: string[],
) {
  if (!attachmentIds.length) return [];

  const { data: attachments, error: attachmentError } = await admin
    .from("local_ai_attachments")
    .select("id,storage_path,file_name,mime_type")
    .eq("owner_ref", ownerRef)
    .in("id", attachmentIds);

  if (attachmentError) throw attachmentError;
  if (!attachments || attachments.length !== attachmentIds.length) {
    throw new Error("One or more reference images are no longer available.");
  }

  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const referencePaths: Array<{
    path: string;
    title?: string;
    contentType: string;
  }> = [];

  try {
    for (let index = 0; index < attachmentIds.length; index += 1) {
      const attachment = byId.get(attachmentIds[index]);
      if (!attachment) throw new Error("Reference image metadata is missing.");

      const { data: blob, error: downloadError } = await admin.storage
        .from("local-ai-attachments")
        .download(attachment.storage_path);
      if (downloadError) throw downloadError;

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!bytes.length || bytes.byteLength > 12 * 1024 * 1024) {
        throw new Error("Reference image is empty or exceeds the local inference limit.");
      }

      const contentType = attachment.mime_type || "image/jpeg";
      const path =
        `jobs/${jobId}/references/${index}.${attachmentExtension(contentType)}`;
      const { error: uploadError } = await admin.storage
        .from("inference-job-assets")
        .upload(path, bytes, {
          contentType,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      referencePaths.push({
        path,
        title: attachment.file_name || undefined,
        contentType,
      });
    }

    return referencePaths;
  } catch (error) {
    if (referencePaths.length) {
      await admin.storage
        .from("inference-job-assets")
        .remove(referencePaths.map((reference) => reference.path));
    }
    throw error;
  }
}

async function hermesVisionImagesForAttachments(
  admin: AdminClient,
  ownerRef: string,
  attachmentIds: string[],
): Promise<HermesVisionImage[]> {
  if (!attachmentIds.length) return [];

  const { data: attachments, error } = await admin
    .from("local_ai_attachments")
    .select("id,storage_path,file_name,mime_type")
    .eq("owner_ref", ownerRef)
    .in("id", attachmentIds);

  if (error) throw error;
  if (!attachments || attachments.length !== attachmentIds.length) {
    throw new Error("One or more vision attachments are no longer available.");
  }

  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const images: HermesVisionImage[] = [];

  for (const attachmentId of attachmentIds) {
    const attachment = byId.get(attachmentId);
    if (!attachment) throw new Error("Vision attachment metadata is missing.");

    const { data: blob, error: downloadError } = await admin.storage
      .from("local-ai-attachments")
      .download(attachment.storage_path);
    if (downloadError) throw downloadError;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!bytes.length || bytes.byteLength > 12 * 1024 * 1024) {
      throw new Error("Vision attachment is empty or exceeds the 12 MB limit.");
    }

    images.push({
      bytes,
      fileName: attachment.file_name || `image-${attachmentId}`,
      mimeType: attachment.mime_type || "image/jpeg",
    });
  }

  return images;
}

function latestUserRequest(messages: unknown) {
  if (!Array.isArray(messages)) return "Describe and analyze the attached image.";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index];
    if (
      row &&
      typeof row === "object" &&
      (row as { role?: unknown }).role === "user" &&
      typeof (row as { content?: unknown }).content === "string"
    ) {
      const value = (row as { content: string }).content.trim();
      if (value) return value;
    }
  }
  return "Describe and analyze the attached image.";
}

function hermesTextContextMessages(
  messages: unknown,
): HermesTextContextMessage[] {
  if (!Array.isArray(messages)) {
    return [
      {
        role: "user",
        content: "Answer the user's request using the available context.",
      },
    ];
  }

  const parsed = messages.flatMap((row): HermesTextContextMessage[] => {
    if (!row || typeof row !== "object") return [];
    const role = (row as { role?: unknown }).role;
    const content = (row as { content?: unknown }).content;
    if (
      (role !== "system" && role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      return [];
    }
    return [{ role, content: content.trim() }];
  });

  return parsed.length
    ? parsed
    : [
        {
          role: "user",
          content: "Answer the user's request using the available context.",
        },
      ];
}

function freeCloudWebMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cooperativeWeb = (value as { cooperativeWeb?: unknown }).cooperativeWeb;
  if (
    !cooperativeWeb ||
    typeof cooperativeWeb !== "object" ||
    Array.isArray(cooperativeWeb)
  ) {
    return null;
  }

  const row = cooperativeWeb as {
    mode?: unknown;
    used?: unknown;
    provider?: unknown;
    sourceCount?: unknown;
    searchUsed?: unknown;
    directPageReads?: unknown;
    reason?: unknown;
  };
  const mode =
    row.mode === "auto" || row.mode === "always" ? row.mode : "off";

  return {
    mode,
    used: row.used === true,
    provider: typeof row.provider === "string" ? row.provider : null,
    sourceCount:
      typeof row.sourceCount === "number" && Number.isFinite(row.sourceCount)
        ? Math.max(0, Math.round(row.sourceCount))
        : 0,
    searchUsed: row.searchUsed === true,
    directPageReads:
      typeof row.directPageReads === "number" &&
      Number.isFinite(row.directPageReads)
        ? Math.max(0, Math.round(row.directPageReads))
        : 0,
    reason: typeof row.reason === "string" ? row.reason : "",
  };
}


export async function POST(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = chatRequestSchema.parse(await request.json());
    if (looksLikeApiCredential(input.message)) {
      return NextResponse.json(
        {
          error:
            "Don't paste API keys into normal chat. Ask me to connect the provider and I'll show a secure credential field.",
          code: "SECURE_CREDENTIAL_REQUIRED",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const admin = createAdminSupabaseClient();
    const ownerRef = owner.ownerRef;
    const resolvedBusiness = await resolveBusinessScope({
      ownerRef,
      requestedBusinessId: input.businessId || null,
      message: input.message,
    });
    const effectiveBusinessId = resolvedBusiness.businessId;
    const businessContext = effectiveBusinessId
      ? await buildBusinessChatContext(owner.userId, effectiveBusinessId)
      : null;
    const scopeContext = await businessScopePromptContext(
      ownerRef,
      effectiveBusinessId,
    );
    const profileBalance =
      businessContext?.aiBalance ?? (await aiProfileBalanceForUser(owner.userId));

    let conversationId = input.conversationId;
    let conversationTitle = "";

    if (conversationId) {
      const { data: existing, error: conversationError } = await admin
        .from("local_ai_conversations")
        .select("id,title")
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef)
        .maybeSingle();

      if (conversationError) throw conversationError;
      if (!existing) {
        return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      }
      conversationTitle = existing.title;
    } else {
      conversationId = crypto.randomUUID();
      conversationTitle = titleFromMessage(input.message, input.attachmentIds.length > 0);

      const { error: createError } = await admin.from("local_ai_conversations").insert({
        id: conversationId,
        owner_ref: ownerRef,
        title: conversationTitle,
        profile: input.profile,
      });

      if (createError) throw createError;
    }

    let currentAttachmentIds = input.attachmentIds;

    if (input.attachmentIds.length > 0) {
      const { data: attachments, error: attachmentError } = await admin
        .from("local_ai_attachments")
        .select("id,conversation_id")
        .eq("owner_ref", ownerRef)
        .in("id", input.attachmentIds);

      if (attachmentError) throw attachmentError;
      if (!attachments || attachments.length !== input.attachmentIds.length) {
        return NextResponse.json(
          { error: "One or more image attachments were not found." },
          { status: 400 },
        );
      }

      const belongsElsewhere = attachments.some(
        (attachment) =>
          attachment.conversation_id && attachment.conversation_id !== conversationId,
      );
      if (belongsElsewhere) {
        return NextResponse.json(
          { error: "An image attachment belongs to another conversation." },
          { status: 409 },
        );
      }

      const { error: attachError } = await admin
        .from("local_ai_attachments")
        .update({ conversation_id: conversationId })
        .in("id", input.attachmentIds)
        .eq("owner_ref", ownerRef);

      if (attachError) throw attachError;
    }


    if (
      input.attachmentIds.length === 0 &&
      /\b(?:continue|resume|restart|return to|start)\b.{0,24}\b(?:intake|onboarding|get[- ]to[- ]know[- ]you|profile setup)\b/i.test(
        input.message,
      )
    ) {
      const intakeMode =
        /\bbusiness\b/i.test(input.message)
          ? "business"
          : /\bpersonal\b/i.test(input.message)
            ? "personal"
            : null;
      const resumed = await resumeOnboarding(ownerRef, intakeMode);
      if (resumed.conversationId) {
        const { data: lastAssistant } = await admin
          .from("local_ai_messages")
          .select("content")
          .eq("conversation_id", resumed.conversationId)
          .eq("owner_ref", ownerRef)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: "text",
            conversationId: resumed.conversationId,
            conversationTitle: "Getting to know you",
            text:
              lastAssistant?.content ||
              "Intake is ready to continue in the setup conversation.",
            provider: "code",
            model: "adaptive-intake-router",
            routeReason:
              "CoOperative resumed the saved personal/business intake state without invoking an AI model.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const serverOnboardingState = await onboardingState(ownerRef);
    if (
      input.attachmentIds.length === 0 &&
      serverOnboardingState.status === "in_progress" &&
      serverOnboardingState.conversationId === conversationId &&
      serverOnboardingState.phase !== "paused"
    ) {
      const intake = await answerOnboarding({
        ownerRef,
        conversationId,
        message: input.message,
      });

      if (intake.handled !== false) {
        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: "text",
            conversationId,
            conversationTitle: "Getting to know you",
            text: intake.assistantText || "Saved.",
            provider: "code",
            model: "adaptive-intake-router",
            businessId: intake.state.businessId || null,
            routeReason:
              "Server-side code handled the active intake answer before any AI model was called.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const webAccessCommand = parseWebAccessModeCommand(input.message);
    if (input.attachmentIds.length === 0 && webAccessCommand) {
      let mode: "off" | "auto" | "always";

      if (webAccessCommand.action === "set") {
        mode = webAccessCommand.mode;
        const { error: webSettingError } = await admin
          .from("personal_ai_settings")
          .upsert(
            {
              user_id: owner.userId,
              web_access_mode: mode,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (webSettingError) throw webSettingError;
      } else {
        const { data: setting, error: webSettingError } = await admin
          .from("personal_ai_settings")
          .select("web_access_mode")
          .eq("user_id", owner.userId)
          .maybeSingle();
        if (webSettingError) throw webSettingError;
        mode =
          setting?.web_access_mode === "auto" ||
          setting?.web_access_mode === "always"
            ? setting.web_access_mode
            : "off";
      }

      const label =
        mode === "off" ? "Off" : mode === "auto" ? "Auto" : "Always";
      const explanation =
        mode === "off"
          ? "External web access is disabled."
          : mode === "auto"
            ? "CoOperative may use public web access only when deterministic routing identifies a need for current external information."
            : "CoOperative may use eligible public web access on chat turns, subject to URL/domain safety policy.";

      const assistantText =
        webAccessCommand.action === "set"
          ? `Web access is now ${label}. ${explanation}`
          : `Your current Web access mode is ${label}. ${explanation}`;

      await admin.from("local_ai_messages").insert([
        {
          conversation_id: conversationId,
          owner_ref: ownerRef,
          role: "user",
          content: input.message.trim(),
          attachment_ids: [],
          job_id: null,
        },
        {
          conversation_id: conversationId,
          owner_ref: ownerRef,
          role: "assistant",
          content: assistantText,
          attachment_ids: [],
          job_id: null,
        },
      ]);

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "research.web",
          conversationId,
          conversationTitle,
          text: assistantText,
          provider: "code",
          model: "profile-web-access-policy",
          webAccessMode: mode,
          routeReason:
            webAccessCommand.action === "set"
              ? "CoOperative updated the profile web-access mode deterministically before any model route."
              : "CoOperative read the profile web-access mode deterministically before any model route.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const requestedMaxSpendPerPrompt = maxSpendPerPromptCommand(input.message);
    const asksCurrentMaxSpendPerPrompt = asksMaxSpendPerPrompt(input.message);

    if (
      input.attachmentIds.length === 0 &&
      (requestedMaxSpendPerPrompt !== null || asksCurrentMaxSpendPerPrompt)
    ) {
      let maxSpendPerPromptUsd = requestedMaxSpendPerPrompt;

      if (requestedMaxSpendPerPrompt !== null) {
        const rounded = Number(requestedMaxSpendPerPrompt.toFixed(4));
        const { error: settingsError } = await admin
          .from("personal_ai_settings")
          .upsert(
            {
              user_id: owner.userId,
              max_spend_per_prompt_usd: rounded,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        if (settingsError) throw settingsError;
        maxSpendPerPromptUsd = rounded;
      } else {
        const { data: settingsRow, error: settingsReadError } = await admin
          .from("personal_ai_settings")
          .select("max_spend_per_prompt_usd")
          .eq("user_id", owner.userId)
          .maybeSingle();
        if (settingsReadError) throw settingsReadError;
        maxSpendPerPromptUsd = Number(
          settingsRow?.max_spend_per_prompt_usd ?? input.modelMixer?.maxSpendUsd ?? 0.05,
        );
      }

      const assistantText =
        requestedMaxSpendPerPrompt !== null
          ? `Max spend per prompt is now ${Number(maxSpendPerPromptUsd).toFixed(2)}. I’ll treat that as the hard ceiling for each chat prompt unless you change it in conversation or with the Model Mixer slider.`
          : `Your current max spend per prompt is ${Number(maxSpendPerPromptUsd).toFixed(2)}. You can change it here in chat or with the Model Mixer slider.`;

      const { error: settingMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (settingMessageError) throw settingMessageError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          conversationId,
          conversationTitle,
          text: assistantText,
          provider: "code",
          model: "model-mixer-spend-setting",
          modelMixerUpdate: {
            maxSpendUsd: Number(maxSpendPerPromptUsd),
          },
          routeReason:
            requestedMaxSpendPerPrompt !== null
              ? "CoOperative updated the persistent per-prompt spend ceiling deterministically without calling an AI model."
              : "CoOperative read the persistent per-prompt spend ceiling deterministically without calling an AI model.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: recentAssistantRows, error: recentAssistantError } = await admin
      .from("local_ai_messages")
      .select("content")
      .eq("conversation_id", conversationId)
      .eq("owner_ref", ownerRef)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(8);
    if (recentAssistantError) throw recentAssistantError;

    const serviceConnectIntent = planServiceConnectIntent(
      input.message,
      (recentAssistantRows || []).map((row) => row.content || ""),
    );

    if (serviceConnectIntent && input.attachmentIds.length === 0) {
      const userText = input.message.trim();

      let assistantText: string;
      let connectorBuildTaskId: string | null = null;
      let connectorBuildStatus: string | null = null;
      let aiNeeded = false;
      let routeReason: string;

      if (serviceConnectIntent.type === "available") {
        assistantText = serviceConnectAssistantMessage(serviceConnectIntent);
        routeReason =
          "CoOperative matched an implemented provider connector and opened its secure code-based authorization flow without invoking AI.";
      } else {
        const build = await queueConnectorBuild({
          userId: owner.userId,
          ownerRef,
          conversationId,
          intent: serviceConnectIntent,
        });
        connectorBuildTaskId = build.taskId;
        connectorBuildStatus = build.status;
        aiNeeded = true;
        assistantText = connectorBuildAssistantMessage({
          intent: serviceConnectIntent,
          taskId: build.taskId,
          reused: build.reused,
        });
        routeReason =
          "No approved reusable connector exists for this provider. Code recorded the request and delegated only the missing connector implementation to the bounded Repo Engineer workflow; credentials and account authorization remain outside AI.";
      }

      const { error: connectIntentError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: userText,
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (connectIntentError) throw connectIntentError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          conversationId,
          conversationTitle,
          text: assistantText,
          provider: "code",
          model:
            serviceConnectIntent.type === "available"
              ? "service-connector-registry"
              : "connector-build-router",
          routeReason,
          aiNeeded,
          aiPurpose: aiNeeded ? "connector-build" : null,
          connectorBuildTaskId,
          connectorBuildStatus,
          connector: {
            providerKey: serviceConnectIntent.providerKey,
            providerName: serviceConnectIntent.providerName,
            kind: serviceConnectIntent.kind,
            status:
              serviceConnectIntent.type === "available"
                ? "available"
                : "build-required",
          },
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const recentSandboxTaskId = (recentAssistantRows || [])
      .map((row) => sandboxTaskIdFromAssistant(row.content || ""))
      .find((value): value is string => Boolean(value)) || null;
    const continueSandbox =
      input.attachmentIds.length === 0 &&
      sandboxContinuationIntent(input.message) &&
      recentSandboxTaskId;

    if (
      input.attachmentIds.length === 0 &&
      (explicitSandboxCodeChangeIntent(input.message) || continueSandbox)
    ) {
      let sandboxBaseBranch: string | null = null;
      let continuationOfTaskId: string | null = null;

      if (continueSandbox && recentSandboxTaskId) {
        const { data: priorTask, error: priorTaskError } = await admin
          .from("agent_tasks")
          .select("id,repo_key,branch_name")
          .eq("id", recentSandboxTaskId)
          .eq("owner_ref", ownerRef)
          .maybeSingle();
        if (priorTaskError) throw priorTaskError;
        if (
          priorTask?.repo_key === "cooperative" &&
          typeof priorTask.branch_name === "string" &&
          priorTask.branch_name.startsWith("sandbox/")
        ) {
          sandboxBaseBranch = priorTask.branch_name;
          continuationOfTaskId = priorTask.id;
        }
      }

      const taskId = crypto.randomUUID();
      const objective = [
        "Prepare the smallest safe, reusable CoOperative code change for this owner-chat request.",
        "This request comes from the authenticated platform owner and is authoritative product direction.",
        "Owner direction may intentionally change the default product experience and does not require an opt-in UI toggle.",
        "Use a sandbox branch for implementation/testing safety; never merge or deploy to the default branch from the worker.",
        "Prefer a solution that generalizes to other users when the underlying issue is shared.",
        sandboxBaseBranch
          ? `Continue the existing sandbox branch ${sandboxBaseBranch} and preserve prior tested work unless evidence requires changing it.`
          : "Review successful unmerged sandbox candidates before inventing a duplicate implementation.",
        "",
        "OWNER CHAT REQUEST:",
        input.message.trim(),
      ].join("\n");

      const { error: sandboxTaskError } = await admin
        .from("agent_tasks")
        .insert({
          id: taskId,
          owner_ref: ownerRef,
          agent_key: "repo-engineer",
          repo_key: "cooperative",
          mode: "prepare_change",
          objective,
          requested_profile: "quality",
          status: "queued",
          result: {
            kind: "owner_chat_sandbox_change",
            governance: {
              authority: "platform-owner",
              ownerAuthoritative: true,
              uiToggleRequired: false,
              ownerReviewRequired: false,
            },
            sandbox: {
              baseBranch: sandboxBaseBranch,
              continuationOfTaskId,
              requestedFrom: "owner-chat",
              promotionState: "queued",
              mergeAllowed: false,
              ownerReviewRequired: false,
              reviewCadenceDays: 7,
            },
          },
        });
      if (sandboxTaskError) throw sandboxTaskError;

      await admin.from("agent_task_events").insert({
        task_id: taskId,
        owner_ref: ownerRef,
        kind: "queued",
        message: sandboxBaseBranch
          ? "Owner chat queued a revision on an existing sandbox branch."
          : "Owner chat queued a new sandbox code change.",
        metadata: {
          source: "owner-chat",
          profile: "quality",
          sandboxBaseBranch,
          continuationOfTaskId,
          mergeAllowed: false,
          governanceAuthority: "platform-owner",
          uiToggleRequired: false,
        },
      });

      const assistantText = [
        sandboxBaseBranch
          ? `I queued a Quality Repo Engineer revision on the existing sandbox branch ${sandboxBaseBranch}.`
          : "I queued this as a Quality Repo Engineer sandbox change.",
        "It will make the smallest reusable change it can, run deterministic checks, and push only the implementation branch for testing. Because this is owner direction, it may change the default product behavior without adding a user toggle. Main stays untouched until the verified change is explicitly merged.",
        "If the Quality coding path cannot produce a verified safe change, I’ll record a stronger-model recommendation rather than silently spending on a paid model.",
        "",
        `SANDBOX_CODE_TASK:${taskId}`,
      ].join("\n");

      const { error: sandboxMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (sandboxMessageError) throw sandboxMessageError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "project.change",
          conversationId,
          conversationTitle,
          text: assistantText,
          provider: "code",
          model: "sandbox-code-task-router",
          routeReason:
            "CoOperative mapped an explicit platform code-change request to the governed sandbox branch workflow without using general chat AI.",
          aiNeeded: true,
          aiPurpose: "bounded-code-generation",
          sandboxTaskId: taskId,
          sandboxBaseBranch,
          mergeAllowed: false,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      input.attachmentIds.length === 0 &&
      asksForSandboxBranchReport(input.message)
    ) {
      const { data: branchRows, error: branchError } = await admin
        .from("agent_tasks")
        .select("id,branch_name,status,objective,result,updated_at")
        .eq("repo_key", "cooperative")
        .eq("mode", "prepare_change")
        .not("branch_name", "is", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (branchError) throw branchError;

      const branches = (branchRows || [])
        .filter(
          (row) =>
            typeof row.branch_name === "string" &&
            row.branch_name.startsWith("sandbox/"),
        )
        .map((row) => {
          const result =
            row.result && typeof row.result === "object"
              ? (row.result as Record<string, unknown>)
              : {};
          const sandbox =
            result.sandbox && typeof result.sandbox === "object"
              ? (result.sandbox as Record<string, unknown>)
              : {};
          const governance =
            result.governance && typeof result.governance === "object"
              ? (result.governance as Record<string, unknown>)
              : {};
          return {
            taskId: row.id,
            branchName: row.branch_name as string,
            status: row.status,
            summary:
              typeof result.summary === "string"
                ? result.summary.slice(0, 500)
                : typeof row.objective === "string"
                  ? row.objective.slice(0, 500)
                  : "Prepared code change",
            checksPassed: result.checksPassed === true,
            pushed: sandbox.pushed === true,
            promotionState:
              typeof sandbox.promotionState === "string"
                ? sandbox.promotionState
                : "testing",
            ownerAuthoritative: governance.ownerAuthoritative === true,
            scope:
              typeof sandbox.scope === "string" ? sandbox.scope : "code-fix",
            changedFiles: Array.isArray(result.changedFiles)
              ? result.changedFiles.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
          };
        });

      const pending = branches.filter(
        (branch) =>
          !branch.ownerAuthoritative &&
          branch.promotionState !== "approved-for-merge" &&
          branch.promotionState !== "rejected",
      );
      const ownerAuthoritative = branches.filter(
        (branch) =>
          branch.ownerAuthoritative &&
          branch.promotionState !== "rejected",
      );
      const successful = pending.filter(
        (branch) => branch.checksPassed && branch.pushed,
      );
      const lines = pending.slice(0, 10).map((branch, index) => {
        const state = branch.checksPassed
          ? branch.pushed
            ? "tests/checks passed; pushed for testing"
            : "checks passed; push unavailable"
          : "still testing or checks incomplete";
        const files = branch.changedFiles.length
          ? ` Files: ${branch.changedFiles.slice(0, 4).join(", ")}${branch.changedFiles.length > 4 ? "…" : ""}`
          : "";
        return `${index + 1}. ${branch.branchName} [${branch.scope}] — ${state}. ${branch.summary}${files}`;
      });

      const assistantText = [
        `Sandbox branch review: ${pending.length} non-owner branch${pending.length === 1 ? "" : "es"} currently need owner review; ${successful.length} have passed recorded checks and were pushed for testing. ${ownerAuthoritative.length} owner-authoritative branch${ownerAuthoritative.length === 1 ? "" : "es"} are tracked separately for verification.`,
        "",
        ...(lines.length
          ? lines
          : ["There are no sandbox branches currently waiting for owner review."]),
        "",
        "Passing checks does not permit an automatic merge. A branch must be explicitly reviewed and marked approved-for-merge first; the actual merge remains a separate owner action.",
      ].join("\n");

      const { error: branchMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (branchMessageError) throw branchMessageError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "project.change",
          conversationId,
          conversationTitle,
          text: assistantText,
          provider: "code",
          model: "owner-sandbox-branch-report",
          routeReason:
            "CoOperative read persisted sandbox branch/test state directly and produced the owner review report without invoking AI.",
          branchReview: {
            pending: pending.length,
            ownerAuthoritativeTesting: ownerAuthoritative.length,
            successfulTested: successful.length,
            branches: pending.slice(0, 25),
            ownerAuthoritativeBranches: ownerAuthoritative.slice(0, 25),
          },
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      input.attachmentIds.length === 0 &&
      asksAboutRecentFailure(input.message)
    ) {
      const [{ data: recentMedia }, { data: recentRecovery }] = await Promise.all([
        admin
          .from("media_generation_jobs")
          .select(
            "id,status,kind,provider,model,error,started_at,deadline_at,completed_at,created_at",
          )
          .eq("owner_ref", ownerRef)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        admin
          .from("recovery_incidents")
          .select(
            "id,status,error_class,error_excerpt,current_message,resolution_summary,created_at,resolved_at",
          )
          .eq("owner_ref", ownerRef)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (recentMedia || recentRecovery) {
        const now = Date.now();
        const deadline = recentMedia?.deadline_at
          ? Date.parse(recentMedia.deadline_at)
          : Number.NaN;
        const pastDeadline =
          recentMedia?.status === "running" &&
          Number.isFinite(deadline) &&
          now > deadline;
        const rawFailure =
          conciseFailureDetail(recentMedia?.error) ||
          conciseFailureDetail(recentRecovery?.resolution_summary) ||
          conciseFailureDetail(recentRecovery?.error_excerpt);

        let assistantText: string;
        if (recentMedia?.status === "running" && !pastDeadline) {
          assistantText =
            `The media generator has not reported a confirmed failure. ${recentMedia.model || "The selected media model"} successfully started through ${recentMedia.provider || "the configured provider"}, and the job is still marked running. The “Load failed” message came from the browser/status request losing its connection while it was checking the job. I’m treating that as a transport/status-poll interruption rather than a generation failure.`;
        } else if (pastDeadline) {
          assistantText =
            `The first problem was the status connection, not a confirmed image-model failure. ${recentMedia?.model || "The selected media model"} successfully started, but the browser stopped receiving status updates and the job was left marked running past its execution deadline. That means this attempt now needs reconciliation before CoOperative can say whether the provider produced a usable result. This is a job-tracking/recovery problem, not evidence by itself that the image model failed.`;
        } else if (recentMedia?.status === "failed") {
          assistantText =
            rawFailure
              ? `The latest media route did fail. The recorded cause was: ${rawFailure}`
              : "The latest media route is recorded as failed, but it did not preserve a useful failure detail.";
        } else if (recentRecovery?.status === "completed" && recentRecovery.resolution_summary) {
          assistantText = `Recovery Agent found the cause: ${recentRecovery.resolution_summary}`;
        } else {
          assistantText =
            rawFailure
              ? `The latest recorded failure detail is: ${rawFailure}`
              : "CoOperative has a recent recovery incident, but there is not enough recorded detail yet to state the cause confidently.";
        }

        const { error: failureMessageError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (failureMessageError) throw failureMessageError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: "text",
            conversationId,
            conversationTitle,
            text: assistantText,
            provider: "code",
            model: "operational-failure-state",
            routeReason:
              "CoOperative answered from persisted job/recovery state instead of waiting for an AI model.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const scopeClarification = await codeFirstScopeClarification({
      ownerRef,
      activeBusinessId: effectiveBusinessId,
      conversationId,
      message: input.message,
    });

    if (scopeClarification && input.attachmentIds.length === 0) {
      const { error: scopeMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: scopeClarification.text,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (scopeMessageError) throw scopeMessageError;

      await admin
        .from("local_ai_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          conversationId,
          conversationTitle,
          text: scopeClarification.text,
          provider: "code",
          model: "scope-clarification-router",
          routeReason:
            "CoOperative asked the personal-versus-business clarification deterministically before calling local, free, paid, or media AI.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    let retryMediaContext:
      | { content: string; attachmentIds: string[] }
      | null = null;

    if (
      input.attachmentIds.length === 0 &&
      asksToRetryRecentMedia(input.message)
    ) {
      const { data: recentMedia, error: recentMediaError } = await admin
        .from("media_generation_jobs")
        .select(
          "id,status,conversation_id,kind,prompt,provider,model,model_mixer,request_max_spend_microusd,media_level,estimated_provider_cost_microusd,pricing_source,result_url,error,started_at,deadline_at,completed_at,created_at",
        )
        .eq("owner_ref", ownerRef)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentMediaError) throw recentMediaError;

      const { data: recentRequestedMediaRows, error: recentRequestedMediaError } =
        await admin
          .from("local_ai_messages")
          .select("content,attachment_ids,job_id,created_at")
          .eq("conversation_id", conversationId)
          .eq("owner_ref", ownerRef)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(16);
      if (recentRequestedMediaError) throw recentRequestedMediaError;

      const pendingRequest = (recentRequestedMediaRows || []).find((row) => {
        if (row.job_id || typeof row.content !== "string") return false;
        return Boolean(planMediaRequest(row.content));
      });
      const pendingCreatedAt = pendingRequest
        ? Date.parse(pendingRequest.created_at || "")
        : Number.NaN;
      const recentJobCreatedAt = recentMedia
        ? Date.parse(recentMedia.created_at || "")
        : Number.NEGATIVE_INFINITY;

      if (
        pendingRequest &&
        Number.isFinite(pendingCreatedAt) &&
        pendingCreatedAt > recentJobCreatedAt
      ) {
        retryMediaContext = {
          content:
            pendingRequest.content.trim() +
            "\nFollow-up preference: " +
            input.message.trim(),
          attachmentIds: Array.isArray(pendingRequest.attachment_ids)
            ? pendingRequest.attachment_ids.slice(0, 4)
            : [],
        };
      }

      if (recentMedia && !retryMediaContext) {
        const now = Date.now();
        const deadline = recentMedia.deadline_at
          ? Date.parse(recentMedia.deadline_at)
          : Number.NaN;
        const stillActive =
          recentMedia.status === "running" &&
          Number.isFinite(deadline) &&
          now <= deadline;

        if (stillActive) {
          const assistantText =
            "That media job is still within its execution window, so I’m not starting a duplicate. I’ll keep reconnecting to the existing job instead.";

          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);

          return NextResponse.json(
            {
              jobId: recentMedia.id,
              status: "running",
              execution: "media",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: recentMedia.provider,
              model: recentMedia.model,
              routeReason:
                "CoOperative prevented a duplicate media generation while the previous job is still active.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (recentMedia.status === "completed" && recentMedia.result_url) {
          const assistantText =
            "The last media job already completed, so I didn’t start another copy. Its result should be available in this conversation.";
          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              mediaUrl: recentMedia.result_url,
              provider: recentMedia.provider,
              model: recentMedia.model,
              routeReason:
                "CoOperative prevented a duplicate retry because the previous media job already completed.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (
          recentMedia.kind === "image" &&
          providerCreditBoundary(recentMedia.error)
        ) {
          const localFallbackModel = "local-image-quality";
          const localFallbackGate = await evaluateMediaExecutionContentGate({
            userId: owner.userId,
            ownerRef,
            provider: "cooperative-local",
            model: localFallbackModel,
            adultContentClass: adultMediaContentClass(recentMedia.prompt),
          });
          if (!localFallbackGate.allowed) {
            const assistantText =
              localFallbackGate.note +
              " CoOperative re-checked the current content preference and route capability before the automatic local reroute, so no replacement generation started.";

            await admin.from("local_ai_messages").insert([
              {
                conversation_id: conversationId,
                owner_ref: ownerRef,
                role: "user",
                content: input.message.trim(),
                attachment_ids: [],
                job_id: null,
              },
              {
                conversation_id: conversationId,
                owner_ref: ownerRef,
                role: "assistant",
                content: assistantText,
                attachment_ids: [],
                job_id: null,
              },
            ]);

            return NextResponse.json(
              {
                status: "completed",
                execution: "code",
                capability: "image",
                conversationId,
                conversationTitle,
                text: assistantText,
                provider: "code",
                model: "media-execution-content-gate",
                routeReason:
                  `Execution-time content gate blocked the automatic local reroute (${localFallbackGate.reason}).`,
              },
              { status: 200, headers: { "Cache-Control": "no-store" } },
            );
          }

          const localJobId = crypto.randomUUID();
          const { error: localJobError } = await admin
            .from("inference_jobs")
            .insert({
              id: localJobId,
              kind: "image",
              status: "queued",
              client_owner_ref: ownerRef,
              prompt: recentMedia.prompt,
              aspect_ratio: aspectRatioFromPrompt(recentMedia.prompt),
              profile: "quality",
              variation_mode: "balanced",
              seed:
                Number.parseInt(localJobId.replaceAll("-", "").slice(0, 8), 16) %
                2147483648,
            });
          if (localJobError) throw localJobError;

          const { error: localRetryMessageError } = await admin
            .from("local_ai_messages")
            .insert({
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: localJobId,
            });
          if (localRetryMessageError) throw localRetryMessageError;

          await admin
            .from("local_ai_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("owner_ref", ownerRef);

          return NextResponse.json(
            {
              jobId: localJobId,
              status: "queued",
              execution: "media",
              capability: "image",
              conversationId,
              conversationTitle,
              provider: "cooperative-local",
              model: "local-image-quality",
              routeReason:
                "OpenRouter refused the cloud generation because the provider account has no credits. CoOperative preserved the spending boundary and rerouted the image to owned local quality generation at no provider charge.",
              estimatedProviderCostUsd: 0,
            },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        }

        const estimatedMicrousd = Number(
          recentMedia.estimated_provider_cost_microusd || 0,
        );
        if (estimatedMicrousd > 0) {
          const estimatedUsd = estimatedMicrousd / 1_000_000;
          const assistantText =
            `The last media attempt is no longer active, but retrying it could create another paid generation charge of about ${estimatedUsd.toFixed(2)}. I won’t duplicate that spend automatically. Choose a lower-cost route, keep Nous first, or raise the cap explicitly before retrying.\n\nBUDGET_FOLLOWUPS`;

          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: "code",
              model: "media-retry-spend-gate",
              routeReason:
                "CoOperative blocked an automatic media retry because it could create a second paid generation charge.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        const stale =
          recentMedia.status === "running" &&
          (!Number.isFinite(deadline) || now > deadline);
        if (stale) {
          const staleAt = new Date().toISOString();
          await admin
            .from("media_generation_jobs")
            .update({
              status: "failed",
              error:
                "Previous media job passed its execution deadline without a reconciled result after status polling disconnected.",
              completed_at: staleAt,
              updated_at: staleAt,
            })
            .eq("id", recentMedia.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running");
        }

        const [openRouterService, nousRuntimeAuth] = await Promise.all([
          recentMedia.provider === "openrouter"
            ? businessOwnedServiceCredentialForOwner(
                ownerRef,
                "openrouter-api",
              )
            : Promise.resolve(null),
          freshNousRuntimeAuthForOwner(ownerRef).catch(() => null),
        ]);
        const providerCredential =
          openRouterService?.credential ||
          process.env.OPENROUTER_API_KEY?.trim() ||
          undefined;

        if (recentMedia.provider === "openrouter" && !providerCredential) {
          throw new Error(
            "OpenRouter credential is unavailable for the media retry.",
          );
        }

        const retryContentGate = await evaluateMediaExecutionContentGate({
          userId: owner.userId,
          ownerRef,
          provider: recentMedia.provider,
          model: recentMedia.model,
          adultContentClass: adultMediaContentClass(recentMedia.prompt),
        });
        if (!retryContentGate.allowed) {
          const assistantText =
            retryContentGate.note +
            " CoOperative re-checked the current content preference and route capability immediately before retry submission, so the retry was not started.";

          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: input.message.trim(),
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            },
          ]);

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: "code",
              model: "media-execution-content-gate",
              routeReason:
                `Execution-time content gate blocked the media retry (${retryContentGate.reason}).`,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        const retryJobId = crypto.randomUUID();
        const { error: retryInsertError } = await admin
          .from("media_generation_jobs")
          .insert({
            id: retryJobId,
            status: "queued",
            request_root_job_id: retryJobId,
            route_attempt: 1,
            execution_mode: "recovery-retry",
            owner_ref: ownerRef,
            conversation_id: conversationId,
            kind: recentMedia.kind,
            prompt: recentMedia.prompt,
            provider: recentMedia.provider,
            model: recentMedia.model,
            model_mixer: recentMedia.model_mixer || null,
            request_max_spend_microusd:
              recentMedia.request_max_spend_microusd ?? null,
            media_level: recentMedia.media_level ?? 0,
            estimated_provider_cost_microusd: 0,
            pricing_source: recentMedia.pricing_source || "recovery-retry",
          });
        if (retryInsertError) throw retryInsertError;

        const { error: retryUserMessageError } = await admin
          .from("local_ai_messages")
          .insert({
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          });
        if (retryUserMessageError) throw retryUserMessageError;

        try {
          const started = await startHermesMediaTask({
            jobId: retryJobId,
            kind: recentMedia.kind,
            userRequest: recentMedia.prompt,
            provider: recentMedia.provider,
            model: recentMedia.model,
            providerCredential,
            nousAuthJson: nousRuntimeAuth?.sandboxAuthJson,
          });

          const { error: retryStartError } = await admin
            .from("media_generation_jobs")
            .update({
              status: "running",
              sandbox_name: started.sandboxName,
              started_at: started.startedAt,
              deadline_at: started.deadlineAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", retryJobId)
            .eq("owner_ref", ownerRef);
          if (retryStartError) throw retryStartError;

          await admin
            .from("local_ai_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("owner_ref", ownerRef);

          return NextResponse.json(
            {
              jobId: retryJobId,
              status: "running",
              execution: "media",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              provider: recentMedia.provider,
              model: recentMedia.model,
              routeReason:
                "CoOperative closed the stale zero-cost media attempt and restarted the same generation once through the repaired Hermes route.",
            },
            { status: 202, headers: { "Cache-Control": "no-store" } },
          );
        } catch (retryFailure) {
          const detail =
            retryFailure instanceof Error
              ? retryFailure.message
              : "Hermes media retry could not start.";
          const failedAt = new Date().toISOString();
          await admin
            .from("media_generation_jobs")
            .update({
              status: "failed",
              error: detail.slice(0, 1200),
              completed_at: failedAt,
              updated_at: failedAt,
            })
            .eq("id", retryJobId)
            .eq("owner_ref", ownerRef);

          const recovery = await startRecoveryForJob(ownerRef, retryJobId);
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: recentMedia.kind,
              conversationId,
              conversationTitle,
              text:
                recovery.current_message ||
                "The retry still could not start, so Recovery Agent is repairing the route in the background.",
              provider: "recovery",
              model: "local-first-recovery",
              routeReason:
                "The stale media attempt was closed, but the replacement cloud route also failed to start and was handed to Recovery Agent.",
              recoveryIncidentId: recovery.id,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }
      }
    }

    let effectiveMediaRequestText =
      retryMediaContext?.content || input.message.trim();
    let effectiveMediaAttachmentIds = retryMediaContext
      ? [...retryMediaContext.attachmentIds]
      : [...input.attachmentIds];

    if (
      !retryMediaContext &&
      effectiveMediaAttachmentIds.length === 0 &&
      explicitlyReusesRecentImage(input.message)
    ) {
      const { data: recentImageRows, error: recentImageError } = await admin
        .from("local_ai_messages")
        .select("attachment_ids")
        .eq("conversation_id", conversationId)
        .eq("owner_ref", ownerRef)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(20);
      if (recentImageError) throw recentImageError;

      const referencedImageMessage = (recentImageRows || []).find(
        (row) =>
          Array.isArray(row.attachment_ids) && row.attachment_ids.length > 0,
      );
      if (referencedImageMessage) {
        effectiveMediaAttachmentIds =
          referencedImageMessage.attachment_ids.slice(0, 4);
      }
    }

    let mediaPlan = planMediaRequest(effectiveMediaRequestText);

    if (
      !mediaPlan &&
      input.attachmentIds.length === 0 &&
      looksLikeMediaFollowup(input.message)
    ) {
      const { data: recentConversationRows, error: recentConversationError } =
        await admin
          .from("local_ai_messages")
          .select("role,content,attachment_ids")
          .eq("conversation_id", conversationId)
          .eq("owner_ref", ownerRef)
          .order("created_at", { ascending: false })
          .limit(12);
      if (recentConversationError) throw recentConversationError;

      for (const row of recentConversationRows || []) {
        if (row.role !== "user" || typeof row.content !== "string") continue;
        const priorMediaPlan = planMediaRequest(row.content);
        if (!priorMediaPlan) continue;

        effectiveMediaRequestText =
          row.content.trim() +
          "\nFollow-up preference: " +
          input.message.trim();
        effectiveMediaAttachmentIds = Array.isArray(row.attachment_ids)
          ? row.attachment_ids.slice(0, 4)
          : [];
        mediaPlan = planMediaRequest(effectiveMediaRequestText);
        if (mediaPlan) break;
      }
    }

    if (mediaPlan) {
      const visibleUserText = input.message.trim();

      if (mediaPlan.clarification) {
        const { error: clarificationError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: input.attachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: mediaPlan.clarification,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (clarificationError) throw clarificationError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: mediaPlan.clarification,
            provider: "code",
            model: "media-preflight",
            routeReason:
              "CoOperative requested missing media controls before any generation spend.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (
        mediaPlan.kind === "video" &&
        effectiveMediaAttachmentIds.length > 0
      ) {
        const message =
          "I understand this as a new video request using a reference image. Reference-image video generation is not connected to a verified route yet, so I did not blend it with an earlier request or start a generation.";
        const { error: unsupportedError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: effectiveMediaAttachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (unsupportedError) throw unsupportedError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-reference-video-preflight",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      let mediaLevel = Math.min(
        4,
        Math.max(0, input.modelMixer?.agents.media ?? 0),
      ) as 0 | 1 | 2 | 3 | 4;
      const requestCapUsd = input.modelMixer?.maxSpendUsd ?? 0.05;

      if (
        mediaPlan.kind === "video" &&
        asksToReduceMediaToFit(input.message)
      ) {
        const fitSuggestion = await affordableVideoSuggestion(
          mediaPlan.durationSeconds,
          requestCapUsd,
          mediaPlan.resolution,
          mediaPlan.audio,
        );
        const fit = fitSuggestion?.bestWithinBudget || null;
        if (fit) {
          mediaPlan = {
            ...mediaPlan,
            durationSeconds: fit.durationSeconds,
            resolution: fit.resolution as typeof mediaPlan.resolution,
            audio: fit.audio,
          };
        }
      }

      let nousAuthFailure: string | null = null;
      const nousRuntimeAuth = await freshNousRuntimeAuthForOwner(ownerRef).catch(
        (error) => {
          nousAuthFailure =
            error instanceof Error
              ? error.message.slice(0, 500)
              : "Nous Portal authorization is temporarily unavailable.";
          console.warn("Nous media authorization unavailable", {
            ownerRef,
            detail: nousAuthFailure,
          });
          return null;
        },
      );

      let liveCatalog:
        | Awaited<ReturnType<typeof openRouterMediaCatalog>>
        | null = null;
      try {
        liveCatalog = await openRouterMediaCatalog(true);
      } catch {
        liveCatalog = null;
      }

      const requiresReferenceImage =
        mediaPlan.kind === "image" && effectiveMediaAttachmentIds.length > 0;
      const referenceVerification = requiresReferenceImage
        ? await verifyNousReferenceImageTransport({
            ownerRef,
            attachmentIds: effectiveMediaAttachmentIds,
            runtimeAuth: nousRuntimeAuth,
          }).catch((error) => {
            console.warn("Nous reference transport verification failed", {
              ownerRef,
              detail:
                error instanceof Error
                  ? error.message.slice(0, 500)
                  : "unknown verification failure",
            });
            return null;
          })
        : null;
      const referenceModelVerifications = requiresReferenceImage
        ? await mediaReferenceModelVerificationsForOwner(ownerRef)
        : [];
      let localImageAvailable = false;
      if (mediaPlan.kind === "image") {
        const authorizedNodeIds = await activeNodeIds(admin, owner.userId);
        if (authorizedNodeIds.length > 0) {
          const { data: imageNodes, error: imageNodesError } = await admin
            .from("unison_nodes")
            .select("id,state,capabilities,policy,last_seen_at")
            .in("id", authorizedNodeIds);
          if (imageNodesError) throw imageNodesError;

          localImageAvailable = (imageNodes || []).some((node) => {
            const capabilities = Array.isArray(node.capabilities)
              ? node.capabilities
              : [];
            const policy =
              node.policy && typeof node.policy === "object"
                ? (node.policy as { allowImage?: unknown })
                : {};
            const supportsRequestedImageMode = requiresReferenceImage
              ? capabilities.includes("image_to_image") ||
                capabilities.includes("single_reference_identity")
              : capabilities.includes("image_generation");
            return (
              supportsRequestedImageMode &&
              policy.allowImage !== false &&
              node.state !== "paused"
            );
          });
        }
      }

      const [
        { data: mediaPreferenceRow, error: mediaPreferenceError },
        { data: mediaCapabilityRows, error: mediaCapabilityError },
        { data: adultCapabilityTests, error: adultCapabilityTestsError },
      ] = await Promise.all([
        admin
          .from("personal_ai_settings")
          .select("media_content_preference,adult_content_acknowledged_at")
          .eq("user_id", owner.userId)
          .maybeSingle(),
        admin
          .from("media_model_capabilities")
          .select(
            "provider,model,endpoint,adult_content_policy,adult_content_policy_source,adult_non_explicit_policy,adult_non_explicit_policy_source,adult_explicit_policy,adult_explicit_policy_source",
          ),
        admin
          .from("media_model_capability_tests")
          .select(
            "provider,model,endpoint,outcome,prompt_classification,tested_at",
          )
          .eq("owner_ref", ownerRef)
          .eq("test_type", "adult_content")
          .order("tested_at", { ascending: false })
          .limit(250),
      ]);

      if (mediaPreferenceError) {
        console.warn("Media content preference unavailable; using SFW output default.", {
          ownerRef,
          detail: mediaPreferenceError.message,
        });
      }
      if (mediaCapabilityError) {
        console.warn("Media capability metadata unavailable.", {
          ownerRef,
          detail: mediaCapabilityError.message,
        });
      }
      if (adultCapabilityTestsError) {
        console.warn("Media adult-capability tests unavailable.", {
          ownerRef,
          detail: adultCapabilityTestsError.message,
        });
      }

      let benchmarkEvidence: MediaBenchmarkEvidence[] = [];
      try {
        benchmarkEvidence = await mediaBenchmarkEvidenceForOwner(ownerRef);
      } catch (benchmarkError) {
        console.warn("Media benchmark evidence unavailable; using catalog heuristics.", {
          ownerRef,
          detail:
            benchmarkError instanceof Error
              ? benchmarkError.message
              : "Unknown benchmark evidence error.",
        });
      }

      const storedContentPreference =
        mediaPreferenceRow?.media_content_preference as
          | MediaContentPreference
          | null
          | undefined;
      const contentPreference: MediaContentPreference =
        storedContentPreference &&
        storedContentPreference !== "sfw_only" &&
        mediaPreferenceRow?.adult_content_acknowledged_at
          ? storedContentPreference
          : "sfw_only";

      const adultEvidenceByKey = new Map<string, MediaAdultCapabilityEvidence>();
      for (const row of mediaCapabilityRows || []) {
        const key = [row.provider, row.model, row.endpoint || ""].join("|");
        adultEvidenceByKey.set(key, {
          provider: row.provider,
          model: row.model,
          endpoint: row.endpoint || null,
          policy:
            row.adult_content_policy === "allowed" ||
            row.adult_content_policy === "disallowed"
              ? row.adult_content_policy
              : "unknown",
          policySource: row.adult_content_policy_source || null,
          nonExplicitPolicy:
            row.adult_non_explicit_policy === "allowed" ||
            row.adult_non_explicit_policy === "disallowed"
              ? row.adult_non_explicit_policy
              : "unknown",
          nonExplicitPolicySource:
            row.adult_non_explicit_policy_source || null,
          explicitPolicy:
            row.adult_explicit_policy === "allowed" ||
            row.adult_explicit_policy === "disallowed"
              ? row.adult_explicit_policy
              : "unknown",
          explicitPolicySource: row.adult_explicit_policy_source || null,
          latestTestOutcome: null,
          latestPromptClassification: null,
          latestTestedAt: null,
        });
      }
      for (const test of adultCapabilityTests || []) {
        const key = [test.provider, test.model, test.endpoint || ""].join("|");
        const existing = adultEvidenceByKey.get(key);
        if (existing?.latestTestOutcome) continue;
        adultEvidenceByKey.set(key, {
          provider: test.provider,
          model: test.model,
          endpoint: test.endpoint || null,
          policy: existing?.policy || "unknown",
          policySource: existing?.policySource || null,
          nonExplicitPolicy: existing?.nonExplicitPolicy || "unknown",
          nonExplicitPolicySource: existing?.nonExplicitPolicySource || null,
          explicitPolicy: existing?.explicitPolicy || "unknown",
          explicitPolicySource: existing?.explicitPolicySource || null,
          latestTestOutcome:
            test.outcome === "supported" ||
            test.outcome === "blocked" ||
            test.outcome === "partial" ||
            test.outcome === "inconclusive"
              ? test.outcome
              : null,
          latestPromptClassification:
            typeof test.prompt_classification === "string"
              ? test.prompt_classification
              : null,
          latestTestedAt: test.tested_at || null,
        });
      }

      const adultContentClass = adultMediaContentClass(effectiveMediaRequestText);
      const adultOutputRequested = adultContentClass !== "sfw";
      const recommendationSet = await buildMediaRecommendationOptions({
        plan: mediaPlan,
        openRouterCatalog: liveCatalog,
        currentCapUsd: requestCapUsd,
        localImageAvailable,
        requiresReferenceImage,
        referenceVerification,
        referenceModelVerifications,
        contentPreference,
        adultCapabilityEvidence: [...adultEvidenceByKey.values()],
        benchmarkEvidence,
        adultOutputRequested,
        adultContentClass,
        cooperativeManagedOpenRouter: Boolean(
          process.env.OPENROUTER_API_KEY?.trim(),
        ),
      });
      const recommendationTier = requestedMediaRecommendationTier(input.message);
      const recommendationsOnly = asksForMediaRecommendationsOnly(input.message);
      let selectedRecommendation = recommendationTier
        ? recommendationSet.options.find(
            (option) => option.tier === recommendationTier,
          ) || null
        : recommendationsOnly
          ? null
          : bestMediaRecommendationWithinCap(
              recommendationSet.options,
              requestCapUsd,
            );

      const recommendationMarker =
        recommendationSet.options.length > 0
          ? `MEDIA_RECOMMENDATIONS:${encodeURIComponent(
              JSON.stringify({
                currentCapUsd: requestCapUsd,
                options: recommendationSet.options.map(
                  ({ providerCostEstimateUsd, markupPercent, ...option }) => {
                    void providerCostEstimateUsd;
                    void markupPercent;
                    return option;
                  },
                ),
              }),
            )}`
          : "";

      const recommendationText = () => {
        if (!recommendationSet.options.length) {
          if (recommendationSet.sfwConflict) {
            return (
              "This request asks for adult media output, but NSFW output is currently off in Model Mixer. I kept the SFW output constraint and did not start a generation. Enable NSFW if you want adult-output recommendations for this request."
            );
          }
          if (recommendationSet.explicitVerificationBlocked) {
            return (
              "This request asks for sexually explicit media output, but none of the current exact-match routes has evidence that actually verifies that scope. A non-explicit adult/nudity capability test does not count as explicit-output verification, so I did not start a generation."
            );
          }
          if (recommendationSet.requirementBlocked) {
            return (
              "Require adult-capable models is enabled, but none of the current exact-match routes has verified capability for the requested adult-output scope. I did not relax that requirement or start a generation."
            );
          }
          return (
            "I understand the media request, but I could not verify enough live exact-match pricing to offer the three choices safely. I did not start a generation."
          );
        }

        const hasDiscoveryOnlyOption = recommendationSet.options.some(
          (option) => option.executionReady === false,
        );
        return (
          "I understand the request. I found three live-priced exact-match options without changing the requested duration, resolution, format, or audio. Expand High, Medium, or Low to compare the details. No generation has started." +
          (hasDiscoveryOnlyOption
            ? " Premium Hermes/Nous reference options marked as verification-only are visible for comparison but cannot be executed yet."
            : "") +
          (recommendationMarker ? `\n\n${recommendationMarker}` : "")
        );
      };

      if (!selectedRecommendation) {
        const message = recommendationText();
        const { error: recommendationError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: effectiveMediaAttachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (recommendationError) throw recommendationError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-three-tier-recommendations",
            routeReason:
              recommendationsOnly
                ? `The user asked to compare media choices, so CoOperative ranked the exact-request routes but intentionally did not generate.`
                : `No execution-ready exact-match route fit the current ${requestCapUsd.toFixed(2)} per-prompt ceiling, so CoOperative returned the ranked choices without starting generation.`,
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      let mediaPreparationSource:
        | "deterministic"
        | "local"
        | "free-cloud" = "deterministic";
      let mediaPreparationReason =
        "Deterministic media routing had enough information to proceed.";
      let mediaPreparationSignals: string[] = [];
      let preparedMediaPrompt: string | null = null;

      if (
        selectedRecommendation &&
        selectedRecommendation.executionReady === true
      ) {
        const deterministicPrompt = mediaPromptWithResolvedControls(
          effectiveMediaRequestText,
          mediaPlan,
        );
        const preparation = await prepareMediaExecutionWithReasoning({
          admin,
          ownerRef,
          userId: owner.userId,
          userRequest: effectiveMediaRequestText,
          deterministicPrompt,
          plan: mediaPlan,
          selected: selectedRecommendation,
          options: recommendationSet.options,
          requestCapUsd,
          requiresReferenceImage,
          explicitTierSelected: Boolean(recommendationTier),
        });

        const preparedAdultClass = adultMediaContentClass(preparation.prompt);
        const preparedPromptPreservesContentScope =
          preparedAdultClass === adultContentClass;

        if (preparation.model !== selectedRecommendation.model) {
          const reasonedSelection = recommendationSet.options.find(
            (option) =>
              option.executionReady === true &&
              option.capUsd <= requestCapUsd + 0.000001 &&
              option.model === preparation.model,
          );
          if (reasonedSelection) {
            selectedRecommendation = reasonedSelection;
          }
        }

        mediaPreparationSource = preparation.source;
        mediaPreparationReason = preparation.reason;
        mediaPreparationSignals = preparation.signals;
        preparedMediaPrompt = preparedPromptPreservesContentScope
          ? mediaPromptWithResolvedControls(preparation.prompt, mediaPlan)
          : deterministicPrompt;

        if (!preparedPromptPreservesContentScope && preparation.usedReasoning) {
          mediaPreparationSource = "deterministic";
          mediaPreparationReason =
            "Local/free preparation changed the detected adult-content scope, so CoOperative rejected the rewrite and preserved the deterministic prompt.";
        }
      }

      const selectedReferenceVerification =
        selectedRecommendation?.provider === "nous" &&
        selectedRecommendation.editEndpoint
          ? referenceModelVerifications.find(
              (item) =>
                item.provider === "nous" &&
                item.model === selectedRecommendation.model &&
                item.editEndpoint === selectedRecommendation.editEndpoint,
            ) || null
          : null;
      const premiumReferenceVerified =
        selectedReferenceVerification?.status === "verified";
      const premiumReferenceSmokeTest =
        requiresReferenceImage &&
        selectedRecommendation?.provider === "nous" &&
        isApprovedPremiumReferenceSmokeRoute(
          selectedRecommendation.model,
          selectedRecommendation.editEndpoint,
        ) &&
        selectedReferenceVerification === null &&
        referenceVerification?.readyForApprovedSmokeTest === true;
      const premiumReferenceRoute =
        requiresReferenceImage &&
        selectedRecommendation?.provider === "nous" &&
        Boolean(selectedRecommendation.editEndpoint) &&
        selectedRecommendation.executionReady === true &&
        referenceVerification?.readyForApprovedSmokeTest === true;
      const cloudReferenceRoute =
        requiresReferenceImage &&
        selectedRecommendation?.provider !== "cooperative-local" &&
        selectedRecommendation?.executionReady === true;

      if (!selectedRecommendation) {
        const message = recommendationText();
        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-three-tier-recommendations",
            routeReason:
              "The requested recommendation tier was not available from the current live catalog, so no generation started.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (selectedRecommendation.executionReady === false) {
        const message =
          `The ${selectedRecommendation.label} reference-image option is verified for Hermes capability and live pricing, but this update intentionally does not enable its Nous gateway/attachment execution yet. I did not start a generation.\n\n` +
          recommendationText();

        await admin.from("local_ai_messages").insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: visibleUserText,
            attachment_ids: effectiveMediaAttachmentIds,
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: message,
            attachment_ids: [],
            job_id: null,
          },
        ]);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-reference-recommendation-verification-gate",
            routeReason:
              "The premium reference-image model is recommendation-only until the managed Nous gateway and attachment handoff are verified.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      if (selectedRecommendation.capUsd > requestCapUsd + 0.000001) {
        const message =
          `The ${selectedRecommendation.label} option is currently estimated at \$${selectedRecommendation.estimatedCostUsd.toFixed(3)}, so its safe request cap is \$${selectedRecommendation.capUsd.toFixed(2)}. Your current cap is \$${requestCapUsd.toFixed(2)}, so I did not start it.\n\n` +
          recommendationText();

        const { error: capError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: effectiveMediaAttachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (capError) throw capError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-recommendation-cap-gate",
            routeReason:
              "The user selected a media recommendation, but the current request cap is below its live estimate.",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      mediaLevel =
        selectedRecommendation.tier === "high-end"
          ? 4
          : selectedRecommendation.tier === "balanced"
            ? 2
            : 1;

      const referenceImageExecution =
        cloudReferenceRoute
          ? await createReferenceImageExecutionUrls({
              ownerRef,
              attachmentIds: effectiveMediaAttachmentIds,
            })
          : null;

      if (selectedRecommendation.provider === "cooperative-local") {
        const localExecutionGate = await evaluateMediaExecutionContentGate({
          userId: owner.userId,
          ownerRef,
          provider: selectedRecommendation.provider,
          model: selectedRecommendation.model,
          endpoint: selectedRecommendation.editEndpoint,
          adultContentClass,
        });
        if (!localExecutionGate.allowed) {
          const message =
            localExecutionGate.note +
            " CoOperative re-checked the current setting and exact route immediately before local execution, so no generation started.";

          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: effectiveMediaAttachmentIds,
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text: message,
              provider: "code",
              model: "media-execution-content-gate",
              routeReason:
                `Execution-time content gate blocked the selected local route (${localExecutionGate.reason}).`,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        const localJobId = crypto.randomUUID();
        const generationPrompt =
          preparedMediaPrompt ||
          mediaPromptWithResolvedControls(
            effectiveMediaRequestText,
            mediaPlan,
          );
        const referencePaths = await stageLocalImageReferences(
          admin,
          ownerRef,
          localJobId,
          effectiveMediaAttachmentIds,
        );
        const localProfile =
          selectedRecommendation.model.includes("fast") ? "fast" : "quality";
        const variationMode =
          selectedRecommendation.model.includes("quality-reference")
            ? "preserve"
            : "balanced";

        const { error: localJobError } = await admin.from("inference_jobs").insert({
          id: localJobId,
          kind: "image",
          status: "queued",
          client_owner_ref: ownerRef,
          prompt: generationPrompt,
          aspect_ratio: mediaPlan.aspectRatio || "4:5",
          profile: localProfile,
          variation_mode: variationMode,
          reference_paths: referencePaths,
          seed:
            Number.parseInt(localJobId.replaceAll("-", "").slice(0, 8), 16) %
            2147483648,
        });
        if (localJobError) {
          if (referencePaths.length) {
            await admin.storage
              .from("inference-job-assets")
              .remove(referencePaths.map((reference) => reference.path));
          }
          throw localJobError;
        }

        const { error: localMessageError } = await admin
          .from("local_ai_messages")
          .insert({
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: visibleUserText,
            attachment_ids: effectiveMediaAttachmentIds,
            job_id: localJobId,
          });
        if (localMessageError) throw localMessageError;

        return NextResponse.json(
          {
            jobId: localJobId,
            status: "queued",
            execution: "media",
            capability: "image",
            conversationId,
            conversationTitle,
            provider: "cooperative-local",
            model: selectedRecommendation.model,
            routeReason:
              effectiveMediaAttachmentIds.length > 0
                ? `The user selected the quoted ${selectedRecommendation.label.toLowerCase()} reference-image route. The current attachment is scoped to this new image task only.`
                : `The user selected the quoted ${selectedRecommendation.label.toLowerCase()} owned/local image route.`,
            estimatedProviderCostUsd: 0,
            requestMaxSpendUsd: requestCapUsd,
          },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }

      let selectedMediaModel: MediaCatalogModel | null = null;
      const selectedProvider: "nous" | "openrouter" | null =
        selectedRecommendation.provider;
      const selectedModel = selectedRecommendation.model;
      const selectedUserQuoteUsd = selectedRecommendation.estimatedCostUsd;
      const estimatedProviderCostUsd: number | null =
        selectedRecommendation.providerCostEstimateUsd;
      const selectedMarkupPercent = selectedRecommendation.markupPercent;
      const selectedFree = estimatedProviderCostUsd <= 0;
      const pricingSource = selectedRecommendation.pricingSource;
      const selectedResolution: string | null =
        selectedRecommendation.resolution || mediaPlan.resolution;
      const selectedAudio: boolean | null =
        selectedRecommendation.audio ?? mediaPlan.audio;

      if (selectedProvider === "openrouter") {
        selectedMediaModel =
          liveCatalog?.[mediaPlan.kind].find(
            (model) => model.id === selectedModel,
          ) || null;
        if (!selectedMediaModel) {
          const message =
            "That quoted OpenRouter model is no longer present in the live catalog, so I did not start a generation. Ask me to refresh the three options.";
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text: message,
              provider: "code",
              model: "media-recommendation-stale",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }
      }

      if (selectedProvider === "nous" && !nousRuntimeAuth) {
        const message =
          "The selected recommendation uses Nous, but the Nous authorization is not currently usable. I did not start a generation. Reconnect or refresh Nous, then choose the option again." +
          (nousAuthFailure ? ` Current status: ${nousAuthFailure}` : "") +
          "\n\nOAUTH_SERVICE_CONNECT:nous-portal";
        await admin.from("local_ai_messages").insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: visibleUserText,
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: message,
            attachment_ids: [],
            job_id: null,
          },
        ]);
        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "nous-media-auth-gate",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const openRouterService =
        selectedProvider === "openrouter"
          ? await businessOwnedServiceCredentialForOwner(
              ownerRef,
              "openrouter-api",
            )
          : null;
      const userOwnedOpenRouterCredential =
        openRouterService?.credential?.trim() || undefined;
      const cooperativeOpenRouterCredential =
        process.env.OPENROUTER_API_KEY?.trim() || undefined;
      const cooperativeFundedPaidRoute =
        selectedProvider === "openrouter" &&
        !selectedFree &&
        !userOwnedOpenRouterCredential &&
        Boolean(cooperativeOpenRouterCredential);
      const providerCredential =
        userOwnedOpenRouterCredential ||
        cooperativeOpenRouterCredential ||
        undefined;

      if (
        selectedProvider === "openrouter" &&
        !selectedFree &&
        providerCredential
      ) {
        const spendStatus = await openRouterKeySpendStatus(providerCredential);
        const enoughKnownBalance =
          spendStatus.accountCreditsRemainingUsd === null ||
          estimatedProviderCostUsd === null ||
          spendStatus.accountCreditsRemainingUsd >= estimatedProviderCostUsd;
        const enoughKeyLimit =
          spendStatus.keyLimitRemainingUsd === null ||
          estimatedProviderCostUsd === null ||
          spendStatus.keyLimitRemainingUsd >= estimatedProviderCostUsd;

        if (!spendStatus.paidEligible || !enoughKnownBalance || !enoughKeyLimit) {
          const message =
            "OpenRouter is connected, but its live key/credit status does not currently approve this paid media call. I did not spend anything. Add OpenRouter credits or use the Nous/local route, then retry.\n\nBUDGET_FOLLOWUPS";
          await admin.from("local_ai_messages").insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text: message,
              provider: "code",
              model: "openrouter-spend-preflight",
              routeReason:
                "CoOperative verified the connected OpenRouter key before a paid call and stopped because paid capacity was not live-spend eligible.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }
      }

      if (selectedProvider === "openrouter" && !providerCredential) {
        const message =
          "OpenRouter is not connected yet. Go to Services, add OpenRouter API, and paste your OpenRouter API key once. CoOperative will keep it in the encrypted server-side vault and use it for image/video generation.";
        const { error: connectError } = await admin
          .from("local_ai_messages")
          .insert([
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "user",
              content: visibleUserText,
              attachment_ids: [],
              job_id: null,
            },
            {
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: message,
              attachment_ids: [],
              job_id: null,
            },
          ]);
        if (connectError) throw connectError;

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-provider-setup",
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const cloudExecutionGate = await evaluateMediaExecutionContentGate({
        userId: owner.userId,
        ownerRef,
        provider: selectedProvider,
        model: selectedModel,
        endpoint: selectedRecommendation.editEndpoint,
        adultContentClass,
      });
      if (!cloudExecutionGate.allowed) {
        const message =
          cloudExecutionGate.note +
          " CoOperative re-checked the current setting and exact provider/model route immediately before submission, so no generation started.";

        await admin.from("local_ai_messages").insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: visibleUserText,
            attachment_ids: effectiveMediaAttachmentIds,
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: message,
            attachment_ids: [],
            job_id: null,
          },
        ]);

        return NextResponse.json(
          {
            status: "completed",
            execution: "code",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            text: message,
            provider: "code",
            model: "media-execution-content-gate",
            routeReason:
              `Execution-time content gate blocked the selected cloud route (${cloudExecutionGate.reason}).`,
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      }

      const jobId = crypto.randomUUID();
      let generationPrompt =
        preparedMediaPrompt ||
        mediaPromptWithResolvedControls(
          effectiveMediaRequestText,
          mediaPlan,
        );
      if (
        selectedProvider === "nous" &&
        mediaPlan.kind === "video" &&
        selectedModel === "pixverse-v6"
      ) {
        if (selectedResolution) {
          generationPrompt += `\nBudget-approved resolution: ${selectedResolution}.`;
        }
        if (selectedAudio !== null) {
          generationPrompt += `\nBudget-approved generated audio: ${selectedAudio ? "on" : "off"}.`;
        }
      }
      const requestMaxSpendMicrousd = Math.round(requestCapUsd * 1_000_000);

      const { error: mediaJobError } = await admin
        .from("media_generation_jobs")
        .insert({
          id: jobId,
          status: "queued",
          request_root_job_id: jobId,
          route_attempt: 1,
          execution_mode:
            selectedProvider === "openrouter" && mediaPlan.kind === "image"
              ? "direct-provider"
              : "hermes",
          owner_ref: ownerRef,
          conversation_id: conversationId,
          kind: mediaPlan.kind,
          prompt: generationPrompt,
          provider: selectedProvider,
          model: selectedModel,
          model_mixer: input.modelMixer || null,
          request_max_spend_microusd: requestMaxSpendMicrousd,
          media_level: mediaLevel,
          estimated_provider_cost_microusd:
            estimatedProviderCostUsd === null
              ? null
              : Math.round(estimatedProviderCostUsd * 1_000_000),
          estimated_user_charge_microusd:
            cooperativeFundedPaidRoute
              ? Math.round(selectedUserQuoteUsd * 1_000_000)
              : 0,
          estimated_infrastructure_cost_microusd: null,
          estimated_margin_microusd:
            cooperativeFundedPaidRoute && estimatedProviderCostUsd !== null
              ? Math.round(
                  Math.max(
                    0,
                    selectedUserQuoteUsd - estimatedProviderCostUsd,
                  ) * 1_000_000,
                )
              : null,
          billing_mode: cooperativeFundedPaidRoute
            ? "cooperative-balance"
            : selectedProvider === "openrouter" && !selectedFree
              ? "openrouter-byok"
              : selectedProvider === "nous" && !selectedFree
                ? "nous-subscription"
                : null,
          provider_cost_bearer:
            selectedFree
              ? "free"
              : cooperativeFundedPaidRoute
                ? "cooperative"
                : selectedProvider === "nous" || selectedProvider === "openrouter"
                  ? "user-connected"
                  : "cooperative",
          pricing_dimensions: {
            durationSeconds: mediaPlan.durationSeconds,
            aspectRatio: mediaPlan.aspectRatio,
            resolution: selectedResolution,
            audio: selectedAudio,
            mediaLevel,
            freeRoute: selectedFree,
            quotedUserPriceUsd: cooperativeFundedPaidRoute
              ? selectedUserQuoteUsd
              : 0,
            providerCostEstimateUsd: estimatedProviderCostUsd,
            markupPercent: cooperativeFundedPaidRoute
              ? selectedMarkupPercent
              : 0,
            referenceSmokeTest: premiumReferenceSmokeTest,
            referenceVerifiedRoute: premiumReferenceVerified,
            referenceEditEndpoint: premiumReferenceRoute
              ? selectedRecommendation.editEndpoint
              : null,
            referenceAttachmentCount: cloudReferenceRoute
              ? effectiveMediaAttachmentIds.length
              : 0,
            referenceAttachmentIds: cloudReferenceRoute
              ? effectiveMediaAttachmentIds
              : [],
            preparationSource: mediaPreparationSource,
            preparationReason: mediaPreparationReason,
            preparationSignals: mediaPreparationSignals,
            directProvider:
              selectedProvider === "openrouter" && mediaPlan.kind === "image",
          },
          pricing_source: pricingSource,
        });
      if (mediaJobError) throw mediaJobError;

      const { error: mediaUserMessageError } = await admin
        .from("local_ai_messages")
        .insert({
          conversation_id: conversationId,
          owner_ref: ownerRef,
          role: "user",
          content: visibleUserText,
          attachment_ids: requiresReferenceImage
            ? effectiveMediaAttachmentIds
            : [],
          // local_ai_messages.job_id is intentionally reserved for text_inference_jobs.
          // Media requests are tracked in media_generation_jobs and returned to the client
          // through the media job id, so do not put a media UUID into this FK-backed field.
          job_id: null,
        });
      if (mediaUserMessageError) {
        await admin.from("media_generation_jobs").delete().eq("id", jobId);
        throw new Error(
          mediaUserMessageError.message || "Could not save media request to chat.",
        );
      }

      let mediaBalanceReservationId: string | null = null;
      if (
        cooperativeFundedPaidRoute &&
        estimatedProviderCostUsd !== null &&
        estimatedProviderCostUsd > 0
      ) {
        const fundingQuote = await fundingQuoteForUser({
          userId: owner.userId,
          estimatedCostUsd: selectedUserQuoteUsd,
          maxSpendUsd: requestCapUsd,
        });

        if (!fundingQuote.allowedBySpendPolicy) {
          const message =
            `This paid media route is quoted at ${selectedUserQuoteUsd.toFixed(4)}, which is above the current request cap of ${requestCapUsd.toFixed(4)}. I did not start a provider call.`;
          await admin.from("local_ai_messages").insert({
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: message,
            attachment_ids: [],
            job_id: null,
          });
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text: message,
              provider: "code",
              model: "media-profile-balance-spend-cap",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (!fundingQuote.sufficientBalance) {
          const directive = fundingDirective({
            kind: "media",
            jobId,
            quote: fundingQuote,
          });
          const topUp = fundingQuote.topUpOption;
          const assistantText = [
            `This ${mediaPlan.kind} route has a quoted CoOperative price of ${selectedUserQuoteUsd.toFixed(4)}.`,
            `Your available CoOperative AI balance is ${fundingQuote.availableBalanceUsd.toFixed(4)}. To reserve this request safely, the profile needs at least ${fundingQuote.minimumRequiredBalanceUsd.toFixed(4)}, so you need ${fundingQuote.shortfallUsd.toFixed(4)} more.`,
            topUp
              ? `The smallest configured Stripe top-up that covers it is ${topUp.amountUsd.toFixed(2)}.`
              : "No Stripe balance top-up option is currently configured.",
            "I did not start a provider call or spend anything.",
            "",
            directive,
          ].join("\n");

          await admin.from("local_ai_messages").insert({
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          });

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: "code",
              model: "media-profile-balance-funding-gate",
              mediaFundingJobId: jobId,
              fundingRequired: {
                estimatedCostUsd: fundingQuote.estimatedCostUsd,
                availableBalanceUsd: fundingQuote.availableBalanceUsd,
                shortfallUsd: fundingQuote.shortfallUsd,
                minimumRequiredBalanceUsd:
                  fundingQuote.minimumRequiredBalanceUsd,
                topUpOption: topUp,
              },
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        const reservation = await reserveAiProfileFunds({
          profileRef: cooperativeProfileRef(owner.userId),
          estimatedCostUsd: selectedUserQuoteUsd,
          source: "media-generation",
          referenceId: jobId,
          metadata: {
            provider: selectedProvider,
            model: selectedModel,
            kind: mediaPlan.kind,
            conversationId,
            quotedUserPriceUsd: selectedUserQuoteUsd,
            providerCostEstimateUsd: estimatedProviderCostUsd,
            markupPercent: selectedMarkupPercent,
            estimatedMarginUsd:
              estimatedProviderCostUsd === null
                ? null
                : selectedUserQuoteUsd - estimatedProviderCostUsd,
          },
        });

        if (!reservation) {
          const refreshedQuote = await fundingQuoteForUser({
            userId: owner.userId,
            estimatedCostUsd: estimatedProviderCostUsd,
            maxSpendUsd: requestCapUsd,
          });
          const directive = fundingDirective({
            kind: "media",
            jobId,
            quote: refreshedQuote,
          });
          const assistantText = [
            "The available AI balance changed before I could reserve this media request.",
            `You now need ${refreshedQuote.shortfallUsd.toFixed(4)} more available balance to continue.`,
            "I did not start a provider call.",
            "",
            directive,
          ].join("\n");
          await admin.from("local_ai_messages").insert({
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: assistantText,
            attachment_ids: [],
            job_id: null,
          });
          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text: assistantText,
              provider: "code",
              model: "media-profile-balance-reservation-race",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        mediaBalanceReservationId = reservation.id;
        const { error: reservationUpdateError } = await admin
          .from("media_generation_jobs")
          .update({
            ai_balance_reservation_id: reservation.id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("owner_ref", ownerRef)
          .eq("status", "queued");
        if (reservationUpdateError) {
          await releaseAiProfileFunds({
            reservationId: reservation.id,
            metadata: { reason: "media-job-reservation-link-failed" },
          });
          throw reservationUpdateError;
        }
      }

      if (selectedProvider === "openrouter" && mediaPlan.kind === "image") {
        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            jobId,
            status: "queued",
            execution: "media",
            capability: "image",
            conversationId,
            conversationTitle,
            provider: selectedProvider,
            model: selectedModel,
            routeReason: cloudReferenceRoute
              ? "CoOperative finalized the prompt/model choice first, then queued a direct OpenRouter image call with the same reference attachment. No text-model orchestrator sits between routing and the image provider."
              : "CoOperative finalized the prompt/model choice first, then queued a direct OpenRouter image call. No text-model orchestrator sits between routing and the image provider.",
            estimatedProviderCostUsd,
            quotedUserPriceUsd: cooperativeFundedPaidRoute
              ? selectedUserQuoteUsd
              : null,
            modelMixer: input.modelMixer || null,
            requestMaxSpendUsd: input.modelMixer?.maxSpendUsd ?? null,
          },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      }

      try {
        const started = await startHermesMediaTask({
          jobId,
          kind: mediaPlan.kind,
          userRequest: generationPrompt,
          provider: selectedProvider,
          model: selectedModel,
          providerCredential,
          nousAuthJson: nousRuntimeAuth?.sandboxAuthJson,
          referenceImageUrls: referenceImageExecution?.urls,
          referenceSmokeTest: premiumReferenceSmokeTest,
        });

        const { error: mediaStartError } = await admin
          .from("media_generation_jobs")
          .update({
            status: "running",
            sandbox_name: started.sandboxName,
            started_at: started.startedAt,
            deadline_at: started.deadlineAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("owner_ref", ownerRef);
        if (mediaStartError) throw mediaStartError;

        await admin
          .from("local_ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)
          .eq("owner_ref", ownerRef);

        return NextResponse.json(
          {
            jobId,
            status: "running",
            execution: "media",
            capability: mediaPlan.kind,
            conversationId,
            conversationTitle,
            provider: started.provider,
            model: started.model,
            routeReason: premiumReferenceSmokeTest
              ? `The user explicitly selected an approved one-shot premium reference smoke-test route. CoOperative passed the current reference image through a short-lived server-side URL to ${selectedRecommendation.editEndpoint}, enforced the quoted cap before submission, and will not retry or fall back automatically.`
              : premiumReferenceVerified
                ? `The selected premium reference route was already verified by a successful prior generation on this profile. CoOperative passed the current reference image through a fresh short-lived server-side URL to ${selectedRecommendation.editEndpoint}, enforced the quoted cap, and started the verified route normally.`
                : cloudReferenceRoute
                  ? `CoOperative selected the reference-capable ${selectedModel} route and passed ${effectiveMediaAttachmentIds.length} attached reference image${effectiveMediaAttachmentIds.length === 1 ? "" : "s"} through short-lived server-side URLs. The request remains bounded by the Model Mixer spend cap, and CoOperative will not fall back to a route that could ignore the reference.`
                  : `CoOperative selected ${selectedModel} from live pricing at Media level ${mediaLevel}. ${selectedProvider === "nous" ? "Nous Portal entitlement is first." : selectedFree ? "A zero-provider-cost hosted route was selected before paid OpenRouter." : "Paid OpenRouter is the final connected backup."} ${mediaPreparationSource === "deterministic" ? "Deterministic preparation was sufficient, so no extra AI planning call was needed." : `Deterministic preparation was not sufficient, so ${mediaPreparationSource === "local" ? "owned/local" : "strict-free"} reasoning refined the eligible model choice and provider-ready prompt before the single media-generation call.`} The request remains bounded by the Model Mixer spend cap.`,
            estimatedProviderCostUsd,
            quotedUserPriceUsd: cooperativeFundedPaidRoute
              ? selectedUserQuoteUsd
              : null,
            modelMixer: input.modelMixer || null,
            requestMaxSpendUsd: input.modelMixer?.maxSpendUsd ?? null,
          },
          { status: 202, headers: { "Cache-Control": "no-store" } },
        );
      } catch (mediaStartFailure) {
        const detail =
          mediaStartFailure instanceof Error
            ? mediaStartFailure.message
            : "Hermes media generation could not start.";
        if (mediaBalanceReservationId) {
          await releaseAiProfileFunds({
            reservationId: mediaBalanceReservationId,
            metadata: { reason: "media-generation-did-not-start", jobId },
          }).catch(() => undefined);
        }
        await admin
          .from("media_generation_jobs")
          .update({
            status: "failed",
            ai_balance_reservation_id: null,
            actual_user_charge_microusd: 0,
            error: detail.slice(0, 1200),
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("owner_ref", ownerRef);

        if (cloudReferenceRoute) {
          if (
            premiumReferenceRoute &&
            premiumReferenceSmokeTest &&
            selectedRecommendation.editEndpoint
          ) {
            await recordMediaReferenceModelVerification({
              ownerRef,
              provider: "nous",
              model: selectedRecommendation.model,
              editEndpoint: selectedRecommendation.editEndpoint,
              sourceJobId: jobId,
              success: false,
              failureReason: detail,
            });
          }

          return NextResponse.json(
            {
              status: "failed",
              execution: "media",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              error: detail,
              provider: selectedRecommendation.provider,
              model: selectedRecommendation.model,
              routeReason: premiumReferenceSmokeTest
                ? "The one-shot premium reference smoke test could not start. CoOperative recorded the failure and did not retry, fall back, or launch Recovery Agent."
                : "The reference-image route could not start. CoOperative preserved the reference-image boundary and did not retry or fall back to a route that might ignore the attachment.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        try {
          const recovery = await startRecoveryForJob(ownerRef, jobId);
          await admin
            .from("local_ai_conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", conversationId)
            .eq("owner_ref", ownerRef);

          return NextResponse.json(
            {
              status: "completed",
              execution: "code",
              capability: mediaPlan.kind,
              conversationId,
              conversationTitle,
              text:
                recovery.current_message ||
                "Recovery Agent is repairing the failed cloud route in the background.",
              provider: "recovery",
              model: "local-first-recovery",
              routeReason:
                "The cloud/Hermes route failed before media generation started. CoOperative handed diagnosis to local/owned Recovery Agent capacity and released the chat while repair continues.",
              recoveryIncidentId: recovery.id,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch (recoveryError) {
          console.error("Could not start cloud-to-local recovery", {
            jobId,
            detail:
              recoveryError instanceof Error
                ? recoveryError.message.slice(0, 800)
                : "Unknown recovery error",
          });
          throw mediaStartFailure;
        }
      }
    }

    const directResult = await handleBusinessIntake({
      userId: owner.userId,
      businessId: effectiveBusinessId || undefined,
      conversationId,
      message: input.message,
      hasAttachments: input.attachmentIds.length > 0,
    });

    if (directResult.handled && directResult.text) {
      const { error: directMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: input.attachmentIds,
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: directResult.text,
            attachment_ids: [],
            job_id: null,
          },
        ]);

      if (directMessageError) throw directMessageError;

      const { error: directConversationError } = await admin
        .from("local_ai_conversations")
        .update({
          profile: input.profile,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);

      if (directConversationError) throw directConversationError;

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          profile: input.profile,
          conversationId,
          conversationTitle,
          text: directResult.text,
          provider: "code",
          model: directResult.agent || "deterministic",
          routeReason: directResult.routeReason,
          savedFacts: directResult.savedFacts || [],
          business: businessContext?.business ?? null,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const codeFirstNeeds =
      input.attachmentIds.length === 0
        ? new Set(platformFaqDataNeeds(input.message))
        : new Set<ReturnType<typeof platformFaqDataNeeds>[number]>();

    const codeFirstBusinesses = codeFirstNeeds.has("businesses")
      ? await codeFirstOwnedBusinessList(ownerRef)
      : undefined;

    const codeFirstProfileFields = codeFirstNeeds.has("profile")
      ? await codeFirstProfileFieldSnapshot(ownerRef, effectiveBusinessId)
      : undefined;

    const codeFirstConnectedServices = codeFirstNeeds.has("services")
      ? await connectedServiceStatusesForOwner(ownerRef)
      : undefined;

    let codeFirstNodeSummary:
      | { total: number; fresh: number; paused: number }
      | undefined;
    if (codeFirstNeeds.has("nodes")) {
      const authorizedNodeIds = await activeNodeIds(admin, owner.userId);
      if (!authorizedNodeIds.length) {
        codeFirstNodeSummary = { total: 0, fresh: 0, paused: 0 };
      } else {
        const { data: nodes, error: nodeStatusError } = await admin
          .from("unison_nodes")
          .select("id,state,last_seen_at")
          .in("id", authorizedNodeIds);
        if (nodeStatusError) throw nodeStatusError;

        const freshAfter = Date.now() - 90_000;
        codeFirstNodeSummary = {
          total: authorizedNodeIds.length,
          fresh: (nodes || []).filter((node) => {
            const seenAt = Date.parse(node.last_seen_at || "");
            return (
              node.state !== "paused" &&
              Number.isFinite(seenAt) &&
              seenAt >= freshAfter
            );
          }).length,
          paused: (nodes || []).filter((node) => node.state === "paused").length,
        };
      }
    }

    let codeFirstRecentJobs:
      | Array<{
          kind: string;
          status: string;
          provider?: string | null;
          model?: string | null;
          createdAt?: string | null;
          completedAt?: string | null;
        }>
      | undefined;
    if (codeFirstNeeds.has("jobs")) {
      const [textJobsResult, mediaJobsResult] = await Promise.all([
        admin
          .from("inference_jobs")
          .select("kind,status,result_provider,result_model,created_at,completed_at")
          .eq("client_owner_ref", ownerRef)
          .order("created_at", { ascending: false })
          .limit(5),
        admin
          .from("media_generation_jobs")
          .select("kind,status,provider,model,created_at,completed_at")
          .eq("owner_ref", ownerRef)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      if (textJobsResult.error) throw textJobsResult.error;
      if (mediaJobsResult.error) throw mediaJobsResult.error;

      codeFirstRecentJobs = [
        ...(textJobsResult.data || []).map((job) => ({
          kind: String(job.kind || "text"),
          status: String(job.status || "unknown"),
          provider: job.result_provider || null,
          model: job.result_model || null,
          createdAt: job.created_at || null,
          completedAt: job.completed_at || null,
        })),
        ...(mediaJobsResult.data || []).map((job) => ({
          kind: String(job.kind || "media"),
          status: String(job.status || "unknown"),
          provider: job.provider || null,
          model: job.model || null,
          createdAt: job.created_at || null,
          completedAt: job.completed_at || null,
        })),
      ]
        .sort(
          (a, b) =>
            Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
        )
        .slice(0, 5);
    }

    const codeFirstDecision = handleCodeFirstChat({
      message: input.message,
      hasAttachments: input.attachmentIds.length > 0,
      profile: input.profile,
      nodeRouting: input.nodeRouting,
      businessId: effectiveBusinessId,
      businessName: businessContext?.business.name || null,
      availableAiBalanceUsd: profileBalance.availableUsd,
      paidAiFunded: profileBalance.funded,
      onboardingStatus: serverOnboardingState.status,
      onboardingMode: serverOnboardingState.mode,
      onboardingPhase: serverOnboardingState.phase,
      businesses: codeFirstBusinesses,
      profileFields: codeFirstProfileFields,
      connectedServices: codeFirstConnectedServices,
      nodeSummary: codeFirstNodeSummary,
      recentJobs: codeFirstRecentJobs,
    });

    if (codeFirstDecision.handled && codeFirstDecision.text) {
      const { error: codeFirstMessageError } = await admin
        .from("local_ai_messages")
        .insert([
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "user",
            content: input.message.trim(),
            attachment_ids: [],
            job_id: null,
          },
          {
            conversation_id: conversationId,
            owner_ref: ownerRef,
            role: "assistant",
            content: codeFirstDecision.text,
            attachment_ids: [],
            job_id: null,
          },
        ]);
      if (codeFirstMessageError) throw codeFirstMessageError;

      const { error: codeFirstConversationError } = await admin
        .from("local_ai_conversations")
        .update({
          profile: input.profile,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversationId)
        .eq("owner_ref", ownerRef);
      if (codeFirstConversationError) throw codeFirstConversationError;

      return NextResponse.json(
        {
          status: "completed",
          execution: "code",
          capability: "text",
          profile: input.profile,
          conversationId,
          conversationTitle,
          text: codeFirstDecision.text,
          provider: "code",
          model: codeFirstDecision.handler,
          routeReason: codeFirstDecision.routeReason,
          business: businessContext?.business ?? null,
          businessId: effectiveBusinessId,
          aiNeeded: false,
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: previousMessages, error: historyError } = await admin
      .from("local_ai_messages")
      .select("role,content,attachment_ids")
      .eq("conversation_id", conversationId)
      .eq("owner_ref", ownerRef)
      .order("created_at", { ascending: false })
      .limit(39);

    if (historyError) throw historyError;

    if (
      currentAttachmentIds.length === 0 &&
      explicitlyReusesRecentImage(input.message)
    ) {
      const latestImageMessage = (previousMessages || []).find(
        (message) =>
          Array.isArray(message.attachment_ids) && message.attachment_ids.length > 0,
      );
      if (latestImageMessage) {
        currentAttachmentIds = latestImageMessage.attachment_ids.slice(0, 4);
      }
    }

    const requestedCapability = currentAttachmentIds.length > 0 ? "vision" : "text";
    let preferredNodeId: string | null = null;
    let targetNodeId: string | null = null;
    let nodeRouteNote = "";
    let profileExecutionPlan:
      | Awaited<ReturnType<typeof resolveProfileExecutionPlan>>
      | null = null;

    if (requestedCapability !== "text" && input.nodeRouting === "require-node") {
      return NextResponse.json(
        {
          error:
            "The selected Unison node route does not support image-understanding chat yet.",
        },
        { status: 409 },
      );
    }

    if (requestedCapability === "text") {
      if (input.nodeRouting === "require-node" && !input.requiredNodeId) {
        return NextResponse.json(
          { error: "Choose an authorized Unison node to require." },
          { status: 400 },
        );
      }

      profileExecutionPlan = await resolveProfileExecutionPlan({
        admin,
        userId: owner.userId,
        capability: "text",
        nodeRouting: input.nodeRouting,
        requiredNodeId: input.requiredNodeId || null,
        fundedBalanceUsd: profileBalance.availableUsd,
        maxSpendUsd: input.modelMixer?.maxSpendUsd ?? null,
      });

      if (profileExecutionPlan.requiredNodeUnavailable) {
        return NextResponse.json(
          {
            error:
              "That authorized Unison node is not currently available for text generation.",
          },
          { status: 409 },
        );
      }

      preferredNodeId = profileExecutionPlan.preferredNodeId;
      targetNodeId = profileExecutionPlan.targetNodeId;
      nodeRouteNote = ` ${profileExecutionPlan.routeReason}`;
    }


    const history = [...(previousMessages || [])]
      .reverse()
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content as string,
      }));

    const visibleUserText = input.message.trim();
    const modelUserText =
      visibleUserText ||
      (currentAttachmentIds.length > 0
        ? "Describe and analyze the attached image."
        : "");
    const jobId = crypto.randomUUID();

    let runtimeContext:
      | Awaited<ReturnType<typeof buildAndSaveRuntimeContext>>
      | null = null;
    try {
      runtimeContext = await buildAndSaveRuntimeContext({
        ownerRef,
        conversationId,
        currentRequest: modelUserText,
        requestType: `${requestedCapability} / general`,
        businessId: effectiveBusinessId,
      });
    } catch (contextError) {
      console.error("Could not build private runtime markdown context", {
        jobId,
        detail:
          contextError instanceof Error
            ? contextError.message.slice(0, 800)
            : "Unknown context error",
      });
    }

    const systemMessages = [
      {
        role: "system" as const,
        content: COOPERATIVE_BUSINESS_CHAT_POLICY,
      },
      ...(businessContext
        ? [
            {
              role: "system" as const,
              content: businessContext.systemContext,
            },
          ]
        : []),
      {
        role: "system" as const,
        content: scopeContext,
      },
      ...(runtimeContext
        ? [
            {
              role: "system" as const,
              content: [
                "PRIVATE COOPERATIVE RUNTIME MARKDOWN CONTEXT.",
                `Storage path: ${runtimeContext.storagePath}`,
                "Use the database-backed memory/outcome/review evidence below when relevant. It is subordinate to current user instructions and code-authored policy.",
                "",
                runtimeContext.promptMarkdown,
              ].join("\n"),
            },
          ]
        : []),
    ];
    const userMessage = { role: "user" as const, content: modelUserText };
    const historyLimit = 39 - systemMessages.length;
    const jobMessages = [
      ...systemMessages,
      ...history.slice(-historyLimit),
      userMessage,
    ];
    const mixerRouteNote = input.modelMixer
      ? ` Model Mixer ${input.modelMixer.preset}; max request spend ${input.modelMixer.maxSpendUsd.toFixed(2)}; levels research=${input.modelMixer.agents.research}, planner=${input.modelMixer.agents.planner}, builder=${input.modelMixer.agents.builder}, verifier=${input.modelMixer.agents.verifier}, media=${input.modelMixer.agents.media}.`
      : "";
    const requestMaxSpendMicrousd = input.modelMixer
      ? Math.round(input.modelMixer.maxSpendUsd * 1_000_000)
      : null;

    const { error: jobError } = await admin.from("text_inference_jobs").insert({
      id: jobId,
      status: "queued",
      client_owner_ref: ownerRef,
      conversation_id: conversationId,
      messages: jobMessages,
      attachment_ids: currentAttachmentIds,
      capability: currentAttachmentIds.length > 0 ? "vision" : "text",
      profile: input.profile,
      routing_preference: input.nodeRouting,
      preferred_node_id: preferredNodeId,
      target_node_id: targetNodeId,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
      routing_mode: input.profile === "quality" ? "local-quality" : "local-fast",
      task_class: "general",
      route_reason:
        (input.profile === "quality"
          ? `Manual Local Quality selection. Business policy ${COOPERATIVE_BUSINESS_POLICY_REVISION} applied.${businessContext ? " Active business economic context applied." : ""}${nodeRouteNote}${mixerRouteNote}`
          : `Manual Local Fast selection. Business policy ${COOPERATIVE_BUSINESS_POLICY_REVISION} applied.${businessContext ? " Active business economic context applied." : ""}${nodeRouteNote}${mixerRouteNote}`) +
        (requestedCapability === "vision"
          ? ` Local vision has first priority for ${Math.round(FREE_VISION_FALLBACK_GRACE_MS / 1000)} seconds; if still unclaimed, CoOperative may use the connected strict-free Hermes/OpenRouter vision fallback. Paid vision fallback is disabled.`
          : requestedCapability === "text" &&
              input.nodeRouting !== "require-node"
            ? ` Owned/local text has first priority for ${Math.round(FREE_TEXT_FALLBACK_GRACE_MS / 1000)} seconds; if still unclaimed, CoOperative may use strict-free Hermes/OpenRouter text reasoning before any funded paid fallback.`
            : "") +
        ` Code-first preflight: ${codeFirstDecision.routeReason}`,
      allow_paid_fallback:
        requestedCapability === "text" &&
        input.nodeRouting !== "require-node" &&
        (requestMaxSpendMicrousd === null || requestMaxSpendMicrousd > 0),
      human_approval_required: false,
      model_registry_revision: TEXT_MODEL_REGISTRY_REVISION,
      verification_status: "not_run",
      model_mixer: input.modelMixer || null,
      request_max_spend_microusd: requestMaxSpendMicrousd,
      business_id: effectiveBusinessId,
      context_document_path: runtimeContext?.storagePath || null,
      context_document_generated_at: runtimeContext?.generatedAt || null,
    });

    if (jobError) throw jobError;

    const { error: messageError } = await admin.from("local_ai_messages").insert({
      conversation_id: conversationId,
      owner_ref: ownerRef,
      role: "user",
      content: visibleUserText,
      attachment_ids: input.attachmentIds,
      job_id: jobId,
    });

    if (messageError) {
      await admin.from("text_inference_jobs").delete().eq("id", jobId);
      throw messageError;
    }

    const { error: updateConversationError } = await admin
      .from("local_ai_conversations")
      .update({
        profile: input.profile,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("owner_ref", ownerRef);

    if (updateConversationError) throw updateConversationError;

    return NextResponse.json(
      {
        jobId,
        execution: "local-ai",
        status: "queued",
        profile: input.profile,
        conversationId,
        conversationTitle,
        business: businessContext?.business ?? null,
        businessId: effectiveBusinessId,
        businessScopeSource: resolvedBusiness.source,
        routingPreference: input.nodeRouting,
        preferredNodeId,
        targetNodeId,
        paidAiEligible:
          requestedCapability === "text" &&
          (profileExecutionPlan?.paidEligible ?? false),
        availableAiBalanceUsd: profileBalance.availableUsd,
        modelMixer: input.modelMixer || null,
        requestMaxSpendUsd: input.modelMixer?.maxSpendUsd ?? null,
        aiNeeded: codeFirstDecision.aiNeeded,
        aiEscalationReason: codeFirstDecision.routeReason,
      },
      { status: 202, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : error &&
            typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : "Could not queue local AI chat.";
    console.error("Local AI chat queue failed", {
      detail: detail.slice(0, 800),
    });
    return NextResponse.json(
      { error: "Could not queue local AI chat.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(request: Request) {
  const owner = await currentOwner();
  if (!owner) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerRef = owner.ownerRef;
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || "";

  try {
    const admin = createAdminSupabaseClient();
    let query = admin
      .from("text_inference_jobs")
      .select(
        "id,status,profile,conversation_id,business_id,capability,attachment_ids,messages,partial_text,result_text,result_model,result_provider,prompt_tokens,output_tokens,first_token_ms,latency_ms,worker_id,routing_preference,preferred_node_id,target_node_id,route_reason,allow_paid_fallback,error,queued_at,claimed_at,created_at,completed_at,fallback_provider,fallback_model,fallback_sandbox_name,fallback_deadline_at,fallback_attempted_at,fallback_usage",
      )
      .eq("client_owner_ref", ownerRef);

    query = jobId
      ? query.eq("id", jobId)
      : query
          .in("status", ["queued", "running"])
          .order("created_at", { ascending: false })
          .limit(1);

    const { data: job, error } = await query.maybeSingle();

    if (error) throw error;

    if (
      job &&
      job.capability === "vision" &&
      job.status === "queued" &&
      !job.worker_id &&
      !job.fallback_attempted_at &&
      job.routing_preference !== "require-node" &&
      Date.now() - Date.parse(job.queued_at || job.created_at || "") >=
        FREE_VISION_FALLBACK_GRACE_MS
    ) {
      const openRouterService =
        await businessOwnedServiceCredentialForOwner(ownerRef, "openrouter-api");
      const openRouterCredential =
        openRouterService?.credential ||
        process.env.OPENROUTER_API_KEY?.trim() ||
        null;

      if (openRouterCredential) {
        const claimedAt = new Date().toISOString();
        const cloudRouteReason =
          `${job.route_reason || ""} Local vision was not claimed within ${Math.round(
            FREE_VISION_FALLBACK_GRACE_MS / 1000,
          )} seconds, so CoOperative claimed this same vision job for a zero-model-cost Hermes/OpenRouter fallback. Paid model fallback remains disabled.`.trim();

        const { data: cloudClaim, error: cloudClaimError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "running",
            worker_id: FREE_VISION_WORKER_ID,
            claimed_at: claimedAt,
            fallback_provider: "openrouter",
            fallback_model: "openrouter/free",
            fallback_attempted_at: claimedAt,
            route_reason: cloudRouteReason,
            updated_at: claimedAt,
          })
          .eq("id", job.id)
          .eq("client_owner_ref", ownerRef)
          .eq("status", "queued")
          .is("worker_id", null)
          .is("fallback_attempted_at", null)
          .select("id,conversation_id,attachment_ids,messages")
          .maybeSingle();

        if (cloudClaimError) throw cloudClaimError;

        if (cloudClaim) {
          try {
            const images = await hermesVisionImagesForAttachments(
              admin,
              ownerRef,
              Array.isArray(cloudClaim.attachment_ids)
                ? cloudClaim.attachment_ids
                : [],
            );
            const started = await startHermesVisionTask({
              jobId: cloudClaim.id,
              question: latestUserRequest(cloudClaim.messages),
              images,
              openRouterCredential,
            });

            const { error: cloudStartError } = await admin
              .from("text_inference_jobs")
              .update({
                fallback_provider: started.provider,
                fallback_model: started.visionModel,
                fallback_sandbox_name: started.sandboxName,
                fallback_deadline_at: started.deadlineAt,
                updated_at: new Date().toISOString(),
              })
              .eq("id", cloudClaim.id)
              .eq("client_owner_ref", ownerRef)
              .eq("worker_id", FREE_VISION_WORKER_ID)
              .eq("status", "running");
            if (cloudStartError) throw cloudStartError;

            return NextResponse.json(
              {
                jobId: cloudClaim.id,
                execution: "free-cloud-vision",
                status: "running",
                profile: job.profile,
                conversationId: cloudClaim.conversation_id,
                capability: "vision",
                provider: started.provider,
                model: started.visionModel,
                workerId: FREE_VISION_WORKER_ID,
                routeReason: cloudRouteReason,
                paidFallbackAllowed: false,
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          } catch (cloudStartFailure) {
            const detail =
              cloudStartFailure instanceof Error
                ? cloudStartFailure.message
                : "Free cloud vision could not start.";
            const fallbackBackToLocalReason =
              `${cloudRouteReason} The free cloud attempt could not start (${detail.slice(
                0,
                400,
              )}); the job was returned to the owned/local queue without trying a paid model.`;

            const { error: releaseError } = await admin
              .from("text_inference_jobs")
              .update({
                status: "queued",
                worker_id: null,
                claimed_at: null,
                fallback_sandbox_name: null,
                fallback_deadline_at: null,
                route_reason: fallbackBackToLocalReason,
                error: null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", cloudClaim.id)
              .eq("client_owner_ref", ownerRef)
              .eq("worker_id", FREE_VISION_WORKER_ID);
            if (releaseError) throw releaseError;

            return NextResponse.json(
              {
                jobId: cloudClaim.id,
                execution: "local-ai",
                status: "queued",
                profile: job.profile,
                conversationId: cloudClaim.conversation_id,
                capability: "vision",
                workerId: null,
                routeReason: fallbackBackToLocalReason,
                paidFallbackAllowed: false,
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
        }
      }
    }

    if (
      job &&
      job.capability === "vision" &&
      job.status === "running" &&
      job.worker_id === FREE_VISION_WORKER_ID &&
      job.fallback_sandbox_name &&
      job.fallback_deadline_at
    ) {
      const polled = await pollHermesVisionTask({
        sandboxName: job.fallback_sandbox_name,
        deadlineAt: job.fallback_deadline_at,
      });

      if (polled.state === "running") {
        return NextResponse.json(
          {
            jobId: job.id,
            execution: "free-cloud-vision",
            status: "running",
            profile: job.profile,
            conversationId: job.conversation_id,
            capability: "vision",
            provider: job.fallback_provider || "openrouter",
            model: job.fallback_model || "openrouter/free",
            workerId: FREE_VISION_WORKER_ID,
            routeReason: job.route_reason,
            paidFallbackAllowed: false,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (polled.state === "completed" && polled.text) {
        const completedAt = new Date().toISOString();
        const claimedMs = Date.parse(job.claimed_at || "");
        const latencyMs = Number.isFinite(claimedMs)
          ? Math.max(0, Date.parse(completedAt) - claimedMs)
          : null;

        const { data: completedJob, error: completionError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "completed",
            result_text: polled.text,
            partial_text: polled.text,
            result_model: job.fallback_model || "openrouter/free",
            result_provider: "openrouter-free",
            latency_ms: latencyMs,
            fallback_usage: polled.usage,
            error: null,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", job.id)
          .eq("client_owner_ref", ownerRef)
          .eq("worker_id", FREE_VISION_WORKER_ID)
          .eq("status", "running")
          .select("id")
          .maybeSingle();
        if (completionError) throw completionError;

        if (completedJob && job.conversation_id) {
          const { error: messageError } = await admin
            .from("local_ai_messages")
            .upsert(
              {
                conversation_id: job.conversation_id,
                owner_ref: ownerRef,
                role: "assistant",
                content: polled.text.trim(),
                attachment_ids: [],
                job_id: job.id,
              },
              { onConflict: "job_id,role" },
            );
          if (messageError) throw messageError;

          await admin
            .from("local_ai_conversations")
            .update({ updated_at: completedAt })
            .eq("id", job.conversation_id)
            .eq("owner_ref", ownerRef);

          const parsedMessages = z
            .array(textInferenceMessageSchema)
            .min(1)
            .max(40)
            .safeParse(job.messages);
          if (parsedMessages.success) {
            try {
              await persistResponseSupport({
                ownerRef,
                conversationId: job.conversation_id,
                jobId: job.id,
                messages: parsedMessages.data,
                answer: polled.text.trim(),
                provider: "openrouter-free",
                model: job.fallback_model || "openrouter/free",
                businessId: job.business_id || null,
              });
            } catch (supportError) {
              console.error("Could not persist free vision response support", {
                jobId: job.id,
                detail:
                  supportError instanceof Error
                    ? supportError.message.slice(0, 600)
                    : "Unknown support error",
              });
            }
          }
        }

        if (completedJob) {
          try {
            await refreshRuntimeContextAfterOutcome({
              ownerRef,
              jobId: job.id,
              conversationId: job.conversation_id,
              requestType: "vision / free-cloud success",
              allowExternalReview: true,
              businessId: job.business_id || null,
            });
          } catch (contextError) {
            console.error("Could not refresh free vision runtime context", {
              jobId: job.id,
              detail:
                contextError instanceof Error
                  ? contextError.message.slice(0, 600)
                  : "Unknown context error",
            });
          }
        }

        return NextResponse.json(
          {
            jobId: job.id,
            execution: "free-cloud-vision",
            status: "completed",
            profile: job.profile,
            conversationId: job.conversation_id,
            capability: "vision",
            text: polled.text,
            provider: "openrouter-free",
            model: job.fallback_model || "openrouter/free",
            latencyMs,
            workerId: FREE_VISION_WORKER_ID,
            routeReason: job.route_reason,
            paidFallbackAllowed: false,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const failedAt = new Date().toISOString();
      const failureDetail =
        polled.error || "Free cloud vision did not return a usable answer.";
      const localRetryReason =
        `${job.route_reason || ""} The zero-cost cloud vision attempt failed (${failureDetail.slice(
          0,
          400,
        )}); CoOperative returned the same job to owned/local vision and did not try a paid model.`.trim();

      const { error: localReleaseError } = await admin
        .from("text_inference_jobs")
        .update({
          status: "queued",
          worker_id: null,
          claimed_at: null,
          fallback_sandbox_name: null,
          fallback_deadline_at: null,
          fallback_usage: polled.usage,
          route_reason: localRetryReason,
          error: null,
          updated_at: failedAt,
        })
        .eq("id", job.id)
        .eq("client_owner_ref", ownerRef)
        .eq("worker_id", FREE_VISION_WORKER_ID)
        .eq("status", "running");
      if (localReleaseError) throw localReleaseError;

      return NextResponse.json(
        {
          jobId: job.id,
          execution: "local-ai",
          status: "queued",
          profile: job.profile,
          conversationId: job.conversation_id,
          capability: "vision",
          workerId: null,
          routeReason: localRetryReason,
          paidFallbackAllowed: false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      job &&
      job.capability === "text" &&
      job.status === "queued" &&
      !job.worker_id &&
      !job.fallback_attempted_at &&
      job.routing_preference !== "require-node" &&
      Date.now() - Date.parse(job.queued_at || job.created_at || "") >=
        FREE_TEXT_FALLBACK_GRACE_MS
    ) {
      const openRouterService =
        await businessOwnedServiceCredentialForOwner(ownerRef, "openrouter-api");
      const openRouterCredential =
        openRouterService?.credential ||
        process.env.OPENROUTER_API_KEY?.trim() ||
        null;

      if (openRouterCredential) {
        const claimedAt = new Date().toISOString();
        const cloudRouteReason =
          `${job.route_reason || ""} Owned/local text was not claimed within ${Math.round(
            FREE_TEXT_FALLBACK_GRACE_MS / 1000,
          )} seconds, so CoOperative claimed this same text job for strict-free Hermes/OpenRouter reasoning before any funded paid fallback.`.trim();

        const { data: cloudClaim, error: cloudClaimError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "running",
            worker_id: FREE_TEXT_WORKER_ID,
            claimed_at: claimedAt,
            fallback_provider: "openrouter",
            fallback_model: "openrouter/free",
            fallback_attempted_at: claimedAt,
            route_reason: cloudRouteReason,
            updated_at: claimedAt,
          })
          .eq("id", job.id)
          .eq("client_owner_ref", ownerRef)
          .eq("status", "queued")
          .is("worker_id", null)
          .is("fallback_attempted_at", null)
          .select("id,conversation_id,messages")
          .maybeSingle();

        if (cloudClaimError) throw cloudClaimError;

        if (cloudClaim) {
          let effectiveCloudRouteReason = cloudRouteReason;
          try {
            const { data: webSettings, error: webSettingsError } = await admin
              .from("personal_ai_settings")
              .select("web_access_mode")
              .eq("user_id", owner.userId)
              .maybeSingle();
            if (webSettingsError) throw webSettingsError;

            const webAccessMode =
              webSettings?.web_access_mode === "auto" ||
              webSettings?.web_access_mode === "always"
                ? webSettings.web_access_mode
                : "off";
            const webResearch = await buildHostedWebResearch({
              query: latestUserRequest(cloudClaim.messages),
              mode: webAccessMode,
            });

            effectiveCloudRouteReason = [
              cloudRouteReason,
              webResearch.used
                ? `Profile Web ${webResearch.mode} authorized deterministic public research before free-cloud reasoning (${webResearch.sources.length} source${webResearch.sources.length === 1 ? "" : "s"}; provider ${webResearch.provider || "direct-public-page"}). Hermes itself remained tool-free.`
                : `Profile Web ${webResearch.mode} did not add public research: ${webResearch.reason}`,
            ].join(" ");

            const started = await startHermesTextTask({
              jobId: cloudClaim.id,
              messages: hermesTextContextMessages(cloudClaim.messages),
              openRouterCredential,
              webContext: webResearch.context || null,
            });

            const { error: cloudStartError } = await admin
              .from("text_inference_jobs")
              .update({
                fallback_provider: started.provider,
                fallback_model: started.model,
                fallback_sandbox_name: started.sandboxName,
                fallback_deadline_at: started.deadlineAt,
                fallback_usage: {
                  cooperativeWeb: {
                    mode: webResearch.mode,
                    used: webResearch.used,
                    provider: webResearch.provider,
                    sourceCount: webResearch.sources.length,
                    searchUsed: webResearch.searchUsed,
                    directPageReads: webResearch.directPageReads,
                    reason: webResearch.reason,
                  },
                },
                route_reason: effectiveCloudRouteReason,
                updated_at: new Date().toISOString(),
              })
              .eq("id", cloudClaim.id)
              .eq("client_owner_ref", ownerRef)
              .eq("worker_id", FREE_TEXT_WORKER_ID)
              .eq("status", "running");
            if (cloudStartError) throw cloudStartError;

            return NextResponse.json(
              {
                jobId: cloudClaim.id,
                execution: "free-cloud-text",
                status: "running",
                profile: job.profile,
                conversationId: cloudClaim.conversation_id,
                capability: "text",
                provider: started.provider,
                model: started.model,
                workerId: FREE_TEXT_WORKER_ID,
                routeReason: effectiveCloudRouteReason,
                webSearchUsed: webResearch.used,
                webAccessMode: webResearch.mode,
                webSourceCount: webResearch.sources.length,
                paidFallbackAllowed: job.allow_paid_fallback === true,
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          } catch (cloudStartFailure) {
            const detail =
              cloudStartFailure instanceof Error
                ? cloudStartFailure.message
                : "Free cloud text could not start.";
            const failedAt = new Date().toISOString();
            const failedReason =
              `${effectiveCloudRouteReason} The strict-free cloud text attempt could not start (${detail.slice(
                0,
                400,
              )}). CoOperative will only continue to funded premium AI if this job is eligible under the existing spend and balance rules.`.trim();

            const { error: failError } = await admin
              .from("text_inference_jobs")
              .update({
                status: "failed",
                worker_id: null,
                claimed_at: null,
                fallback_sandbox_name: null,
                fallback_deadline_at: null,
                route_reason: failedReason,
                error: detail.slice(0, 1200),
                completed_at: failedAt,
                updated_at: failedAt,
              })
              .eq("id", cloudClaim.id)
              .eq("client_owner_ref", ownerRef)
              .eq("worker_id", FREE_TEXT_WORKER_ID)
              .eq("status", "running");
            if (failError) throw failError;

            try {
              await refreshRuntimeContextAfterOutcome({
                ownerRef,
                jobId: cloudClaim.id,
                conversationId: cloudClaim.conversation_id,
                requestType: "text / free-cloud start failure",
                allowExternalReview: true,
              });
            } catch (contextError) {
              console.error("Could not archive free text start failure", {
                jobId: cloudClaim.id,
                detail:
                  contextError instanceof Error
                    ? contextError.message.slice(0, 600)
                    : "Unknown context error",
              });
            }

            return NextResponse.json(
              {
                jobId: cloudClaim.id,
                execution: "free-cloud-text",
                status: "failed",
                profile: job.profile,
                conversationId: cloudClaim.conversation_id,
                capability: "text",
                workerId: null,
                routeReason: failedReason,
                paidFallbackAllowed: job.allow_paid_fallback === true,
                error: detail.slice(0, 1200),
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
        }
      }
    }

    if (
      job &&
      job.capability === "text" &&
      job.status === "running" &&
      job.worker_id === FREE_TEXT_WORKER_ID &&
      job.fallback_sandbox_name &&
      job.fallback_deadline_at
    ) {
      const polled = await pollHermesTextTask({
        sandboxName: job.fallback_sandbox_name,
        deadlineAt: job.fallback_deadline_at,
      });

      const webMetadata = freeCloudWebMetadata(job.fallback_usage);

      if (polled.state === "running") {
        return NextResponse.json(
          {
            jobId: job.id,
            execution: "free-cloud-text",
            status: "running",
            profile: job.profile,
            conversationId: job.conversation_id,
            capability: "text",
            provider: job.fallback_provider || "openrouter",
            model: job.fallback_model || "openrouter/free",
            workerId: FREE_TEXT_WORKER_ID,
            routeReason: job.route_reason,
            webSearchUsed: webMetadata?.used === true,
            webAccessMode: webMetadata?.mode || "off",
            webSourceCount: webMetadata?.sourceCount || 0,
            paidFallbackAllowed: job.allow_paid_fallback === true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (polled.state === "completed" && polled.text) {
        const completedAt = new Date().toISOString();
        const claimedMs = Date.parse(job.claimed_at || "");
        const latencyMs = Number.isFinite(claimedMs)
          ? Math.max(0, Date.parse(completedAt) - claimedMs)
          : null;

        const { data: completedJob, error: completionError } = await admin
          .from("text_inference_jobs")
          .update({
            status: "completed",
            result_text: polled.text,
            partial_text: polled.text,
            result_model: job.fallback_model || "openrouter/free",
            result_provider: "openrouter-free",
            latency_ms: latencyMs,
            fallback_usage: {
              ...(job.fallback_usage &&
              typeof job.fallback_usage === "object" &&
              !Array.isArray(job.fallback_usage)
                ? job.fallback_usage
                : {}),
              ...(polled.usage || {}),
            },
            error: null,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", job.id)
          .eq("client_owner_ref", ownerRef)
          .eq("worker_id", FREE_TEXT_WORKER_ID)
          .eq("status", "running")
          .select("id")
          .maybeSingle();
        if (completionError) throw completionError;

        if (completedJob && job.conversation_id) {
          const { error: messageError } = await admin
            .from("local_ai_messages")
            .upsert(
              {
                conversation_id: job.conversation_id,
                owner_ref: ownerRef,
                role: "assistant",
                content: polled.text.trim(),
                attachment_ids: [],
                job_id: job.id,
              },
              { onConflict: "job_id,role" },
            );
          if (messageError) throw messageError;

          await admin
            .from("local_ai_conversations")
            .update({ updated_at: completedAt })
            .eq("id", job.conversation_id)
            .eq("owner_ref", ownerRef);

          const parsedMessages = z
            .array(textInferenceMessageSchema)
            .min(1)
            .max(40)
            .safeParse(job.messages);
          if (parsedMessages.success) {
            try {
              await persistResponseSupport({
                ownerRef,
                conversationId: job.conversation_id,
                jobId: job.id,
                messages: parsedMessages.data,
                answer: polled.text.trim(),
                provider: "openrouter-free",
                model: job.fallback_model || "openrouter/free",
                businessId: job.business_id || null,
              });
            } catch (supportError) {
              console.error("Could not persist free response support", {
                jobId: job.id,
                detail:
                  supportError instanceof Error
                    ? supportError.message.slice(0, 600)
                    : "Unknown support error",
              });
            }
          }
        }

        if (completedJob) {
          try {
            await refreshRuntimeContextAfterOutcome({
              ownerRef,
              jobId: job.id,
              conversationId: job.conversation_id,
              requestType: "text / free-cloud success",
              allowExternalReview: true,
              businessId: job.business_id || null,
            });
          } catch (contextError) {
            console.error("Could not refresh free text runtime context", {
              jobId: job.id,
              detail:
                contextError instanceof Error
                  ? contextError.message.slice(0, 600)
                  : "Unknown context error",
            });
          }
        }

        return NextResponse.json(
          {
            jobId: job.id,
            execution: "free-cloud-text",
            status: "completed",
            profile: job.profile,
            conversationId: job.conversation_id,
            capability: "text",
            text: polled.text,
            provider: "openrouter-free",
            model: job.fallback_model || "openrouter/free",
            latencyMs,
            workerId: FREE_TEXT_WORKER_ID,
            routeReason: job.route_reason,
            webSearchUsed: webMetadata?.used === true,
            webAccessMode: webMetadata?.mode || "off",
            webSourceCount: webMetadata?.sourceCount || 0,
            paidFallbackAllowed: job.allow_paid_fallback === true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const failedAt = new Date().toISOString();
      const failureDetail =
        polled.error || "Free cloud text did not return a usable answer.";
      const failedReason =
        `${job.route_reason || ""} The strict-free cloud text attempt failed (${failureDetail.slice(
          0,
          400,
        )}). CoOperative will only continue to funded premium AI if this job is eligible under the existing spend and balance rules.`.trim();

      const { error: failError } = await admin
        .from("text_inference_jobs")
        .update({
          status: "failed",
          fallback_usage: {
            ...(job.fallback_usage &&
            typeof job.fallback_usage === "object" &&
            !Array.isArray(job.fallback_usage)
              ? job.fallback_usage
              : {}),
            ...(polled.usage || {}),
          },
          route_reason: failedReason,
          error: failureDetail.slice(0, 1200),
          completed_at: failedAt,
          updated_at: failedAt,
        })
        .eq("id", job.id)
        .eq("client_owner_ref", ownerRef)
        .eq("worker_id", FREE_TEXT_WORKER_ID)
        .eq("status", "running");
      if (failError) throw failError;

      try {
        await refreshRuntimeContextAfterOutcome({
          ownerRef,
          jobId: job.id,
          conversationId: job.conversation_id,
          requestType: "text / free-cloud failure",
          allowExternalReview: true,
          businessId: job.business_id || null,
        });
      } catch (contextError) {
        console.error("Could not archive free text failure", {
          jobId: job.id,
          detail:
            contextError instanceof Error
              ? contextError.message.slice(0, 600)
              : "Unknown context error",
        });
      }

      return NextResponse.json(
        {
          jobId: job.id,
          execution: "free-cloud-text",
          status: "failed",
          profile: job.profile,
          conversationId: job.conversation_id,
          capability: "text",
          workerId: FREE_TEXT_WORKER_ID,
          routeReason: failedReason,
          paidFallbackAllowed: job.allow_paid_fallback === true,
          error: failureDetail,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!job) {
      let mediaQuery = admin
        .from("media_generation_jobs")
        .select(
          "id,status,conversation_id,kind,prompt,provider,model,model_mixer,request_max_spend_microusd,media_level,estimated_provider_cost_microusd,estimated_user_charge_microusd,actual_user_charge_microusd,ai_balance_reservation_id,billing_mode,provider_cost_bearer,pricing_dimensions,pricing_source,fallback_from_job_id,request_root_job_id,route_attempt,execution_mode,sandbox_name,result_url,result_text,usage,error,started_at,deadline_at,completed_at,created_at",
        )
        .eq("owner_ref", ownerRef);

      mediaQuery = jobId
        ? mediaQuery.eq("id", jobId)
        : mediaQuery
            .in("status", ["queued", "running"])
            .order("created_at", { ascending: false })
            .limit(1);

      const { data: mediaJob, error: mediaError } = await mediaQuery.maybeSingle();
      if (mediaError) throw mediaError;

      if (
        mediaJob &&
        !jobId &&
        mediaJob.status === "queued" &&
        mediaJob.billing_mode === "cooperative-balance" &&
        !mediaJob.ai_balance_reservation_id
      ) {
        return new Response(null, { status: 204 });
      }

      if (!mediaJob) {
        let localImageQuery = admin
          .from("inference_jobs")
          .select(
            "id,status,prompt,aspect_ratio,profile,result_path,result_model,result_provider,worker_id,error,created_at,completed_at",
          )
          .eq("client_owner_ref", ownerRef);

        localImageQuery = jobId
          ? localImageQuery.eq("id", jobId)
          : localImageQuery
              .in("status", ["queued", "running"])
              .order("created_at", { ascending: false })
              .limit(1);

        const { data: localImageJob, error: localImageError } =
          await localImageQuery.maybeSingle();
        if (localImageError) throw localImageError;

        if (!localImageJob) {
          return jobId
            ? NextResponse.json({ error: "Job not found." }, { status: 404 })
            : new Response(null, { status: 204 });
        }

        const { data: localImageMessage } = await admin
          .from("local_ai_messages")
          .select("conversation_id")
          .eq("owner_ref", ownerRef)
          .eq("job_id", localImageJob.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const conversationId = localImageMessage?.conversation_id || null;

        let mediaUrl: string | null = null;
        if (localImageJob.status === "completed" && localImageJob.result_path) {
          const { data: signed, error: signError } = await admin.storage
            .from("inference-job-assets")
            .createSignedUrl(localImageJob.result_path, 15 * 60);
          if (signError) throw signError;
          mediaUrl = signed?.signedUrl || null;
        }

        if (localImageJob.status === "completed" && mediaUrl) {
          const resultText =
            `Generated image locally with ${localImageJob.result_model || "CoOperative local image model"}.\nMEDIA_IMAGE:${mediaUrl}`;

          const { data: existingResultMessage } = await admin
            .from("local_ai_messages")
            .select("id")
            .eq("conversation_id", conversationId)
            .eq("owner_ref", ownerRef)
            .eq("content", resultText)
            .limit(1)
            .maybeSingle();

          if (!existingResultMessage) {
            await admin.from("local_ai_messages").insert({
              conversation_id: conversationId,
              owner_ref: ownerRef,
              role: "assistant",
              content: resultText,
              attachment_ids: [],
              job_id: localImageJob.id,
            });
          }
        }

        return NextResponse.json(
          {
            jobId: localImageJob.id,
            execution: "media",
            status: localImageJob.status,
            conversationId,
            capability: "image",
            provider: localImageJob.result_provider || "cooperative-local",
            model: localImageJob.result_model || "local-image-quality",
            text:
              localImageJob.status === "completed" && mediaUrl
                ? `Generated image locally with ${localImageJob.result_model || "CoOperative local image model"}.\nMEDIA_IMAGE:${mediaUrl}`
                : null,
            mediaUrl,
            workerId: localImageJob.worker_id,
            error: localImageJob.error,
            routeReason:
              localImageJob.status === "completed"
                ? "Owned local image generation completed after the cloud provider hit an account-credit boundary."
                : "Owned local image generation is handling the request without increasing provider spend.",
            createdAt: localImageJob.created_at,
            completedAt: localImageJob.completed_at,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const mediaPricingDimensions =
        mediaJob.pricing_dimensions &&
        typeof mediaJob.pricing_dimensions === "object" &&
        !Array.isArray(mediaJob.pricing_dimensions)
          ? (mediaJob.pricing_dimensions as {
              directProvider?: unknown;
              referenceAttachmentIds?: unknown;
              generatedStoragePath?: unknown;
              generatedMimeType?: unknown;
            })
          : {};

      if (
        mediaJob.status === "running" &&
        mediaJob.provider === "openrouter" &&
        mediaJob.kind === "image" &&
        mediaPricingDimensions.directProvider === true
      ) {
        const deadline = mediaJob.deadline_at
          ? Date.parse(mediaJob.deadline_at)
          : Number.NaN;
        const started = mediaJob.started_at
          ? Date.parse(mediaJob.started_at)
          : Number.NaN;
        const reconciliationDeadline =
          Number.isFinite(deadline)
            ? deadline
            : Number.isFinite(started)
              ? started + 150_000
              : Number.NaN;

        if (
          Number.isFinite(reconciliationDeadline) &&
          Date.now() <= reconciliationDeadline
        ) {
          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "running",
              conversationId: mediaJob.conversation_id,
              capability: "image",
              provider: mediaJob.provider,
              model: mediaJob.model,
              routeReason:
                "The direct image-provider call is still inside its execution window. CoOperative is keeping this request ledger locked so another paid generation cannot start concurrently.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const failedAt = new Date().toISOString();
        const uncertainError =
          "Direct image-provider execution passed its reconciliation deadline without a persisted provider response. The outcome is uncertain, so CoOperative will not submit another paid generation automatically.";
        await admin
          .from("media_generation_jobs")
          .update({
            status: "failed",
            error: uncertainError,
            completed_at: failedAt,
            updated_at: failedAt,
          })
          .eq("id", mediaJob.id)
          .eq("owner_ref", ownerRef)
          .eq("status", "running");

        const recovery = await startRecoveryForJob(ownerRef, mediaJob.id).catch(
          (error) => {
            console.error("Could not start direct media reconciliation recovery", {
              jobId: mediaJob.id,
              detail:
                error instanceof Error ? error.message.slice(0, 800) : "unknown",
            });
            return null;
          },
        );

        const assistantText =
          "The direct provider call stopped reporting before CoOperative received a final response. Recovery Agent is reconciling that route in the background, but the router is intentionally not starting another paid image call because the first provider may already have processed it.";

        return NextResponse.json(
          {
            jobId: mediaJob.id,
            execution: "code",
            status: "completed",
            conversationId: mediaJob.conversation_id,
            capability: "image",
            provider: "code",
            model: "direct-media-reconciliation",
            text: assistantText,
            recoveryIncidentId: recovery?.id || null,
            routeReason:
              "The request-level execution ledger prevented an uncertain direct-provider timeout from causing duplicate provider spend while Recovery Agent investigates independently.",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (
        mediaJob.status === "queued" &&
        mediaJob.provider === "openrouter" &&
        mediaJob.kind === "image" &&
        mediaPricingDimensions.directProvider === true
      ) {
        const startedAt = new Date().toISOString();
        const deadlineAt = new Date(Date.now() + 120_000).toISOString();
        const { data: claimed, error: claimError } = await admin
          .from("media_generation_jobs")
          .update({
            status: "running",
            started_at: startedAt,
            deadline_at: deadlineAt,
            updated_at: startedAt,
          })
          .eq("id", mediaJob.id)
          .eq("owner_ref", ownerRef)
          .eq("status", "queued")
          .select("id")
          .maybeSingle();
        if (claimError) throw claimError;

        if (!claimed) {
          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "running",
              conversationId: mediaJob.conversation_id,
              capability: "image",
              provider: mediaJob.provider,
              model: mediaJob.model,
              routeReason:
                "Direct provider image execution has already been claimed by another status request.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const service = await businessOwnedServiceCredentialForOwner(
          ownerRef,
          "openrouter-api",
        );
        const credential =
          service?.credential?.trim() ||
          process.env.OPENROUTER_API_KEY?.trim() ||
          undefined;

        if (!credential) {
          const failedAt = new Date().toISOString();
          await admin
            .from("media_generation_jobs")
            .update({
              status: "failed",
              error: "OpenRouter credential is unavailable for direct image execution.",
              completed_at: failedAt,
              updated_at: failedAt,
            })
            .eq("id", mediaJob.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running");

          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "failed",
              conversationId: mediaJob.conversation_id,
              capability: "image",
              provider: mediaJob.provider,
              model: mediaJob.model,
              error: "OpenRouter credential is unavailable for direct image execution.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const referenceAttachmentIds = Array.isArray(
          mediaPricingDimensions.referenceAttachmentIds,
        )
          ? mediaPricingDimensions.referenceAttachmentIds.filter(
              (value): value is string =>
                typeof value === "string" && value.length > 0,
            )
          : [];
        const referenceExecution = referenceAttachmentIds.length
          ? await createReferenceImageExecutionUrls({
              ownerRef,
              attachmentIds: referenceAttachmentIds,
            })
          : null;

        const direct = await executeOpenRouterImageDirect({
          jobId: mediaJob.id,
          ownerRef,
          model: mediaJob.model,
          prompt: mediaJob.prompt,
          credential,
          referenceImageUrls: referenceExecution?.urls,
        });

        if (direct.ok) {
          const completedAt = new Date().toISOString();
          const mediaUrl =
            `/api/local-ai/media-output?jobId=${encodeURIComponent(mediaJob.id)}`;
          const resultText =
            `Generated image with ${mediaJob.model}.\nMEDIA_IMAGE:${mediaUrl}`;
          const mergedPricingDimensions = {
            ...mediaPricingDimensions,
            directProvider: true,
            generatedStoragePath: direct.storagePath,
            generatedMimeType: direct.mimeType,
          };

          const { data: completedJob, error: completeError } = await admin
            .from("media_generation_jobs")
            .update({
              status: "completed",
              result_url: mediaUrl,
              result_text: resultText,
              usage: direct.usage,
              pricing_dimensions: mergedPricingDimensions,
              error: null,
              completed_at: completedAt,
              updated_at: completedAt,
            })
            .eq("id", mediaJob.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running")
            .select("id")
            .maybeSingle();
          if (completeError) throw completeError;

          let billedMicrousd: number | null = null;
          if (
            completedJob &&
            mediaJob.billing_mode === "cooperative-balance" &&
            mediaJob.ai_balance_reservation_id
          ) {
            const quotedChargeMicrousd = Math.max(
              0,
              Number(mediaJob.estimated_user_charge_microusd || 0),
            );
            try {
              await settleAiProfileFunds({
                reservationId: mediaJob.ai_balance_reservation_id,
                actualCostUsd: quotedChargeMicrousd / 1_000_000,
                metadata: {
                  jobId: mediaJob.id,
                  outcome: "completed",
                  provider: mediaJob.provider,
                  model: mediaJob.model,
                  kind: "image",
                  execution: "direct-provider",
                },
              });
              billedMicrousd = quotedChargeMicrousd;
              await admin
                .from("media_generation_jobs")
                .update({
                  billed_microusd: quotedChargeMicrousd,
                  actual_user_charge_microusd: quotedChargeMicrousd,
                  actual_provider_cost_microusd: Math.max(
                    0,
                    Number(mediaJob.estimated_provider_cost_microusd || 0),
                  ),
                  actual_margin_microusd: Math.max(
                    0,
                    quotedChargeMicrousd -
                      Math.max(
                        0,
                        Number(mediaJob.estimated_provider_cost_microusd || 0),
                      ),
                  ),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", mediaJob.id)
                .eq("owner_ref", ownerRef);
            } catch (billingError) {
              console.error("Could not settle direct paid media reservation", {
                jobId: mediaJob.id,
                detail:
                  billingError instanceof Error
                    ? billingError.message.slice(0, 800)
                    : "Unknown direct media billing error",
              });
            }
          }

          if (completedJob && mediaJob.conversation_id) {
            await admin.from("local_ai_messages").insert({
              conversation_id: mediaJob.conversation_id,
              owner_ref: ownerRef,
              role: "assistant",
              content: resultText,
              attachment_ids: [],
              job_id: null,
            });
            await admin
              .from("local_ai_conversations")
              .update({ updated_at: completedAt })
              .eq("id", mediaJob.conversation_id)
              .eq("owner_ref", ownerRef);
          }

          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "completed",
              conversationId: mediaJob.conversation_id,
              capability: "image",
              provider: "openrouter",
              model: mediaJob.model,
              text: resultText,
              mediaUrl,
              funding:
                billedMicrousd !== null
                  ? { chargedUsd: billedMicrousd / 1_000_000 }
                  : null,
              routeReason:
                "CoOperative called the selected OpenRouter image model directly after planning. No text-model orchestrator sat between routing and image generation.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const completedAt = new Date().toISOString();
        if (
          mediaJob.billing_mode === "cooperative-balance" &&
          mediaJob.ai_balance_reservation_id
        ) {
          await releaseAiProfileFunds({
            reservationId: mediaJob.ai_balance_reservation_id,
            metadata: {
              reason: "direct-media-provider-failed",
              jobId: mediaJob.id,
            },
          }).catch(() => undefined);
        }

        const requestedAdultClass = adultMediaContentClass(mediaJob.prompt);
        const refusalOrigin = mediaPolicyRefusalOrigin(
          direct.error,
          requestedAdultClass,
        );

        if (refusalOrigin === "provider") {
          await recordMediaRuntimePolicyRefusal({
            ownerRef,
            provider: mediaJob.provider,
            model: mediaJob.model,
            endpoint: null,
            sourceJobId: mediaJob.id,
            requestedClass: requestedAdultClass,
            detail: direct.error,
          }).catch((error) =>
            console.error("Could not persist direct provider refusal", {
              jobId: mediaJob.id,
              detail:
                error instanceof Error ? error.message.slice(0, 800) : "unknown",
            }),
          );
        }

        await admin
          .from("media_generation_jobs")
          .update({
            status: "failed",
            usage: direct.usage,
            error: direct.error.slice(0, 1200),
            ai_balance_reservation_id: null,
            actual_user_charge_microusd: 0,
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", mediaJob.id)
          .eq("owner_ref", ownerRef)
          .eq("status", "running");

        if (refusalOrigin === "provider") {
          const fallback = await queueNextDirectOpenRouterImageFallback({
            ownerRef,
            userId: owner.userId,
            sourceJob: mediaJob,
            requestedClass: requestedAdultClass,
          });

          if (
            fallback.kind === "queued" ||
            fallback.kind === "already-active"
          ) {
            return NextResponse.json(
              {
                jobId: fallback.jobId,
                execution: "media",
                status: "queued",
                conversationId: mediaJob.conversation_id,
                capability: "image",
                provider: "openrouter",
                model: fallback.model,
                routeReason:
                  "The image provider refused this request class. CoOperative recorded the exact route as blocked for that scope and queued the next eligible direct image model within the remaining request budget.",
                estimatedProviderCostUsd:
                  fallback.kind === "queued"
                    ? fallback.estimatedProviderCostUsd
                    : null,
                quotedUserPriceUsd:
                  fallback.kind === "queued"
                    ? fallback.quotedUserPriceUsd
                    : null,
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          }

          if (fallback.kind === "funding-required") {
            const assistantText =
              `The last image provider refused this request class. I recorded that route as blocked, but the next eligible direct image route needs more CoOperative AI balance. Shortfall: $${fallback.shortfallUsd.toFixed(4)}.`;
            if (mediaJob.conversation_id) {
              await admin.from("local_ai_messages").insert({
                conversation_id: mediaJob.conversation_id,
                owner_ref: ownerRef,
                role: "assistant",
                content: assistantText,
                attachment_ids: [],
                job_id: null,
              });
            }
            return NextResponse.json(
              {
                jobId: mediaJob.id,
                execution: "code",
                status: "completed",
                conversationId: mediaJob.conversation_id,
                capability: "image",
                provider: "code",
                model: "direct-media-funding-gate",
                text: assistantText,
                routeReason:
                  "The proven-refusal route was excluded, but the next eligible direct image model could not be funded inside the current profile balance.",
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          }

          const assistantText =
            "The selected image provider refused this request class, and no other currently eligible direct image route remains inside the approved budget and reference requirements.";
          if (mediaJob.conversation_id) {
            await admin.from("local_ai_messages").insert({
              conversation_id: mediaJob.conversation_id,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            });
          }
          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "code",
              status: "completed",
              conversationId: mediaJob.conversation_id,
              capability: "image",
              provider: "code",
              model: "direct-media-no-eligible-route",
              text: assistantText,
              routeReason:
                "CoOperative learned the provider refusal and exhausted the remaining eligible direct image routes without starting Recovery Agent.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const safeTechnicalReroute =
          direct.failureStage === "provider-response" &&
          [404, 408, 409, 422, 424, 500, 502, 503, 504].includes(
            direct.status,
          );

        const [recovery, technicalFallback] = await Promise.all([
          startRecoveryForJob(ownerRef, mediaJob.id).catch((error) => {
            console.error("Could not start technical media recovery", {
              jobId: mediaJob.id,
              detail:
                error instanceof Error ? error.message.slice(0, 800) : "unknown",
            });
            return null;
          }),
          safeTechnicalReroute
            ? queueNextDirectOpenRouterImageFallback({
                ownerRef,
                userId: owner.userId,
                sourceJob: mediaJob,
                requestedClass: requestedAdultClass,
              }).catch((error) => {
                console.error("Could not queue technical media fallback", {
                  jobId: mediaJob.id,
                  detail:
                    error instanceof Error
                      ? error.message.slice(0, 800)
                      : "unknown",
                });
                return { kind: "none" as const };
              })
            : Promise.resolve({ kind: "none" as const }),
        ]);

        if (
          technicalFallback.kind === "queued" ||
          technicalFallback.kind === "already-active"
        ) {
          return NextResponse.json(
            {
              jobId: technicalFallback.jobId,
              execution: "media",
              status: "queued",
              conversationId: mediaJob.conversation_id,
              capability: "image",
              provider: "openrouter",
              model: technicalFallback.model,
              recoveryIncidentId: recovery?.id || null,
              routeReason:
                "The provider returned a definite technical failure that is safe to route around. Recovery Agent is diagnosing the failed route in parallel while the request ledger moved execution to the next eligible image model without permitting duplicate active attempts.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const assistantText =
          direct.failureStage === "transport-uncertain" ||
          direct.failureStage === "post-provider"
            ? "The image route hit a technical failure after provider execution may have started or completed. Recovery Agent is investigating in the background, and CoOperative did not launch another paid generation because that could duplicate spend."
            : "The image route hit a technical failure. Recovery Agent is diagnosing it in the background; no safe automatic provider fallback was available for this failure.";

        return NextResponse.json(
          {
            jobId: mediaJob.id,
            execution: "code",
            status: "completed",
            conversationId: mediaJob.conversation_id,
            capability: "image",
            provider: "recovery",
            model: "parallel-media-recovery",
            text: assistantText,
            recoveryIncidentId: recovery?.id || null,
            routeReason:
              "Recovery and routing are independent: technical diagnosis continues in the background, while automatic rerouting occurs only when the provider response proves a second attempt will not create an uncertain duplicate charge.",
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (
        mediaJob.status === "running" &&
        mediaJob.sandbox_name &&
        mediaJob.deadline_at
      ) {
        const polled = await pollHermesMediaTask({
          sandboxName: mediaJob.sandbox_name,
          deadlineAt: mediaJob.deadline_at,
        });

        if (polled.state === "running") {
          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "running",
              conversationId: mediaJob.conversation_id,
              capability: mediaJob.kind,
              provider: mediaJob.provider,
              model: mediaJob.model,
              routeReason: "Hermes media generation is still running in Vercel Sandbox.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        if (polled.state === "completed" && polled.mediaUrl) {
          const marker =
            mediaJob.kind === "video" ? "MEDIA_VIDEO:" : "MEDIA_IMAGE:";
          const resultText =
            `Generated ${mediaJob.kind} with ${mediaJob.model}.\n${marker}${polled.mediaUrl}`;
          const completedAt = new Date().toISOString();

          const { data: claimed, error: claimError } = await admin
            .from("media_generation_jobs")
            .update({
              status: "completed",
              result_url: polled.mediaUrl,
              result_text: resultText,
              usage: polled.usage,
              error: null,
              completed_at: completedAt,
              updated_at: completedAt,
            })
            .eq("id", mediaJob.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running")
            .select("id")
            .maybeSingle();
          if (claimError) throw claimError;

          let billedMicrousd: number | null = null;
          if (
            claimed &&
            mediaJob.billing_mode === "cooperative-balance" &&
            mediaJob.ai_balance_reservation_id
          ) {
            const quotedChargeMicrousd = Math.max(
              0,
              Number(mediaJob.estimated_user_charge_microusd || 0),
            );
            try {
              await settleAiProfileFunds({
                reservationId: mediaJob.ai_balance_reservation_id,
                actualCostUsd: quotedChargeMicrousd / 1_000_000,
                metadata: {
                  jobId: mediaJob.id,
                  outcome: "completed",
                  provider: mediaJob.provider,
                  model: mediaJob.model,
                  kind: mediaJob.kind,
                },
              });
              billedMicrousd = quotedChargeMicrousd;
              await admin
                .from("media_generation_jobs")
                .update({
                  billed_microusd: quotedChargeMicrousd,
                  actual_user_charge_microusd: quotedChargeMicrousd,
                  actual_provider_cost_microusd: Math.max(
                    0,
                    Number(mediaJob.estimated_provider_cost_microusd || 0),
                  ),
                  actual_margin_microusd: Math.max(
                    0,
                    quotedChargeMicrousd -
                      Math.max(
                        0,
                        Number(mediaJob.estimated_provider_cost_microusd || 0),
                      ),
                  ),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", mediaJob.id)
                .eq("owner_ref", ownerRef);
            } catch (billingError) {
              console.error("Could not settle completed paid media reservation", {
                jobId: mediaJob.id,
                detail:
                  billingError instanceof Error
                    ? billingError.message.slice(0, 800)
                    : "Unknown media billing error",
              });
            }
          }

          const referenceEditEndpoint =
            mediaJob.pricing_dimensions &&
            typeof mediaJob.pricing_dimensions === "object" &&
            !Array.isArray(mediaJob.pricing_dimensions)
              ? (mediaJob.pricing_dimensions as {
                  referenceEditEndpoint?: unknown;
                }).referenceEditEndpoint
              : null;
          if (
            claimed &&
            mediaJob.provider === "nous" &&
            typeof referenceEditEndpoint === "string" &&
            referenceEditEndpoint
          ) {
            await recordMediaReferenceModelVerification({
              ownerRef,
              provider: "nous",
              model: mediaJob.model,
              editEndpoint: referenceEditEndpoint,
              sourceJobId: mediaJob.id,
              success: true,
            });
          }

          if (claimed && mediaJob.conversation_id) {
            const { error: resultMessageError } = await admin
              .from("local_ai_messages")
              .insert({
                conversation_id: mediaJob.conversation_id,
                owner_ref: ownerRef,
                role: "assistant",
                content: resultText,
                attachment_ids: [],
                // This column references text_inference_jobs only. The media job remains
                // linked through media_generation_jobs.conversation_id.
                job_id: null,
              });
            if (resultMessageError) throw resultMessageError;

            await admin
              .from("local_ai_conversations")
              .update({ updated_at: completedAt })
              .eq("id", mediaJob.conversation_id)
              .eq("owner_ref", ownerRef);
          }

          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "media",
              status: "completed",
              conversationId: mediaJob.conversation_id,
              capability: mediaJob.kind,
              provider: mediaJob.provider,
              model: mediaJob.model,
              text: resultText,
              mediaUrl: polled.mediaUrl,
              funding:
                billedMicrousd !== null
                  ? {
                      chargedUsd: billedMicrousd / 1_000_000,
                    }
                  : null,
              routeReason:
                mediaJob.pricing_dimensions &&
                typeof mediaJob.pricing_dimensions === "object" &&
                !Array.isArray(mediaJob.pricing_dimensions) &&
                (mediaJob.pricing_dimensions as { referenceSmokeTest?: unknown })
                  .referenceSmokeTest === true
                  ? `The explicitly approved one-shot reference smoke test succeeded. This recorded job verifies that ${String(
                      (mediaJob.pricing_dimensions as { referenceEditEndpoint?: unknown })
                        .referenceEditEndpoint ||
                        mediaJob.model,
                    )} accepted the reference-image request through the connected Nous/Hermes path.`
                  : "Cheap/free Hermes orchestration completed one configured media generation call.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        const failure = polled.error || "Hermes media generation failed.";
        const completedAt = new Date().toISOString();

        if (
          mediaJob.billing_mode === "cooperative-balance" &&
          mediaJob.ai_balance_reservation_id
        ) {
          try {
            await releaseAiProfileFunds({
              reservationId: mediaJob.ai_balance_reservation_id,
              metadata: {
                jobId: mediaJob.id,
                outcome: "failed",
                provider: mediaJob.provider,
                model: mediaJob.model,
                kind: mediaJob.kind,
              },
            });
            await admin
              .from("media_generation_jobs")
              .update({
                ai_balance_reservation_id: null,
                billed_microusd: 0,
                actual_user_charge_microusd: 0,
                updated_at: completedAt,
              })
              .eq("id", mediaJob.id)
              .eq("owner_ref", ownerRef);
          } catch (billingError) {
            console.error("Could not release failed paid media reservation", {
              jobId: mediaJob.id,
              detail:
                billingError instanceof Error
                  ? billingError.message.slice(0, 800)
                  : "Unknown media billing error",
            });
          }
        }

        const referencePricingDimensions =
          mediaJob.pricing_dimensions &&
          typeof mediaJob.pricing_dimensions === "object" &&
          !Array.isArray(mediaJob.pricing_dimensions)
            ? (mediaJob.pricing_dimensions as {
                referenceSmokeTest?: unknown;
                referenceVerifiedRoute?: unknown;
                referenceEditEndpoint?: unknown;
                referenceAttachmentIds?: unknown;
              })
            : null;
        const referenceSmokeTest =
          referencePricingDimensions?.referenceSmokeTest === true;
        const referenceVerifiedRoute =
          referencePricingDimensions?.referenceVerifiedRoute === true;
        const referenceRoute = referenceSmokeTest || referenceVerifiedRoute;
        const requestedAdultClass = adultMediaContentClass(
          String(mediaJob.prompt || ""),
        );
        const referenceEditEndpoint =
          typeof referencePricingDimensions?.referenceEditEndpoint === "string"
            ? referencePricingDimensions.referenceEditEndpoint
            : null;
        const policyRefusal = mediaPolicyRefusalDetected(
          failure,
          requestedAdultClass,
        );
        const policyRefusalOrigin = mediaPolicyRefusalOrigin(
          failure,
          requestedAdultClass,
        );

        if (policyRefusal) {
          try {
            await recordMediaRuntimePolicyRefusal({
              ownerRef,
              provider: mediaJob.provider,
              model: mediaJob.model,
              endpoint: referenceEditEndpoint,
              sourceJobId: mediaJob.id,
              requestedClass: requestedAdultClass,
              detail: failure,
            });
          } catch (refusalEvidenceError) {
            console.error("Could not persist learned media policy refusal", {
              jobId: mediaJob.id,
              provider: mediaJob.provider,
              model: mediaJob.model,
              detail:
                refusalEvidenceError instanceof Error
                  ? refusalEvidenceError.message.slice(0, 800)
                  : "Unknown refusal-evidence error",
            });
          }
        }

        if (policyRefusalOrigin === "orchestrator") {
          await admin
            .from("media_generation_jobs")
            .update({
              status: "failed",
              usage: polled.usage,
              error: failure.slice(0, 1200),
              completed_at: completedAt,
              updated_at: completedAt,
            })
            .eq("id", mediaJob.id)
            .eq("owner_ref", ownerRef)
            .eq("status", "running");

          const assistantText =
            "The current media executor stopped this request before the selected image model was actually called. CoOperative did not mark that model as a proven blocker and did not keep cycling through additional models under the same executor path.";

          if (mediaJob.conversation_id) {
            await admin.from("local_ai_messages").insert({
              conversation_id: mediaJob.conversation_id,
              owner_ref: ownerRef,
              role: "assistant",
              content: assistantText,
              attachment_ids: [],
              job_id: null,
            });
          }

          return NextResponse.json(
            {
              jobId: mediaJob.id,
              execution: "code",
              status: "completed",
              conversationId: mediaJob.conversation_id,
              capability: mediaJob.kind,
              provider: "code",
              model: "media-executor-policy-boundary",
              text: assistantText,
              routeReason:
                "The orchestration layer refused before provider invocation. No provider/model capability evidence was recorded, no Recovery Agent was started, and no further same-executor model retries were attempted.",
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        if (referenceRoute) {
          if (
            !policyRefusal &&
            mediaJob.provider === "nous" &&
            referenceEditEndpoint
          ) {
            await recordMediaReferenceModelVerification({
              ownerRef,
              provider: "nous",
              model: mediaJob.model,
              editEndpoint: referenceEditEndpoint,
              sourceJobId: mediaJob.id,
              success: false,
              failureReason: failure,
            });
          }

          // Exact-route smoke tests remain one-shot. Normal verified reference
          // requests may continue only to another route that can preserve the
          // same reference image.
          if (referenceSmokeTest) {
            await admin
              .from("media_generation_jobs")
              .update({
                status: "failed",
                usage: polled.usage,
                error: failure.slice(0, 1200),
                completed_at: completedAt,
                updated_at: completedAt,
              })
              .eq("id", mediaJob.id)
              .eq("owner_ref", ownerRef)
              .eq("status", "running");

            return NextResponse.json(
              {
                jobId: mediaJob.id,
                execution: "media",
                status: "failed",
                conversationId: mediaJob.conversation_id,
                capability: mediaJob.kind,
                provider: mediaJob.provider,
                model: mediaJob.model,
                error: failure,
                routeReason:
                  "The one-shot premium reference smoke test failed. The exact endpoint and failure are recorded on this job; CoOperative did not retry or fall back automatically.",
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
        }

        if (mediaJob.provider === "nous" || policyRefusal) {
          const referenceAttachmentIds =
            Array.isArray(referencePricingDimensions?.referenceAttachmentIds)
              ? (referencePricingDimensions.referenceAttachmentIds as unknown[])
                  .filter(
                    (value): value is string =>
                      typeof value === "string" && value.length > 0,
                  )
                  .slice(0, 16)
              : [];
          const mustPreserveReference = referenceAttachmentIds.length > 0;

          const requestCapUsd =
            typeof mediaJob.request_max_spend_microusd === "number"
              ? mediaJob.request_max_spend_microusd / 1_000_000
              : 0.05;
          const sourceEstimateUsd =
            typeof mediaJob.estimated_provider_cost_microusd === "number"
              ? mediaJob.estimated_provider_cost_microusd / 1_000_000
              : 0;
          // A failed paid call may still have partial provider cost. Reserve its
          // full estimate before considering another paid route.
          const remainingCapUsd = Math.max(0, requestCapUsd - sourceEstimateUsd);
          const mediaLevel = Math.min(
            4,
            Math.max(0, Number(mediaJob.media_level || 0)),
          ) as 0 | 1 | 2 | 3 | 4;
          const durationSeconds =
            mediaJob.kind === "video"
              ? Number(
                  String(mediaJob.prompt || "").match(
                    /Duration:\s*(\d+)\s*seconds?/i,
                  )?.[1] || 0,
                ) || null
              : null;
          const aspectRatio =
            String(mediaJob.prompt || "").match(
              /(?:Aspect ratio|Preferred aspect ratio):\s*(16:9|9:16|1:1)/i,
            )?.[1] || null;
          const controls = videoControlsFromPrompt(String(mediaJob.prompt || ""));

          // Nous -> owned local image before any paid OpenRouter fallback.
          if (mediaJob.kind === "image" && !mustPreserveReference) {
            const authorizedNodeIds = await activeNodeIds(admin, owner.userId);
            if (authorizedNodeIds.length > 0) {
              const { data: imageNodes } = await admin
                .from("unison_nodes")
                .select("id,state,capabilities,policy,last_seen_at")
                .in("id", authorizedNodeIds);
              const freshAfter = Date.now() - 90_000;
              const localAvailable = (imageNodes || []).some((node) => {
                const capabilities = Array.isArray(node.capabilities)
                  ? node.capabilities
                  : [];
                const policy =
                  node.policy && typeof node.policy === "object"
                    ? (node.policy as { allowImage?: unknown })
                    : {};
                const seenAt = Date.parse(node.last_seen_at || "");
                return (
                  capabilities.includes("image_generation") &&
                  policy.allowImage !== false &&
                  Number.isFinite(seenAt) &&
                  seenAt >= freshAfter &&
                  node.state !== "paused"
                );
              });

              if (localAvailable) {
                const fallbackLocalModel =
                  mediaLevel >= 2
                    ? "local-image-quality"
                    : "local-image-fast";
                const fallbackLocalGate = await evaluateMediaExecutionContentGate({
                  userId: owner.userId,
                  ownerRef,
                  provider: "cooperative-local",
                  model: fallbackLocalModel,
                  adultContentClass: adultMediaContentClass(
                    String(mediaJob.prompt || ""),
                  ),
                });
                if (!fallbackLocalGate.allowed) {
                  const gateFailure =
                    `${failure} Automatic local fallback was blocked at execution time: ${fallbackLocalGate.note}`;
                  await admin
                    .from("media_generation_jobs")
                    .update({
                      status: "failed",
                      usage: polled.usage,
                      error: gateFailure.slice(0, 1200),
                      completed_at: completedAt,
                      updated_at: completedAt,
                    })
                    .eq("id", mediaJob.id)
                    .eq("owner_ref", ownerRef)
                    .eq("status", "running");

                  return NextResponse.json(
                    {
                      jobId: mediaJob.id,
                      execution: "media",
                      status: "failed",
                      conversationId: mediaJob.conversation_id,
                      capability: mediaJob.kind,
                      provider: mediaJob.provider,
                      model: mediaJob.model,
                      error: gateFailure,
                      routeReason:
                        `Execution-time content gate blocked the owned/local fallback (${fallbackLocalGate.reason}).`,
                    },
                    { headers: { "Cache-Control": "no-store" } },
                  );
                }

                await admin
                  .from("media_generation_jobs")
                  .update({
                    status: "failed",
                    usage: polled.usage,
                    error: failure.slice(0, 1200),
                    completed_at: completedAt,
                    updated_at: completedAt,
                  })
                  .eq("id", mediaJob.id)
                  .eq("owner_ref", ownerRef)
                  .eq("status", "running");

                const localJobId = crypto.randomUUID();
                const { error: localJobError } = await admin
                  .from("inference_jobs")
                  .insert({
                    id: localJobId,
                    kind: "image",
                    status: "queued",
                    client_owner_ref: ownerRef,
                    prompt: mediaJob.prompt,
                    aspect_ratio: aspectRatio || "4:5",
                    profile: mediaLevel >= 2 ? "quality" : "fast",
                    variation_mode: "balanced",
                    seed:
                      Number.parseInt(
                        localJobId.replaceAll("-", "").slice(0, 8),
                        16,
                      ) % 2147483648,
                  });
                if (localJobError) throw localJobError;

                return NextResponse.json(
                  {
                    jobId: localJobId,
                    execution: "media",
                    status: "queued",
                    conversationId: mediaJob.conversation_id,
                    capability: "image",
                    provider: "cooperative-local",
                    model:
                      mediaLevel >= 2
                        ? "local-image-quality"
                        : "local-image-fast",
                    routeReason:
                      "Nous was attempted first and failed. CoOperative preserved the spend boundary and moved to a fresh owned image node before considering paid OpenRouter.",
                    estimatedProviderCostUsd: 0,
                  },
                  { headers: { "Cache-Control": "no-store" } },
                );
              }
            }
          }

          try {
            const blockedRouteKeys = await mediaKnownBlockedRouteKeys({
              ownerRef,
              requestedClass: requestedAdultClass,
            });
            const catalog = await openRouterMediaCatalog(true);
            const rawPool =
              mediaJob.kind === "video"
                ? catalog.video
                : mustPreserveReference
                  ? catalog.image.filter(
                      (model) =>
                        (model.minInputReferences ?? 0) > 0 ||
                        model.inputModalities.some(
                          (modality) => modality.toLowerCase() === "image",
                        ),
                    )
                  : catalog.image;
            const pool = rawPool.filter((model) => {
              const routeKey = ["openrouter", model.id, ""].join("|");
              const isCurrentRoute =
                mediaJob.provider === "openrouter" &&
                mediaJob.model === model.id;
              return !isCurrentRoute && !blockedRouteKeys.has(routeKey);
            });
            const requestShape = {
              durationSeconds,
              aspectRatio,
              resolution: controls.resolution,
              audio: controls.audio,
            };
            const freeBackup = recommendedForRequest(
              pool.filter((model) => model.free),
              0,
              requestShape,
            );
            const paidBackup =
              mediaLevel > 0
                ? recommendedForRequest(
                    pool.filter((model) => !model.free),
                    mediaLevel,
                    requestShape,
                  )
                : null;
            const backupModel = freeBackup || paidBackup;
            const backupEstimate = backupModel
              ? freeBackup
                ? 0
                : estimatedMediaProviderCostUsd(
                    backupModel,
                    durationSeconds,
                    controls.resolution,
                    controls.audio,
                  )
              : null;
            const freeRoute = Boolean(freeBackup);
            const backupSellQuote =
              !freeRoute &&
              backupEstimate !== null &&
              backupEstimate > 0
                ? paidAiPriceQuote(backupEstimate)
                : null;
            const backupUserQuoteUsd =
              backupSellQuote?.userQuoteUsd ?? backupEstimate;
            const affordable =
              backupModel &&
              backupEstimate !== null &&
              backupEstimate <= remainingCapUsd;

            if (affordable && backupModel) {
              const openRouterService =
                await businessOwnedServiceCredentialForOwner(
                  ownerRef,
                  "openrouter-api",
                );
              const userOwnedOpenRouterCredential =
                openRouterService?.credential?.trim() || undefined;
              const cooperativeOpenRouterCredential =
                process.env.OPENROUTER_API_KEY?.trim() || undefined;
              const usingOpenRouterByok = Boolean(userOwnedOpenRouterCredential);
              const openRouterCredential =
                userOwnedOpenRouterCredential ||
                cooperativeOpenRouterCredential ||
                undefined;
              const effectiveBackupUserQuoteUsd = freeRoute
                ? 0
                : usingOpenRouterByok
                  ? 0
                  : Number(backupUserQuoteUsd || 0);
              const effectiveBackupCapCostUsd = freeRoute
                ? 0
                : usingOpenRouterByok
                  ? backupEstimate
                  : Number(backupUserQuoteUsd || 0);

              if (
                openRouterCredential &&
                effectiveBackupCapCostUsd <= remainingCapUsd
              ) {
                if (!freeRoute) {
                  const spendStatus =
                    await openRouterKeySpendStatus(openRouterCredential);
                  const enoughCredits =
                    spendStatus.accountCreditsRemainingUsd === null ||
                    spendStatus.accountCreditsRemainingUsd >= backupEstimate;
                  const enoughLimit =
                    spendStatus.keyLimitRemainingUsd === null ||
                    spendStatus.keyLimitRemainingUsd >= backupEstimate;
                  if (
                    !spendStatus.paidEligible ||
                    !enoughCredits ||
                    !enoughLimit
                  ) {
                    throw new Error(
                      "OpenRouter paid backup is not currently spend-eligible.",
                    );
                  }
                }

                await admin
                  .from("media_generation_jobs")
                  .update({
                    status: "failed",
                    usage: polled.usage,
                    error: failure.slice(0, 1200),
                    completed_at: completedAt,
                    updated_at: completedAt,
                  })
                  .eq("id", mediaJob.id)
                  .eq("owner_ref", ownerRef)
                  .eq("status", "running");

                const backupContentGate = await evaluateMediaExecutionContentGate({
                  userId: owner.userId,
                  ownerRef,
                  provider: "openrouter",
                  model: backupModel.id,
                  adultContentClass: adultMediaContentClass(
                    String(mediaJob.prompt || ""),
                  ),
                });
                if (!backupContentGate.allowed) {
                  const gateFailure =
                    `${failure} OpenRouter fallback was blocked at execution time: ${backupContentGate.note}`;
                  await admin
                    .from("media_generation_jobs")
                    .update({
                      status: "failed",
                      usage: polled.usage,
                      error: gateFailure.slice(0, 1200),
                      completed_at: completedAt,
                      updated_at: completedAt,
                    })
                    .eq("id", mediaJob.id)
                    .eq("owner_ref", ownerRef)
                    .eq("status", "running");

                  return NextResponse.json(
                    {
                      jobId: mediaJob.id,
                      execution: "media",
                      status: "failed",
                      conversationId: mediaJob.conversation_id,
                      capability: mediaJob.kind,
                      provider: mediaJob.provider,
                      model: mediaJob.model,
                      error: gateFailure,
                      routeReason:
                        `Execution-time content gate blocked the OpenRouter fallback (${backupContentGate.reason}).`,
                    },
                    { headers: { "Cache-Control": "no-store" } },
                  );
                }

                const backupJobId = crypto.randomUUID();
                const { error: backupInsertError } = await admin
                  .from("media_generation_jobs")
                  .insert({
                    id: backupJobId,
                    status: "queued",
                    request_root_job_id: mediaJob.request_root_job_id,
                    route_attempt: Math.min(
                      50,
                      Math.max(1, Number(mediaJob.route_attempt || 1) + 1),
                    ),
                    execution_mode:
                      mediaJob.kind === "image" ? "direct-provider" : "hermes",
                    owner_ref: ownerRef,
                    conversation_id: mediaJob.conversation_id,
                    kind: mediaJob.kind,
                    prompt: mediaJob.prompt,
                    provider: "openrouter",
                    model: backupModel.id,
                    model_mixer: mediaJob.model_mixer || null,
                    request_max_spend_microusd: Math.round(
                      remainingCapUsd * 1_000_000,
                    ),
                    media_level: mediaLevel,
                    estimated_provider_cost_microusd: Math.round(
                      backupEstimate * 1_000_000,
                    ),
                    estimated_user_charge_microusd: Math.round(
                      effectiveBackupUserQuoteUsd * 1_000_000,
                    ),
                    estimated_infrastructure_cost_microusd: null,
                    estimated_margin_microusd:
                      freeRoute || usingOpenRouterByok
                        ? null
                        : Math.round(
                            Math.max(
                              0,
                              effectiveBackupUserQuoteUsd - backupEstimate,
                            ) * 1_000_000,
                          ),
                    billing_mode: freeRoute
                      ? null
                      : usingOpenRouterByok
                        ? "openrouter-byok"
                        : "cooperative-balance",
                    provider_cost_bearer: freeRoute
                      ? "free"
                      : usingOpenRouterByok
                        ? "user-connected"
                        : "cooperative",
                    pricing_dimensions: {
                      durationSeconds,
                      aspectRatio,
                      resolution: controls.resolution,
                      audio: controls.audio,
                      mediaLevel,
                      freeRoute,
                      referenceVerifiedRoute: mustPreserveReference,
                      referenceAttachmentCount: mustPreserveReference
                        ? referenceAttachmentIds.length
                        : 0,
                      referenceAttachmentIds: mustPreserveReference
                        ? referenceAttachmentIds
                        : [],
                      quotedUserPriceUsd: effectiveBackupUserQuoteUsd,
                      providerCostEstimateUsd: backupEstimate,
                      markupPercent:
                        freeRoute || usingOpenRouterByok
                          ? 0
                          : backupSellQuote?.markupPercent || 0,
                      openRouterBillingSource: freeRoute
                        ? "free"
                        : usingOpenRouterByok
                          ? "user-connected-byok"
                          : "cooperative-balance",
                      directProvider: mediaJob.kind === "image",
                    },
                    pricing_source: catalog.source,
                    fallback_from_job_id: mediaJob.id,
                  });
                if (backupInsertError) throw backupInsertError;

                let backupReservationId: string | null = null;
                if (!freeRoute && !usingOpenRouterByok) {
                  const quote = await fundingQuoteForUser({
                    userId: owner.userId,
                    estimatedCostUsd: Number(backupUserQuoteUsd || 0),
                    maxSpendUsd: remainingCapUsd,
                  });

                  if (!quote.sufficientBalance) {
                    const directive = fundingDirective({
                      kind: "media",
                      jobId: backupJobId,
                      quote,
                    });
                    const assistantText = [
                      `The free/local fallback routes were exhausted. The next paid ${mediaJob.kind} route has a quoted CoOperative price of ${Number(backupUserQuoteUsd || 0).toFixed(4)}.`,
                      `Your available CoOperative AI balance is ${quote.availableBalanceUsd.toFixed(4)}. The safe reservation requires ${quote.minimumRequiredBalanceUsd.toFixed(4)}, so you need ${quote.shortfallUsd.toFixed(4)} more.`,
                      quote.topUpOption
                        ? `The smallest configured Stripe top-up that covers it is ${quote.topUpOption.amountUsd.toFixed(2)}.`
                        : "No Stripe balance top-up option is currently configured.",
                      "I did not start the paid backup.",
                      "",
                      directive,
                    ].join("\n");

                    if (mediaJob.conversation_id) {
                      await admin.from("local_ai_messages").insert({
                        conversation_id: mediaJob.conversation_id,
                        owner_ref: ownerRef,
                        role: "assistant",
                        content: assistantText,
                        attachment_ids: [],
                        job_id: null,
                      });
                    }

                    return NextResponse.json(
                      {
                        status: "completed",
                        execution: "code",
                        capability: mediaJob.kind,
                        conversationId: mediaJob.conversation_id,
                        text: assistantText,
                        provider: "code",
                        model: "media-profile-balance-fallback-gate",
                        mediaFundingJobId: backupJobId,
                        fundingRequired: quote,
                      },
                      { headers: { "Cache-Control": "no-store" } },
                    );
                  }

                  const reservation = await reserveAiProfileFunds({
                    profileRef: cooperativeProfileRef(owner.userId),
                    estimatedCostUsd: Number(backupUserQuoteUsd || 0),
                    source: "media-generation",
                    referenceId: backupJobId,
                    metadata: {
                      provider: "openrouter",
                      model: backupModel.id,
                      kind: mediaJob.kind,
                      fallbackFromJobId: mediaJob.id,
                      quotedUserPriceUsd: backupUserQuoteUsd,
                      providerCostEstimateUsd: backupEstimate,
                      markupPercent: backupSellQuote?.markupPercent || 0,
                      estimatedMarginUsd:
                        Number(backupUserQuoteUsd || 0) - backupEstimate,
                    },
                  });
                  if (!reservation) {
                    throw new Error(
                      "Profile balance changed before the paid media fallback could be reserved.",
                    );
                  }
                  backupReservationId = reservation.id;

                  const { error: backupReservationError } = await admin
                    .from("media_generation_jobs")
                    .update({
                      ai_balance_reservation_id: reservation.id,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", backupJobId)
                    .eq("owner_ref", ownerRef)
                    .eq("status", "queued");
                  if (backupReservationError) {
                    await releaseAiProfileFunds({
                      reservationId: reservation.id,
                      metadata: {
                        reason: "media-fallback-reservation-link-failed",
                        jobId: backupJobId,
                      },
                    }).catch(() => undefined);
                    throw backupReservationError;
                  }
                }

                if (mediaJob.kind === "image") {
                  return NextResponse.json(
                    {
                      jobId: backupJobId,
                      execution: "media",
                      status: "queued",
                      conversationId: mediaJob.conversation_id,
                      capability: "image",
                      provider: "openrouter",
                      model: backupModel.id,
                      routeReason: policyRefusal
                        ? mustPreserveReference
                          ? "The previous provider/model refused this request class. CoOperative recorded that evidence, preserved the same reference attachment, and queued the next eligible image model for a direct OpenRouter call."
                          : "The previous provider/model refused this request class. CoOperative recorded that evidence and queued the next eligible image model for a direct OpenRouter call."
                        : "The previous provider route failed. CoOperative queued the next eligible OpenRouter image route for direct provider execution.",
                      estimatedProviderCostUsd: backupEstimate,
                      quotedUserPriceUsd: freeRoute
                        ? null
                        : effectiveBackupUserQuoteUsd,
                    },
                    { headers: { "Cache-Control": "no-store" } },
                  );
                }

                const backupReferenceExecution = mustPreserveReference
                  ? await createReferenceImageExecutionUrls({
                      ownerRef,
                      attachmentIds: referenceAttachmentIds,
                    })
                  : null;

                let started: Awaited<
                  ReturnType<typeof startHermesMediaTask>
                >;
                try {
                  started = await startHermesMediaTask({
                    jobId: backupJobId,
                    kind: mediaJob.kind,
                    userRequest: mediaJob.prompt,
                    provider: "openrouter",
                    model: backupModel.id,
                    providerCredential: openRouterCredential,
                    orchestratorProvider: "openrouter",
                    orchestratorModel: "openrouter/free",
                    referenceImageUrls: backupReferenceExecution?.urls,
                  });
                } catch (backupStartFailure) {
                  if (backupReservationId) {
                    await releaseAiProfileFunds({
                      reservationId: backupReservationId,
                      metadata: {
                        reason: "paid-media-fallback-did-not-start",
                        jobId: backupJobId,
                      },
                    }).catch(() => undefined);
                    await admin
                      .from("media_generation_jobs")
                      .update({
                        ai_balance_reservation_id: null,
                        actual_user_charge_microusd: 0,
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", backupJobId)
                      .eq("owner_ref", ownerRef);
                  }
                  throw backupStartFailure;
                }

                const { error: backupStartError } = await admin
                  .from("media_generation_jobs")
                  .update({
                    status: "running",
                    sandbox_name: started.sandboxName,
                    started_at: started.startedAt,
                    deadline_at: started.deadlineAt,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", backupJobId)
                  .eq("owner_ref", ownerRef);
                if (backupStartError) {
                  if (backupReservationId) {
                    await releaseAiProfileFunds({
                      reservationId: backupReservationId,
                      metadata: {
                        reason: "paid-media-fallback-state-update-failed",
                        jobId: backupJobId,
                      },
                    }).catch(() => undefined);
                    await admin
                      .from("media_generation_jobs")
                      .update({
                        status: "failed",
                        ai_balance_reservation_id: null,
                        actual_user_charge_microusd: 0,
                        error: backupStartError.message.slice(0, 1200),
                        completed_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", backupJobId)
                      .eq("owner_ref", ownerRef);
                  }
                  throw backupStartError;
                }

                return NextResponse.json(
                  {
                    jobId: backupJobId,
                    execution: "media",
                    status: "running",
                    conversationId: mediaJob.conversation_id,
                    capability: mediaJob.kind,
                    provider: "openrouter",
                    model: backupModel.id,
                    routeReason: policyRefusal
                      ? mustPreserveReference
                        ? "The previous route refused this content class. CoOperative recorded that refusal, preserved the same reference image, and started the next eligible OpenRouter route that is not already known to block this request class."
                        : "The previous route refused this content class. CoOperative recorded that refusal and started the next eligible OpenRouter route that is not already known to block this request class."
                      : freeRoute
                        ? "The previous provider route failed, and CoOperative selected a live free OpenRouter route before any paid backup."
                        : "The previous provider route failed. CoOperative verified OpenRouter capacity and started the next eligible backup within the remaining request cap.",
                    estimatedProviderCostUsd: backupEstimate,
                    quotedUserPriceUsd: freeRoute
                      ? null
                      : effectiveBackupUserQuoteUsd,
                  },
                  { headers: { "Cache-Control": "no-store" } },
                );
              }
            }
          } catch (backupError) {
            console.error("Nous media fallback could not start", {
              sourceJobId: mediaJob.id,
              detail:
                backupError instanceof Error
                  ? backupError.message.slice(0, 800)
                  : "Unknown fallback error",
            });
          }
        }

        await admin
          .from("media_generation_jobs")
          .update({
            status: "failed",
            usage: polled.usage,
            error: failure.slice(0, 1200),
            completed_at: completedAt,
            updated_at: completedAt,
          })
          .eq("id", mediaJob.id)
          .eq("owner_ref", ownerRef)
          .eq("status", "running");

        return NextResponse.json(
          {
            jobId: mediaJob.id,
            execution: "media",
            status: "failed",
            conversationId: mediaJob.conversation_id,
            capability: mediaJob.kind,
            provider: mediaJob.provider,
            model: mediaJob.model,
            error: failure,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      return NextResponse.json(
        {
          jobId: mediaJob.id,
          execution: "media",
          status: mediaJob.status,
          conversationId: mediaJob.conversation_id,
          capability: mediaJob.kind,
          provider: mediaJob.provider,
          model: mediaJob.model,
          text: mediaJob.result_text,
          mediaUrl: mediaJob.result_url,
          error: mediaJob.error,
          createdAt: mediaJob.created_at,
          completedAt: mediaJob.completed_at,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      {
        jobId: job.id,
        execution:
          job.worker_id === FREE_VISION_WORKER_ID
            ? "free-cloud-vision"
            : job.worker_id === FREE_TEXT_WORKER_ID
              ? "free-cloud-text"
              : job.worker_id === "cooperative-paid-router"
                ? "paid-ai"
                : "local-ai",
        status: job.status,
        profile: job.profile,
        conversationId: job.conversation_id,
        capability: job.capability,
        attachmentIds: job.attachment_ids,
        messages: job.messages,
        partialText: job.partial_text,
        text: job.result_text,
        model: job.result_model,
        provider: job.result_provider,
        promptTokens: job.prompt_tokens,
        outputTokens: job.output_tokens,
        firstTokenMs: job.first_token_ms,
        latencyMs: job.latency_ms,
        workerId: job.worker_id,
        routingPreference: job.routing_preference || "default",
        preferredNodeId: job.preferred_node_id,
        targetNodeId: job.target_node_id,
        routeReason: job.route_reason,
        paidFallbackAllowed: job.allow_paid_fallback === true,
        error: job.error,
        createdAt: job.created_at,
        completedAt: job.completed_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Could not read local AI chat job.";
    return NextResponse.json(
      { error: "Could not read local AI chat job.", detail: detail.slice(0, 800) },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
