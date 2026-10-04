import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import {
  businessIntakeBatchForUser,
  createBusinessFromOnboarding,
  ownedBusinessesForOnboarding,
  saveBusinessIntakeBatch,
  type BusinessIntakeBatchAnswer,
} from "@/lib/runtime/business-intake";

export type ProfileFieldStatus = "known" | "unknown" | "deferred";
export type OnboardingMode = "choose" | "personal" | "business";
export type OnboardingPhase =
  | "choose_mode"
  | "personal"
  | "business_select"
  | "business_setup"
  | "business_intake";

export type UserProfileFieldDefinition = {
  key: string;
  category: string;
  label: string;
  question: string;
};

export const USER_PROFILE_FIELD_DEFINITIONS: UserProfileFieldDefinition[] = [
  {
    key: "preferred_name",
    category: "identity",
    label: "Preferred name",
    question: "What should I call you?",
  },
  {
    key: "primary_help",
    category: "goals",
    label: "Primary help",
    question: "What are the main things you want CoOperative to help you with?",
  },
  {
    key: "response_style",
    category: "preferences",
    label: "Response style",
    question:
      "How do you like answers: short/direct, detailed, options to compare, step-by-step, or something else?",
  },
  {
    key: "current_work_projects",
    category: "work",
    label: "Current work and projects",
    question: "What work, businesses, projects, or roles matter most to you right now?",
  },
  {
    key: "near_term_goals",
    category: "goals",
    label: "Near-term goals",
    question: "What goals should I keep in mind over the next few months?",
  },
  {
    key: "tradeoff_priorities",
    category: "preferences",
    label: "Tradeoff priorities",
    question:
      "When there is a tradeoff, what matters most to you: speed, quality, privacy, cost, control, or a mix?",
  },
  {
    key: "recurring_workflows",
    category: "routines",
    label: "Recurring workflows",
    question: "Are there recurring routines or workflows you want me to help with?",
  },
  {
    key: "tools_services_devices",
    category: "tools",
    label: "Tools, services, and devices",
    question:
      "What tools, services, apps, or devices do you use often that I should account for?",
  },
  {
    key: "boundaries_and_permissions",
    category: "preferences",
    label: "Boundaries and permissions",
    question:
      "Are there things you want me to avoid, ask permission before doing, or never assume?",
  },
  {
    key: "important_context",
    category: "context",
    label: "Important people or context",
    question:
      "Are there people, teams, businesses, or other contexts that matter enough for me to remember? Share only what you want remembered.",
  },
  {
    key: "interests",
    category: "interests",
    label: "Interests",
    question: "What interests or topics do you enjoy or want more help with?",
  },
  {
    key: "anything_else",
    category: "context",
    label: "Anything else",
    question:
      "Anything else that would make CoOperative more useful to you or help it understand how you work?",
  },
];

const PERSONAL_BATCH_SIZE = 3;
const TOTAL_PERSONAL_BATCHES = Math.ceil(
  USER_PROFILE_FIELD_DEFINITIONS.length / PERSONAL_BATCH_SIZE,
);

const BUSINESS_SETUP_QUESTIONS = [
  { key: "business_name", question: "What is the business name?" },
  { key: "industry", question: "What type of business is it?" },
  {
    key: "team_size",
    question: "About how many people are on the team, including you?",
  },
] as const;

type SessionRow = {
  status: "not_started" | "in_progress" | "paused" | "completed" | "dismissed";
  current_batch: number;
  conversation_id: string | null;
  mode: OnboardingMode;
  phase: OnboardingPhase;
  business_id: string | null;
  draft: Record<string, unknown> | null;
  last_question_keys: unknown;
  paused_reason: string | null;
};

export type ConversationalOnboardingResult = {
  handled: boolean;
  assistantText?: string;
  state: Awaited<ReturnType<typeof onboardingState>>;
  selectedBusinessId?: string | null;
  savedFacts?: string[];
  routeReason?: string;
};

function ownerUserId(ownerRef: string) {
  const match = /^coop-user:([0-9a-f-]{36})$/i.exec(ownerRef);
  return match?.[1] || null;
}

function personalBatchFields(batchIndex: number) {
  const safe = Math.max(0, Math.min(TOTAL_PERSONAL_BATCHES - 1, batchIndex));
  return USER_PROFILE_FIELD_DEFINITIONS.slice(
    safe * PERSONAL_BATCH_SIZE,
    safe * PERSONAL_BATCH_SIZE + PERSONAL_BATCH_SIZE,
  );
}

