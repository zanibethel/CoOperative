import "server-only";

import { businessSummariesForUser } from "@/lib/ai/business-context";
import { createAdminSupabaseClient } from "@/lib/supabase-admin";

type BusinessOption = {
  id: string;
  name: string;
};

export type BusinessScopeResolution = {
  handled: boolean;
  assistantText?: string;
  effectiveMessage: string;
  selectedBusinessId: string | null;
  selectedScope: "personal" | "business" | null;
  routeReason?: string;
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function explicitlyPersonal(message: string) {
  const value = message.toLowerCase();
  return (
    /\b(personal|personally|for me|my own|family|household|home|not (?:for )?(?:work|business))\b/.test(
      value,
    ) ||
    /\bthis is personal\b/.test(value)
  );
}

function explicitlyBusiness(message: string) {
  const value = message.toLowerCase();
  return /\b(for|about|related to)\s+(?:my|the|our)\s+(?:business|company|work)\b|\bwork[- ]related\b/.test(
    value,
  );
}

function needsScope(message: string) {
  const value = message.toLowerCase();
  const taskVerb =
    /\b(create|make|design|generate|write|draft|plan|schedule|send|post|publish|build|update|edit|review|prepare|organize|promote|advertise|announce|invite)\b/.test(
      value,
    );
  const scopeSensitiveObject =
    /\b(image|graphic|flyer|poster|invite|invitation|event|post|social|email|message|announcement|campaign|ad|advertisement|logo|website|web page|video|presentation|document|proposal|quote|invoice|schedule|calendar|booking|customer|client|promotion|newsletter|form|content|meeting|launch|sale|offer)\b/.test(
      value,
    );

  return taskVerb && scopeSensitiveObject;
}

function looksLikeAnotherRequest(message: string) {
  const value = message.trim();
  if (!value) return false;
  return /^(?:can|could|would|please|help|create|make|write|generate|find|show|tell|what|why|how|when|where|who|is|are|do|does|fix|build|update|change|compare|research|look up|check|review|explain|draft|plan|design)\b/i.test(
    value,
  );
}

function businessMention(message: string, businesses: BusinessOption[]) {
  const lower = message.toLowerCase();
  return businesses.find((business) =>
    lower.includes(business.name.toLowerCase()),
  ) || null;
}

function numberedBusinessSelection(
  message: string,
  businesses: BusinessOption[],
) {
  const match = message.trim().match(/^(?:business\s*)?(\d+)\b/i);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 && index < businesses.length ? businesses[index] : null;
}

function scopeQuestion(businesses: BusinessOption[]) {
  return [
    "Sure — before I build that, should I treat this as **personal** or connect it to one of your businesses?",
    "",
    "0. Personal",
    ...businesses.map((business, index) => `${index + 1}. ${business.name}`),
    "",
    "You can answer with “personal,” a business name, or its number. I’ll use that context for the request and for any durable facts we save from the conversation.",
  ].join("\n");
}

async function conversationBusiness(
  ownerRef: string,
  conversationId: string,
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("local_ai_conversations")
    .select("business_id")
    .eq("id", conversationId)
    .eq("owner_ref", ownerRef)
    .maybeSingle();
  if (error) throw error;
  return data?.business_id || null;
}

async function saveConversationBusiness(input: {
  ownerRef: string;
  conversationId: string;
  businessId: string | null;
}) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("local_ai_conversations")
    .update({
      business_id: input.businessId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId)
    .eq("owner_ref", input.ownerRef);
  if (error) throw error;
}

async function pendingClarification(
  ownerRef: string,
  conversationId: string,
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cooperative_context_clarifications")
    .select("id,original_message,options,created_at")
    .eq("owner_ref", ownerRef)
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .eq("clarification_type", "business_scope")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolvePending(input: {
  clarificationId: string;
  ownerRef: string;
  conversationId: string;
  scope: "personal" | "business";
  businessId: string | null;
}) {
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("cooperative_context_clarifications")
    .update({
      status: "resolved",
      resolved_scope: input.scope,
      resolved_business_id: input.businessId,
      resolved_at: now,
    })
    .eq("id", input.clarificationId)
    .eq("owner_ref", input.ownerRef);
  if (error) throw error;

  await saveConversationBusiness({
    ownerRef: input.ownerRef,
    conversationId: input.conversationId,
    businessId: input.scope === "business" ? input.businessId : null,
  });
}

async function dismissPending(
  ownerRef: string,
  clarificationId: string,
) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("cooperative_context_clarifications")
    .update({
      status: "dismissed",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", clarificationId)
    .eq("owner_ref", ownerRef);
  if (error) throw error;
}

export async function resolveBusinessScopeForChat(input: {
  userId: string;
  ownerRef: string;
  conversationId: string;
  message: string;
  requestedBusinessId?: string | null;
}): Promise<BusinessScopeResolution> {
  const originalTurn = input.message.trim();
  const summaries = await businessSummariesForUser(input.userId);
  const businesses: BusinessOption[] = summaries.map((business) => ({
    id: business.id,
    name: business.name,
  }));

  const pending = await pendingClarification(
    input.ownerRef,
    input.conversationId,
  );

  if (pending) {
    const options = Array.isArray(pending.options)
      ? (pending.options as Array<{ id?: unknown; name?: unknown }>)
          .filter(
            (option) =>
              typeof option.id === "string" && typeof option.name === "string",
          )
          .map((option) => ({
            id: option.id as string,
            name: option.name as string,
          }))
      : businesses;

    if (
      explicitlyPersonal(originalTurn) ||
      /^(?:0|personal|personal event|personal request)\.?$/i.test(originalTurn)
    ) {
      await resolvePending({
        clarificationId: pending.id,
        ownerRef: input.ownerRef,
        conversationId: input.conversationId,
        scope: "personal",
        businessId: null,
      });
      return {
        handled: false,
        effectiveMessage: `${pending.original_message}\n\nResolved context: personal.`,
        selectedBusinessId: null,
        selectedScope: "personal",
        routeReason:
          "Resolved the pending scope clarification as personal and resumed the original request.",
      };
    }

    const selected =
      numberedBusinessSelection(originalTurn, options) ||
      businessMention(originalTurn, options);

    if (selected) {
      await resolvePending({
        clarificationId: pending.id,
        ownerRef: input.ownerRef,
        conversationId: input.conversationId,
        scope: "business",
        businessId: selected.id,
      });
      return {
        handled: false,
        effectiveMessage: `${pending.original_message}\n\nResolved business context: ${selected.name}.`,
        selectedBusinessId: selected.id,
        selectedScope: "business",
        routeReason:
          "Resolved the pending scope clarification to a saved business and resumed the original request.",
      };
    }

    if (looksLikeAnotherRequest(originalTurn)) {
      await dismissPending(input.ownerRef, pending.id);
      return {
        handled: false,
        effectiveMessage: originalTurn,
        selectedBusinessId:
          input.requestedBusinessId === undefined
            ? await conversationBusiness(input.ownerRef, input.conversationId)
            : input.requestedBusinessId,
        selectedScope: null,
        routeReason:
          "The user moved to a different request, so the pending scope clarification was dismissed without blocking chat.",
      };
    }

    return {
      handled: true,
      assistantText: scopeQuestion(options),
      effectiveMessage: originalTurn,
      selectedBusinessId: null,
      selectedScope: null,
      routeReason:
        "The scope clarification reply was ambiguous, so CoOperative asked again rather than guessing.",
    };
  }

  const requestedBusinessId =
    input.requestedBusinessId === undefined
      ? await conversationBusiness(input.ownerRef, input.conversationId)
      : input.requestedBusinessId;

  if (requestedBusinessId) {
    const owned = businesses.find(
      (business) => business.id === requestedBusinessId,
    );
    if (owned) {
      await saveConversationBusiness({
        ownerRef: input.ownerRef,
        conversationId: input.conversationId,
        businessId: owned.id,
      });
      return {
        handled: false,
        effectiveMessage: originalTurn,
        selectedBusinessId: owned.id,
        selectedScope: "business",
      };
    }
  }

  if (!businesses.length) {
    return {
      handled: false,
      effectiveMessage: originalTurn,
      selectedBusinessId: null,
      selectedScope: null,
    };
  }

  const mentioned = businessMention(originalTurn, businesses);
  if (mentioned) {
    await saveConversationBusiness({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      businessId: mentioned.id,
    });
    return {
      handled: false,
      effectiveMessage: originalTurn,
      selectedBusinessId: mentioned.id,
      selectedScope: "business",
      routeReason:
        "The request explicitly named a saved business, so CoOperative selected it without an extra question.",
    };
  }

  if (explicitlyPersonal(originalTurn)) {
    await saveConversationBusiness({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      businessId: null,
    });
    return {
      handled: false,
      effectiveMessage: originalTurn,
      selectedBusinessId: null,
      selectedScope: "personal",
    };
  }

  if (!needsScope(originalTurn)) {
    return {
      handled: false,
      effectiveMessage: originalTurn,
      selectedBusinessId: null,
      selectedScope: null,
    };
  }

  if (businesses.length === 1 && explicitlyBusiness(originalTurn)) {
    await saveConversationBusiness({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      businessId: businesses[0].id,
    });
    return {
      handled: false,
      effectiveMessage: originalTurn,
      selectedBusinessId: businesses[0].id,
      selectedScope: "business",
      routeReason:
        "The request explicitly said it was business-related and the user has one saved business.",
    };
  }

  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("cooperative_context_clarifications")
    .insert({
      owner_ref: input.ownerRef,
      conversation_id: input.conversationId,
      original_message: originalTurn,
      clarification_type: "business_scope",
      options: businesses,
      status: "pending",
    });
  if (error) throw error;

  return {
    handled: true,
    assistantText: scopeQuestion(businesses),
    effectiveMessage: originalTurn,
    selectedBusinessId: null,
    selectedScope: null,
    routeReason:
      "The request could reasonably be personal or business-related, so CoOperative asked for scope before generating the output.",
  };
}