function choiceText() {
  return [
    "Before we get started, would you like to do a **Business intake** or a **Personal setup**?",
    "",
    "- **Business intake** helps me learn or set up a business, its workflows, tools, goals, costs, approvals, and AI/automation preferences.",
    "- **Personal setup** saves how you like to work, your response style, goals, recurring context, and useful history.",
    "",
    "Everything is optional. You can say **skip**, **later**, or just ask me something else. If you move on to another request, I’ll pause these questions and we can come back later. Useful details you explicitly give me in normal conversation can still fill missing fields over time.",
  ].join("\n");
}

function personalQuestionText(batchIndex = 0) {
  const questions = personalBatchFields(batchIndex);
  const intro =
    batchIndex === 0
      ? [
          "Personal setup it is. I’ll only ask a few at a time.",
          "You can answer with the numbers, say “skip” for anything you want left unknown, or “later” to defer it.",
          "",
        ]
      : [
          "Got it. Here are the next few. Skip or defer anything you do not want to answer yet.",
          "",
        ];

  return [
    ...intro,
    ...questions.map((field, index) => `${index + 1}. ${field.question}`),
  ].join("\n");
}

function businessSetupText() {
  return [
    "Let’s set up the business first. A few basics are enough to create the business profile:",
    "",
    ...BUSINESS_SETUP_QUESTIONS.map(
      (field, index) => `${index + 1}. ${field.question}`,
    ),
    "",
    "You can skip or defer any item. I need the business name before I can create its workspace; anything else can stay unknown and be filled later.",
  ].join("\n");
}

function businessSelectionText(
  businesses: Array<{ id: string; name: string; industry: string | null }>,
) {
  return [
    "Which business should I work on?",
    "",
    ...businesses.map(
      (business, index) =>
        `${index + 1}. ${business.name}${business.industry ? ` — ${business.industry}` : ""}`,
    ),
    `${businesses.length + 1}. Set up a new business`,
    "",
    "You can answer with the number or name.",
  ].join("\n");
}

function businessQuestionsText(
  businessName: string,
  questions: Array<{ key: string; question: string }>,
) {
  if (!questions.length) {
    return [
      `I already have the baseline intake for ${businessName}.`,
      "I’ll keep learning from normal conversation and only ask for missing business context when it matters to the task.",
    ].join("\n");
  }

  return [
    `Great — I’ll use **${businessName}**. Here are the next few business questions:`,
    "",
    ...questions.map((question, index) => `${index + 1}. ${question.question}`),
    "",
    "Answer any or all of them. “Skip” leaves a value unknown; “later” defers it. If you ask me something unrelated instead, I’ll pause intake and handle your request.",
  ].join("\n");
}

function completionText(mode: "personal" | "business") {
  return mode === "personal"
    ? [
        "That’s plenty to get started.",
        "I’ll keep learning your preferences naturally as we work together. Anything skipped stays unknown, and anything deferred stays for later until you explicitly provide it.",
      ].join("\n")
    : [
        "That’s enough baseline business context to get started.",
        "I’ll keep learning from normal work with this business. Missing values stay unknown until you provide them, and I can ask a clarifying question when a missing business detail actually matters to a request.",
      ].join("\n");
}

function pauseText(mode: OnboardingMode) {
  if (mode === "business") {
    return "No problem — I’ll pause business intake here. Everything already saved stays on the business profile, and we can continue later.";
  }
  if (mode === "personal") {
    return "No problem — I’ll pause personal setup here. Anything already saved stays available, and we can continue later.";
  }
  return "No problem — I’ll leave setup undecided for now. You can choose Business intake or Personal setup later.";
}

function answerValue(value: string) {
  const text = value.trim();
  if (
    /^(?:later|tell you later|i'?ll tell you later|not now|maybe later|defer)$/i.test(
      text,
    )
  ) {
    return { status: "deferred" as const, value: null };
  }
  if (
    /^(?:skip|unknown|don'?t know|do not know|n\/a|na|pass)$/i.test(text)
  ) {
    return { status: "unknown" as const, value: null };
  }
  return { status: "known" as const, value: text.slice(0, 3000) || null };
}

function numberedParts(message: string, maxIndex = 4) {
  const pattern = new RegExp(
    `(?:^|\\s)([1-${maxIndex}])\\s*[).:\\-]\\s*([\\s\\S]*?)(?=(?:\\s+[1-${maxIndex}]\\s*[).:\\-])|$)`,
    "g",
  );
  const matches = Array.from(message.trim().matchAll(pattern));
  const values = new Map<number, string>();
  for (const match of matches) {
    values.set(Number(match[1]), (match[2] || "").trim());
  }
  return values;
}

function looksLikeNewRequest(message: string) {
  const value = message.trim();
  if (!value) return false;
  if (/^[1-4]\s*[).:\-]/.test(value)) return false;
  if (/^(skip|later|pass|unknown|not sure|i'?ll tell you later)$/i.test(value)) {
    return false;
  }
  return /^(?:can|could|would|please|help|create|make|write|generate|find|show|tell|what|why|how|when|where|who|is|are|do|does|fix|build|update|change|compare|research|look up|check|review|explain|draft|plan|design)\b/i.test(
    value,
  );
}

function looksLikeBatchReply(message: string, fieldCount: number) {
  const value = message.trim();
  if (!value) return false;
  if (numberedParts(value, Math.max(1, Math.min(4, fieldCount))).size > 0) {
    return true;
  }
  if (/^(skip|later|pass|unknown|not sure|i'?ll tell you later)$/i.test(value)) {
    return true;
  }
  if (value.split(/\n+/).filter((line) => line.trim()).length >= 2) return true;
  return !looksLikeNewRequest(value);
}

function parseBatchReply(
  message: string,
  fields: ReadonlyArray<{ key: string }>,
): Array<{ fieldKey: string; status: ProfileFieldStatus; value: string | null }> {
  const normalized = message.trim();
  const numbered = numberedParts(normalized, Math.max(1, Math.min(4, fields.length)));

  if (numbered.size) {
    return fields.flatMap((field, index) => {
      const raw = numbered.get(index + 1);
      return raw === undefined
        ? []
        : [{ fieldKey: field.key, ...answerValue(raw) }];
    });
  }

  const lines = normalized
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return fields.flatMap((field, index) => {
      const raw = lines[index];
      return raw === undefined
        ? []
        : [{ fieldKey: field.key, ...answerValue(raw) }];
    });
  }

  if (fields.length) {
    return [{ fieldKey: fields[0].key, ...answerValue(normalized) }];
  }

  return [];
}

function parseMode(message: string): OnboardingMode | null {
  const value = message.toLowerCase().trim();
  if (/\b(personal|personal setup|profile|style|preferences?)\b/.test(value)) {
    return "personal";
  }
  if (/\b(business|business intake|company|work setup|business setup)\b/.test(value)) {
    return "business";
  }
  return null;
}

function parseTeamSize(value: string | null) {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/\b(\d{1,6})\b/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

async function updateSession(
  ownerRef: string,
  updates: Record<string, unknown>,
) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("cooperative_onboarding_sessions")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_ref", ownerRef);
  if (error) throw error;
}

async function saveConversationBusinessContext(input: {
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

async function insertConversationPair(input: {
  ownerRef: string;
  conversationId: string;
  userText: string;
  assistantText: string;
}) {
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("local_ai_messages").insert([
    {
      conversation_id: input.conversationId,
      owner_ref: input.ownerRef,
      role: "user",
      content: input.userText.trim(),
      attachment_ids: [],
      created_at: now,
    },
    {
      conversation_id: input.conversationId,
      owner_ref: input.ownerRef,
      role: "assistant",
      content: input.assistantText,
      attachment_ids: [],
      created_at: now,
    },
  ]);
  if (error) throw error;

  await admin
    .from("local_ai_conversations")
    .update({ updated_at: now })
    .eq("id", input.conversationId)
    .eq("owner_ref", input.ownerRef);
}

export async function ensureProfileFieldRows(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("cooperative_user_profile_fields").upsert(
    USER_PROFILE_FIELD_DEFINITIONS.map((field) => ({
      owner_ref: ownerRef,
      field_key: field.key,
      category: field.category,
      label: field.label,
      status: "unknown",
      source_kind: "onboarding",
    })),
    { onConflict: "owner_ref,field_key", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function onboardingState(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  await ensureProfileFieldRows(ownerRef);

  const [{ data: session, error: sessionError }, { data: fields, error: fieldsError }] =
    await Promise.all([
      admin
        .from("cooperative_onboarding_sessions")
        .select(
          "status,current_batch,conversation_id,mode,phase,business_id,draft,last_question_keys,paused_reason",
        )
        .eq("owner_ref", ownerRef)
        .maybeSingle(),
      admin
        .from("cooperative_user_profile_fields")
        .select("field_key,category,label,value_text,status,updated_at")
        .eq("owner_ref", ownerRef)
        .order("created_at", { ascending: true }),
    ]);

  if (sessionError) throw sessionError;
  if (fieldsError) throw fieldsError;

  const row = (session || null) as SessionRow | null;
  return {
    status: row?.status || "not_started",
    currentBatch: Number(row?.current_batch || 0),
    conversationId: row?.conversation_id || null,
    mode: row?.mode || ("choose" as OnboardingMode),
    phase: row?.phase || ("choose_mode" as OnboardingPhase),
    businessId: row?.business_id || null,
    draft: row?.draft || {},
    lastQuestionKeys: Array.isArray(row?.last_question_keys)
      ? row?.last_question_keys
      : [],
    pausedReason: row?.paused_reason || null,
    totalBatches: TOTAL_PERSONAL_BATCHES,
    fields: fields || [],
  };
}

export async function startOnboarding(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const state = await onboardingState(ownerRef);

  if (state.status === "in_progress" && state.conversationId) return state;
  if (state.status === "completed") return state;

  const now = new Date().toISOString();
  let conversationId = state.conversationId;

  if (!conversationId) {
    conversationId = crypto.randomUUID();
    const { error: conversationError } = await admin
      .from("local_ai_conversations")
      .insert({
        id: conversationId,
        owner_ref: ownerRef,
        title: "Getting to know you",
        profile: "fast",
        created_at: now,
        updated_at: now,
      });
    if (conversationError) throw conversationError;

    const { error: messageError } = await admin.from("local_ai_messages").insert({
      conversation_id: conversationId,
      owner_ref: ownerRef,
      role: "assistant",
      content: choiceText(),
      attachment_ids: [],
      created_at: now,
    });
    if (messageError) throw messageError;
  } else {
    const { error: messageError } = await admin.from("local_ai_messages").insert({
      conversation_id: conversationId,
      owner_ref: ownerRef,
      role: "assistant",
      content: choiceText(),
      attachment_ids: [],
      created_at: now,
    });
    if (messageError) throw messageError;
  }

  const { error: sessionError } = await admin
    .from("cooperative_onboarding_sessions")
    .upsert(
      {
        owner_ref: ownerRef,
        status: "in_progress",
        current_batch: 0,
        conversation_id: conversationId,
        mode: "choose",
        phase: "choose_mode",
        business_id: null,
        draft: {},
        last_question_keys: [],
        paused_reason: null,
        started_at: now,
        completed_at: null,
        dismissed_at: null,
        updated_at: now,
      },
      { onConflict: "owner_ref" },
    );
  if (sessionError) throw sessionError;

  return onboardingState(ownerRef);
}

async function savePersonalAnswers(input: {
  ownerRef: string;
  conversationId: string;
  messageId?: string | null;
  batchIndex: number;
  message: string;
}) {
  const admin = createAdminSupabaseClient();
  const fields = personalBatchFields(input.batchIndex);
  const answers = parseBatchReply(input.message, fields);
  const now = new Date().toISOString();
  const saved: string[] = [];

  for (const answer of answers) {
    const known = answer.status === "known" && Boolean(answer.value);

    const { data: existing, error: existingError } = await admin
      .from("cooperative_user_profile_fields")
      .select("first_known_at")
      .eq("owner_ref", input.ownerRef)
      .eq("field_key", answer.fieldKey)
      .maybeSingle();
    if (existingError) throw existingError;

    const { error } = await admin
      .from("cooperative_user_profile_fields")
      .update({
        value_text: known ? answer.value : null,
        status: known ? "known" : answer.status,
        confidence: 1,
        source_conversation_id: input.conversationId,
        source_message_id: input.messageId || null,
        source_kind: "onboarding",
        first_known_at: known ? existing?.first_known_at || now : null,
        last_confirmed_at: known ? now : null,
        updated_at: now,
      })
      .eq("owner_ref", input.ownerRef)
      .eq("field_key", answer.fieldKey);
    if (error) throw error;
    saved.push(answer.fieldKey);
  }

  return saved;
}

async function businessModePrompt(userId: string) {
  const { businesses } = await ownedBusinessesForOnboarding(userId);
  if (!businesses.length) {
    return {
      phase: "business_setup" as const,
      assistantText: businessSetupText(),
      lastQuestionKeys: BUSINESS_SETUP_QUESTIONS.map((item) => item.key),
    };
  }

  return {
    phase: "business_select" as const,
    assistantText: businessSelectionText(businesses),
    lastQuestionKeys: [],
  };
}

function matchBusinessSelection(
  message: string,
  businesses: Array<{ id: string; name: string; industry: string | null }>,
) {
  const value = message.trim();
  if (/\b(new|another|set up|setup|create)\b/i.test(value)) {
    return { kind: "new" as const };
  }

  const numberMatch = value.match(/^\s*(\d+)\s*$/);
  if (numberMatch) {
    const index = Number(numberMatch[1]) - 1;
    if (index === businesses.length) return { kind: "new" as const };
    if (index >= 0 && index < businesses.length) {
      return { kind: "existing" as const, business: businesses[index] };
    }
  }

  const lower = value.toLowerCase();
  const direct = businesses.find(
    (business) =>
      lower === business.name.toLowerCase() ||
      lower.includes(business.name.toLowerCase()),
  );
  return direct
    ? { kind: "existing" as const, business: direct }
    : null;
}

export async function handleConversationalOnboardingTurn(input: {
  userId: string;
  ownerRef: string;
  conversationId: string;
  message: string;
  hasAttachments?: boolean;
}): Promise<ConversationalOnboardingResult> {
  const state = await onboardingState(input.ownerRef);
  const text = input.message.trim();
  const lower = text.toLowerCase();

  const explicitResume =
    /\b(?:continue|resume|start|finish|return to)\b.{0,24}\b(?:onboarding|setup|profile|personal setup|business intake|business setup)\b/i.test(
      text,
    );

  if (state.status === "not_started") {
    return { handled: false, state };
  }

  if (state.status === "completed" && !explicitResume) {
    return { handled: false, state };
  }

  if (input.hasAttachments && state.status === "in_progress") {
    await updateSession(input.ownerRef, {
      status: "paused",
      paused_reason: "User moved to an attachment-based request.",
    });
    return {
      handled: false,
      state: await onboardingState(input.ownerRef),
      routeReason: "Onboarding paused because the user moved to another request.",
    };
  }

  if (explicitResume && state.status !== "in_progress") {
    let phase = state.phase;
    let mode = state.mode;

    if (/\bbusiness\b/i.test(text)) {
      mode = "business";
      phase = state.businessId ? "business_intake" : "business_select";
    } else if (/\bpersonal\b|\bprofile\b/i.test(text)) {
      mode = "personal";
      phase = "personal";
    } else if (mode === "choose") {
      phase = "choose_mode";
    }

    let assistantText = choiceText();
    let selectedBusinessId = state.businessId;

    if (mode === "personal") {
      assistantText = personalQuestionText(state.currentBatch || 0);
    } else if (mode === "business") {
      if (state.businessId) {
        const batch = await businessIntakeBatchForUser({
          userId: input.userId,
          businessId: state.businessId,
          limit: 3,
        });
        assistantText = batch.complete
          ? completionText("business")
          : businessQuestionsText(batch.business.name, batch.questions);
      } else {
        const prompt = await businessModePrompt(input.userId);
        phase = prompt.phase;
        assistantText = prompt.assistantText;
      }
    }

    await updateSession(input.ownerRef, {
      status: "in_progress",
      mode,
      phase,
      conversation_id: input.conversationId,
      paused_reason: null,
    });

    return {
      handled: true,
      assistantText,
      selectedBusinessId,
      state: await onboardingState(input.ownerRef),
      routeReason: "User explicitly resumed conversational onboarding.",
    };
  }

  if (state.status === "paused" || state.status === "dismissed") {
    return { handled: false, state };
  }

  if (
    /^(?:skip|pause|stop|later|not now)(?:\s+(?:onboarding|setup|intake))?\.?$/i.test(
      text,
    )
  ) {
    await updateSession(input.ownerRef, {
      status: "paused",
      paused_reason: "User deferred onboarding.",
    });
    const assistantText = pauseText(state.mode);
    return {
      handled: true,
      assistantText,
      state: await onboardingState(input.ownerRef),
      selectedBusinessId: state.businessId,
      routeReason: "User deferred onboarding without losing saved values.",
    };
  }

  if (state.phase === "choose_mode") {
    const explicitModePhrase =
      /\b(?:business intake|business setup|personal setup|personal profile)\b/i.test(
        text,
      );
    if (looksLikeNewRequest(text) && !explicitModePhrase) {
      await updateSession(input.ownerRef, {
        status: "paused",
        paused_reason:
          "User moved to another request before choosing an onboarding mode.",
      });
      return {
        handled: false,
        state: await onboardingState(input.ownerRef),
        routeReason:
          "Initial onboarding paused because the user made a normal request instead of choosing a setup flow.",
      };
    }

    const mode = parseMode(text);
    if (!mode) {
      await updateSession(input.ownerRef, {
        status: "paused",
        paused_reason: "User moved to an unrelated request before choosing an onboarding mode.",
      });
      return {
        handled: false,
        state: await onboardingState(input.ownerRef),
        routeReason:
          "Initial onboarding choice did not match personal/business, so setup paused and the request can continue normally.",
      };
    }

    if (mode === "personal") {
      const assistantText = personalQuestionText(0);
      await updateSession(input.ownerRef, {
        status: "in_progress",
        mode: "personal",
        phase: "personal",
        current_batch: 0,
        conversation_id: input.conversationId,
        last_question_keys: personalBatchFields(0).map((field) => field.key),
        paused_reason: null,
      });
      await saveConversationBusinessContext({
        ownerRef: input.ownerRef,
        conversationId: input.conversationId,
        businessId: null,
      });
      return {
        handled: true,
        assistantText,
        state: await onboardingState(input.ownerRef),
        routeReason: "User selected personal profile onboarding.",
      };
    }

    const prompt = await businessModePrompt(input.userId);
    await updateSession(input.ownerRef, {
      status: "in_progress",
      mode: "business",
      phase: prompt.phase,
      conversation_id: input.conversationId,
      last_question_keys: prompt.lastQuestionKeys,
      paused_reason: null,
    });
    return {
      handled: true,
      assistantText: prompt.assistantText,
      state: await onboardingState(input.ownerRef),
      routeReason: "User selected business onboarding.",
    };
  }

  if (state.phase === "personal") {
    const fields = personalBatchFields(state.currentBatch || 0);
    if (!looksLikeBatchReply(text, fields.length)) {
      await updateSession(input.ownerRef, {
        status: "paused",
        paused_reason: "User moved to another request during personal setup.",
      });
      return {
        handled: false,
        state: await onboardingState(input.ownerRef),
        routeReason:
          "Personal onboarding paused because the message looked like a new request instead of an answer.",
      };
    }

    const savedFacts = await savePersonalAnswers({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      batchIndex: state.currentBatch || 0,
      message: text,
    });

    const nextBatch = (state.currentBatch || 0) + 1;
    const completed = nextBatch >= TOTAL_PERSONAL_BATCHES;
    const assistantText = completed
      ? completionText("personal")
      : personalQuestionText(nextBatch);

    await updateSession(input.ownerRef, {
      status: completed ? "completed" : "in_progress",
      current_batch: completed ? TOTAL_PERSONAL_BATCHES : nextBatch,
      phase: "personal",
      completed_at: completed ? new Date().toISOString() : null,
      last_question_keys: completed
        ? []
        : personalBatchFields(nextBatch).map((field) => field.key),
      paused_reason: null,
    });

    return {
      handled: true,
      assistantText,
      savedFacts,
      state: await onboardingState(input.ownerRef),
      routeReason: completed
        ? "Personal onboarding baseline completed."
        : "Saved personal onboarding answers and advanced to the next small batch.",
    };
  }

  if (state.phase === "business_select") {
    const { businesses } = await ownedBusinessesForOnboarding(input.userId);
    const asksToCreateBusiness =
      /\b(?:create|set up|setup|add)\b.{0,20}\bnew business\b/i.test(text);

    if (looksLikeNewRequest(text) && !asksToCreateBusiness) {
      const mentionedBusiness = businesses.find((business) =>
        text.toLowerCase().includes(business.name.toLowerCase()),
      );

      if (mentionedBusiness) {
        await saveConversationBusinessContext({
          ownerRef: input.ownerRef,
          conversationId: input.conversationId,
          businessId: mentionedBusiness.id,
        });
      }

      await updateSession(input.ownerRef, {
        status: "paused",
        business_id: mentionedBusiness?.id || state.businessId || null,
        paused_reason:
          "User moved to another request during business selection.",
      });

      return {
        handled: false,
        selectedBusinessId: mentionedBusiness?.id || null,
        state: await onboardingState(input.ownerRef),
        routeReason: mentionedBusiness
          ? "Business onboarding paused; the normal request continues with the explicitly named business context."
          : "Business onboarding paused because the user moved to a normal request.",
      };
    }

    const selection = matchBusinessSelection(text, businesses);

    if (!selection) {
      if (looksLikeNewRequest(text)) {
        await updateSession(input.ownerRef, {
          status: "paused",
          paused_reason: "User moved to another request during business selection.",
        });
        return {
          handled: false,
          state: await onboardingState(input.ownerRef),
          routeReason:
            "Business onboarding paused because the message did not select a business and looked like another request.",
        };
      }

      return {
        handled: true,
        assistantText: businessSelectionText(businesses),
        state,
        routeReason: "Business selection was ambiguous, so CoOperative asked again without guessing.",
      };
    }

    if (selection.kind === "new") {
      await updateSession(input.ownerRef, {
        phase: "business_setup",
        business_id: null,
        draft: {},
        last_question_keys: BUSINESS_SETUP_QUESTIONS.map((item) => item.key),
        paused_reason: null,
      });
      return {
        handled: true,
        assistantText: businessSetupText(),
        state: await onboardingState(input.ownerRef),
        routeReason: "User chose to set up a new business.",
      };
    }

    const batch = await businessIntakeBatchForUser({
      userId: input.userId,
      businessId: selection.business.id,
      limit: 3,
    });
    const completed = batch.complete;

    await updateSession(input.ownerRef, {
      status: completed ? "completed" : "in_progress",
      phase: "business_intake",
      business_id: selection.business.id,
      conversation_id: input.conversationId,
      last_question_keys: batch.questions.map((question) => question.key),
      completed_at: completed ? new Date().toISOString() : null,
      paused_reason: null,
    });
    await saveConversationBusinessContext({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      businessId: selection.business.id,
    });

    return {
      handled: true,
      assistantText: completed
        ? completionText("business")
        : businessQuestionsText(batch.business.name, batch.questions),
      selectedBusinessId: selection.business.id,
      state: await onboardingState(input.ownerRef),
      routeReason: "User selected an existing business for intake.",
    };
  }

  if (state.phase === "business_setup") {
    if (!looksLikeBatchReply(text, BUSINESS_SETUP_QUESTIONS.length)) {
      await updateSession(input.ownerRef, {
        status: "paused",
        paused_reason: "User moved to another request during business setup.",
      });
      return {
        handled: false,
        state: await onboardingState(input.ownerRef),
        routeReason:
          "Business setup paused because the message looked like a new request instead of setup answers.",
      };
    }

    const parsed = parseBatchReply(text, BUSINESS_SETUP_QUESTIONS);
    const draft = { ...(state.draft || {}) } as Record<string, unknown>;

    for (const answer of parsed) {
      draft[answer.fieldKey] = {
        status: answer.status,
        value: answer.value,
        updatedAt: new Date().toISOString(),
      };
    }

    const readDraft = (key: string) => {
      const item = draft[key];
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const row = item as { status?: unknown; value?: unknown };
      return row.status === "known" && typeof row.value === "string"
        ? row.value.trim()
        : null;
    };

    const businessName = readDraft("business_name");
    const industry = readDraft("industry");
    const teamSize = parseTeamSize(readDraft("team_size"));

    if (!businessName) {
      await updateSession(input.ownerRef, {
        draft,
        status: "paused",
        paused_reason: "Business name is still unknown or deferred.",
        last_question_keys: BUSINESS_SETUP_QUESTIONS.map((item) => item.key),
      });

      return {
        handled: true,
        assistantText:
          "I saved what you gave me. I can’t create the business profile until I have a business name, so I’ll leave that setup paused. You can tell me the name later and I’ll pick up from here.",
        state: await onboardingState(input.ownerRef),
        routeReason: "Business setup draft saved, but required business name remains unknown.",
      };
    }

    const businessId = await createBusinessFromOnboarding({
      userId: input.userId,
      name: businessName,
      industry,
      teamSize,
      conversationId: input.conversationId,
    });
    const batch = await businessIntakeBatchForUser({
      userId: input.userId,
      businessId,
      limit: 3,
    });

    await updateSession(input.ownerRef, {
      status: batch.complete ? "completed" : "in_progress",
      mode: "business",
      phase: "business_intake",
      business_id: businessId,
      draft,
      last_question_keys: batch.questions.map((question) => question.key),
      completed_at: batch.complete ? new Date().toISOString() : null,
      paused_reason: null,
    });
    await saveConversationBusinessContext({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      businessId,
    });

    return {
      handled: true,
      assistantText: batch.complete
        ? completionText("business")
        : businessQuestionsText(batch.business.name, batch.questions),
      selectedBusinessId: businessId,
      savedFacts: [
        "business_name",
        ...(industry ? ["industry"] : []),
        ...(teamSize ? ["teamSize"] : []),
      ],
      state: await onboardingState(input.ownerRef),
      routeReason: "Created the business profile and moved into batched business intake.",
    };
  }

  if (state.phase === "business_intake" && state.businessId) {
    const batch = await businessIntakeBatchForUser({
      userId: input.userId,
      businessId: state.businessId,
      limit: 3,
    });

    if (batch.complete) {
      await updateSession(input.ownerRef, {
        status: "completed",
        completed_at: new Date().toISOString(),
        last_question_keys: [],
      });
      return {
        handled: true,
        assistantText: completionText("business"),
        selectedBusinessId: state.businessId,
        state: await onboardingState(input.ownerRef),
        routeReason: "Business intake was already complete.",
      };
    }

    if (!looksLikeBatchReply(text, batch.questions.length)) {
      await updateSession(input.ownerRef, {
        status: "paused",
        paused_reason: "User moved to another request during business intake.",
      });
      return {
        handled: false,
        selectedBusinessId: state.businessId,
        state: await onboardingState(input.ownerRef),
        routeReason:
          "Business intake paused because the message looked like a new request instead of intake answers.",
      };
    }

    const rawAnswers = parseBatchReply(text, batch.questions);
    const answers: BusinessIntakeBatchAnswer[] = rawAnswers.map((answer) => ({
      key: answer.fieldKey as BusinessIntakeBatchAnswer["key"],
      status: answer.status,
      value: answer.value,
    }));

    const saved = await saveBusinessIntakeBatch({
      userId: input.userId,
      businessId: state.businessId,
      conversationId: input.conversationId,
      answers,
    });

    if (!saved.ok) {
      return {
        handled: true,
        assistantText: saved.clarification,
        selectedBusinessId: state.businessId,
        state,
        routeReason:
          "Business intake needed one clarification before saving a structured value.",
      };
    }

    const completed = saved.complete;
    await updateSession(input.ownerRef, {
      status: completed ? "completed" : "in_progress",
      phase: "business_intake",
      business_id: state.businessId,
      last_question_keys: saved.questions.map((question) => question.key),
      completed_at: completed ? new Date().toISOString() : null,
      paused_reason: null,
    });

    return {
      handled: true,
      assistantText: completed
        ? completionText("business")
        : businessQuestionsText(saved.business.name, saved.questions),
      selectedBusinessId: state.businessId,
      savedFacts: saved.savedFacts,
      state: await onboardingState(input.ownerRef),
      routeReason: completed
        ? "Business intake baseline completed."
        : "Saved business intake answers and advanced to the next small batch.",
    };
  }

  return { handled: false, state };
}

export async function answerOnboarding(input: {
  userId?: string;
  ownerRef: string;
  conversationId: string;
  message: string;
}) {
  const userId = input.userId || ownerUserId(input.ownerRef);
  if (!userId) throw new Error("Could not resolve the onboarding user.");

  const result = await handleConversationalOnboardingTurn({
    userId,
    ownerRef: input.ownerRef,
    conversationId: input.conversationId,
    message: input.message,
    hasAttachments: false,
  });

  if (!result.handled || !result.assistantText) {
    return {
      ...result,
      passThrough: true,
    };
  }

  await insertConversationPair({
    ownerRef: input.ownerRef,
    conversationId: input.conversationId,
    userText: input.message,
    assistantText: result.assistantText,
  });

  return {
    ...result,
    passThrough: false,
  };
}

export async function applyProfileFieldUpdates(input: {
  ownerRef: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  sourceKind: string;
  updates: Array<{
    fieldKey: string;
    value: string;
    confidence: number;
    explicitOwnerStatement: boolean;
  }>;
}) {
  const admin = createAdminSupabaseClient();
  await ensureProfileFieldRows(input.ownerRef);
  const allowed = new Map(
    USER_PROFILE_FIELD_DEFINITIONS.map((field) => [field.key, field]),
  );
  const now = new Date().toISOString();

  for (const update of input.updates) {
    const field = allowed.get(update.fieldKey);
    if (
      !field ||
      !update.explicitOwnerStatement ||
      update.confidence < 0.82 ||
      !update.value.trim()
    ) {
      continue;
    }

    const { data: existing, error: existingError } = await admin
      .from("cooperative_user_profile_fields")
      .select("first_known_at")
      .eq("owner_ref", input.ownerRef)
      .eq("field_key", update.fieldKey)
      .maybeSingle();
    if (existingError) throw existingError;

    const { error } = await admin.from("cooperative_user_profile_fields").upsert(
      {
        owner_ref: input.ownerRef,
        field_key: field.key,
        category: field.category,
        label: field.label,
        value_text: update.value.trim().slice(0, 2000),
        status: "known",
        confidence: update.confidence,
        source_conversation_id: input.conversationId || null,
        source_message_id: input.sourceMessageId || null,
        source_kind: input.sourceKind,
        first_known_at: existing?.first_known_at || now,
        last_confirmed_at: now,
        updated_at: now,
      },
      { onConflict: "owner_ref,field_key" },
    );
    if (error) throw error;
  }
}

export async function profileFieldsForRuntime(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  await ensureProfileFieldRows(ownerRef);
  const { data, error } = await admin
    .from("cooperative_user_profile_fields")
    .select(
      "field_key,category,label,value_text,status,confidence,last_confirmed_at,updated_at",
    )
    .eq("owner_ref", ownerRef)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
