import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type ProfileFieldStatus = "known" | "unknown" | "deferred";
export type IntakeMode = "choose" | "personal" | "business";

export type UserProfileFieldDefinition = {
  key: string;
  category: string;
  label: string;
  question: string;
};

export type BusinessProfileFieldDefinition = UserProfileFieldDefinition & {
  profileKey?: string;
};

export const USER_PROFILE_FIELD_DEFINITIONS: UserProfileFieldDefinition[] = [
  { key: "preferred_name", category: "identity", label: "Preferred name", question: "What should I call you?" },
  { key: "primary_help", category: "goals", label: "Primary help", question: "What are the main things you want CoOperative to help you with?" },
  { key: "response_style", category: "preferences", label: "Response style", question: "How do you like answers: short/direct, detailed, options to compare, step-by-step, or something else?" },
  { key: "current_work_projects", category: "work", label: "Current work and projects", question: "What work, projects, or roles matter most to you right now?" },
  { key: "near_term_goals", category: "goals", label: "Near-term goals", question: "What goals should I keep in mind over the next few months?" },
  { key: "tradeoff_priorities", category: "preferences", label: "Tradeoff priorities", question: "When there is a tradeoff, what matters most to you: speed, quality, privacy, cost, control, or a mix?" },
  { key: "recurring_workflows", category: "routines", label: "Recurring workflows", question: "Are there recurring routines or workflows you want me to help with?" },
  { key: "tools_services_devices", category: "tools", label: "Tools, services, and devices", question: "What tools, services, apps, or devices do you use often that I should account for?" },
  { key: "boundaries_and_permissions", category: "preferences", label: "Boundaries and permissions", question: "Are there things you want me to avoid, ask permission before doing, or never assume?" },
  { key: "important_context", category: "context", label: "Important people or context", question: "Are there people, teams, businesses, or other contexts that matter enough for me to remember? Share only what you want remembered." },
  { key: "interests", category: "interests", label: "Interests", question: "What interests or topics do you enjoy or want more help with?" },
  { key: "anything_else", category: "context", label: "Anything else", question: "Anything else that would make CoOperative more useful to you or help it understand how you work?" },
];

export const BUSINESS_PROFILE_FIELD_DEFINITIONS: BusinessProfileFieldDefinition[] = [
  { key: "business_name", category: "identity", label: "Business name", question: "What is the business called?" },
  { key: "owner_role", category: "identity", label: "Your role", question: "What is your role in the business?", profileKey: "ownerRole" },
  { key: "business_summary", category: "identity", label: "What the business does", question: "In a sentence or two, what does the business do?", profileKey: "businessSummary" },
  { key: "industry", category: "identity", label: "Industry", question: "What type of business or industry is it?" },
  { key: "customer_description", category: "customers", label: "Customers", question: "Who are the main customers, and what are they usually trying to get done?", profileKey: "customerDescription" },
  { key: "offerings", category: "customers", label: "Products or services", question: "What products or services does the business offer?", profileKey: "offerings" },
  { key: "current_goals", category: "goals", label: "Current business goals", question: "What are the most important business goals right now?", profileKey: "currentGoals" },
  { key: "team_size", category: "operations", label: "Team size", question: "How many people are on the team, including you?" },
  { key: "recurring_workflows", category: "operations", label: "Recurring workflows", question: "What work or workflows repeat regularly?", profileKey: "recurringWorkflows" },
  { key: "tools", category: "tools", label: "Business tools", question: "What software, websites, services, or devices do you use to run the business?", profileKey: "tools" },
  { key: "bottlenecks", category: "operations", label: "Bottlenecks", question: "What regularly slows the business down or creates extra work?", profileKey: "bottlenecks" },
  { key: "human_approval_areas", category: "permissions", label: "Human approval boundaries", question: "What decisions or actions should always require human approval?", profileKey: "humanApprovalAreas" },
  { key: "ai_usage_today", category: "ai", label: "Current AI use", question: "How does the business use AI today, if at all?", profileKey: "aiUsageToday" },
  { key: "local_ai_preference", category: "ai", label: "Local/cloud preference", question: "Should CoOperative prefer your own hardware, use it when it is a good fit, or prefer cloud services?", profileKey: "localAiPreference" },
  { key: "monthly_ai_spend", category: "budget", label: "Monthly AI spend", question: "About how much does the business spend on AI in a typical month?", profileKey: "monthlyAiSpend" },
  { key: "monthly_technology_spend", category: "budget", label: "Monthly technology spend", question: "About how much do you currently spend per month on technology and software?", profileKey: "monthlyTechnologySpend" },
  { key: "monthly_technology_budget", category: "budget", label: "Technology budget", question: "What maximum monthly technology budget should CoOperative respect?", profileKey: "monthlyTechnologyBudget" },
  { key: "max_cooperative_managed_spend", category: "budget", label: "CoOperative managed-spend ceiling", question: "What is the maximum amount CoOperative may manage or spend per month without a new approval?", profileKey: "maxCooperativeManagedSpend" },
  { key: "target_savings_percent", category: "budget", label: "Target savings percent", question: "What percentage reduction in technology cost should CoOperative aim for?", profileKey: "targetSavingsPercent" },
  { key: "cost_priority", category: "preferences", label: "Cost/quality priority", question: "Should I optimize for lowest cost, balanced cost and convenience, or best fit?", profileKey: "costPriority" },
  { key: "business_anything_else", category: "context", label: "Anything else", question: "Anything else about this business that would help CoOperative make better decisions?", profileKey: "anythingElse" },
];

const BATCH_SIZE = 3;

function ownerUserId(ownerRef: string) {
  const match = /^coop-user:([0-9a-f-]{36})$/i.exec(ownerRef);
  return match?.[1] || null;
}

function choiceText() {
  return [
    "Before we get started, would you like to begin with a Personal intake or a Business intake?",
    "",
    "1. Personal — save how you like to work, your goals, style, history, tools, and preferences.",
    "2. Business — set up or update a business so its goals, workflows, tools, budgets, AI use, and history stay separate and current.",
    "",
    "Everything is optional. You can say “later” or “skip” and keep chatting normally. If you ask for something unrelated, I’ll handle that request and we can come back to intake later.",
  ].join("\n");
}

function batchQuestionText(
  fields: UserProfileFieldDefinition[],
  mode: "personal" | "business",
) {
  const intro =
    mode === "personal"
      ? "A few personal setup questions — answer any or all. Numbered replies help me map them exactly."
      : "A few business setup questions — answer any or all. Numbered replies help me map them exactly.";
  return [
    intro,
    "Use “later” to defer a field or “skip” to leave it unknown. You can also say “pause intake” and ask me for something else.",
    "",
    ...fields.map((field, index) => `${index + 1}. ${field.question}`),
  ].join("\n");
}

function completionText(mode: "personal" | "business") {
  return mode === "personal"
    ? "That’s plenty to get started. I saved what you chose to share. Anything skipped stays unknown and anything deferred stays available for later. Normal conversation can keep filling or correcting these fields when you explicitly tell me something useful."
    : "The baseline business intake is complete. I saved what you chose to share and will keep that business context separate from personal context and other businesses. Unknown or deferred fields can be filled naturally later.";
}

function pauseText() {
  return "No problem. I’ll pause intake here. Everything already answered stays saved, missing values stay unknown or deferred, and you can say “continue intake” whenever you want to pick it back up.";
}

function answerValue(value: string) {
  const text = value.trim();
  if (/^(?:later|tell you later|i'?ll tell you later|not now|maybe later|defer)$/i.test(text)) {
    return { status: "deferred" as const, value: null };
  }
  if (/^(?:skip|unknown|don'?t know|do not know|n\/a|na|pass)$/i.test(text)) {
    return { status: "unknown" as const, value: null };
  }
  return { status: "known" as const, value: text.slice(0, 3000) || null };
}

function parseProvidedBatchReply(
  message: string,
  fields: UserProfileFieldDefinition[],
) {
  const normalized = message.trim();
  const matches = Array.from(
    normalized.matchAll(
      /(?:^|\n|\s)([1-3])\s*[).:\-]\s*([\s\S]*?)(?=(?:\n|\s)[1-3]\s*[).:\-]|$)/g,
    ),
  );

  if (matches.length) {
    return matches.flatMap((match) => {
      const index = Number(match[1]) - 1;
      const field = fields[index];
      if (!field) return [];
      return [{ fieldKey: field.key, ...answerValue((match[2] || "").trim()) }];
    });
  }

  const lines = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.length <= fields.length) {
    return lines.map((line, index) => ({
      fieldKey: fields[index].key,
      ...answerValue(line),
    }));
  }

  if (fields.length === 1 && normalized) {
    return [{ fieldKey: fields[0].key, ...answerValue(normalized) }];
  }

  return [];
}

function looksLikeUnrelatedRequest(message: string) {
  const value = message.trim().toLowerCase();
  if (!value) return false;
  if (/^[1-3]\s*[).:\-]/.test(value)) return false;
  if (/^(?:skip|later|pass|pause intake|stop intake|continue intake)/.test(value)) return false;
  return (
    value.includes("?") ||
    /^(?:can|could|would|what|why|how|when|where|who|show|find|create|make|write|draft|generate|build|fix|check|look|research|help|tell)\b/.test(value) ||
    /^(?:i need|i want|i'd like|please)\b/.test(value)
  );
}

function nextFields<T extends UserProfileFieldDefinition>(
  definitions: T[],
  rows: Array<{ field_key: string; status: string; source_kind?: string | null }>,
) {
  const byKey = new Map(rows.map((row) => [row.field_key, row]));
  return definitions
    .filter((field) => {
      const row = byKey.get(field.key);
      if (!row) return true;
      if (row.status === "known" || row.status === "deferred") return false;
      return !/-(?:skipped|deferred)$/.test(row.source_kind || "");
    })
    .slice(0, BATCH_SIZE);
}

function revisitFields<T extends UserProfileFieldDefinition>(
  definitions: T[],
  rows: Array<{ field_key: string; status: string }>,
) {
  const byKey = new Map(rows.map((row) => [row.field_key, row.status]));
  return definitions
    .filter((field) => byKey.get(field.key) !== "known")
    .slice(0, BATCH_SIZE);
}

async function ownedBusinesses(ownerRef: string) {
  const userId = ownerUserId(ownerRef);
  if (!userId) return [];
  const admin = createAdminSupabaseClient();
  const { data: organizations, error: orgError } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId);
  if (orgError) throw orgError;
  const ids = (organizations || []).map((item) => item.id);
  if (!ids.length) return [];
  const { data, error } = await admin
    .from("businesses")
    .select("id,name,industry,team_size,profile,organization_id")
    .in("organization_id", ids)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function ensureOrganization(ownerRef: string, name: string) {
  const userId = ownerUserId(ownerRef);
  if (!userId) throw new Error("Business intake requires a CoOperative user.");
  const admin = createAdminSupabaseClient();
  const { data: existing, error: existingError } = await admin
    .from("organizations")
    .select("id,name")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing.id as string;

  const { data, error } = await admin
    .from("organizations")
    .insert({ name: `${name.slice(0, 100)} Workspace`, owner_user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
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

async function ensureBusinessFieldRows(ownerRef: string, businessId: string) {
  const admin = createAdminSupabaseClient();
  const businesses = await ownedBusinesses(ownerRef);
  const business = businesses.find((item) => item.id === businessId);
  if (!business) throw new Error("Selected business is not available to this account.");

  const profile =
    business.profile && typeof business.profile === "object" && !Array.isArray(business.profile)
      ? (business.profile as Record<string, unknown>)
      : {};

  const seed = BUSINESS_PROFILE_FIELD_DEFINITIONS.map((field) => {
    let value: unknown = null;
    if (field.key === "business_name") value = business.name;
    else if (field.key === "industry") value = business.industry;
    else if (field.key === "team_size") value = business.team_size;
    else if (field.profileKey) value = profile[field.profileKey];

    const valueText =
      typeof value === "string" && value.trim()
        ? value.trim()
        : typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : null;

    return {
      owner_ref: ownerRef,
      business_id: businessId,
      field_key: field.key,
      category: field.category,
      label: field.label,
      value_text: valueText,
      status: valueText ? "known" : "unknown",
      confidence: 1,
      source_kind: valueText ? "existing-business-profile" : "business-intake",
      first_known_at: valueText ? new Date().toISOString() : null,
      last_confirmed_at: valueText ? new Date().toISOString() : null,
    };
  });

  const { error } = await admin
    .from("cooperative_business_profile_fields")
    .upsert(seed, {
      onConflict: "owner_ref,business_id,field_key",
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

async function personalRows(ownerRef: string) {
  await ensureProfileFieldRows(ownerRef);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cooperative_user_profile_fields")
    .select("field_key,category,label,value_text,status,confidence,source_kind,last_confirmed_at,updated_at")
    .eq("owner_ref", ownerRef)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function businessRows(ownerRef: string, businessId: string) {
  await ensureBusinessFieldRows(ownerRef, businessId);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("cooperative_business_profile_fields")
    .select("field_key,category,label,value_text,status,confidence,source_kind,last_confirmed_at,updated_at")
    .eq("owner_ref", ownerRef)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function updateSession(
  ownerRef: string,
  updates: Record<string, unknown>,
) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin
    .from("cooperative_onboarding_sessions")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("owner_ref", ownerRef);
  if (error) throw error;
}

async function addAssistantMessage(
  ownerRef: string,
  conversationId: string,
  content: string,
) {
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("local_ai_messages").insert({
    conversation_id: conversationId,
    owner_ref: ownerRef,
    role: "assistant",
    content,
    attachment_ids: [],
  });
  if (error) throw error;
}

async function addUserMessage(
  ownerRef: string,
  conversationId: string,
  content: string,
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("local_ai_messages")
    .insert({
      conversation_id: conversationId,
      owner_ref: ownerRef,
      role: "user",
      content: content.trim(),
      attachment_ids: [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function touchConversation(ownerRef: string, conversationId: string) {
  const admin = createAdminSupabaseClient();
  await admin
    .from("local_ai_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("owner_ref", ownerRef);
}

async function savePersonalAnswers(input: {
  ownerRef: string;
  conversationId: string;
  sourceMessageId: string;
  fields: UserProfileFieldDefinition[];
  message: string;
}) {
  const answers = parseProvidedBatchReply(input.message, input.fields);
  if (!answers.length) return 0;
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();

  for (const answer of answers) {
    const known = answer.status === "known" && Boolean(answer.value);
    const { data: existing } = await admin
      .from("cooperative_user_profile_fields")
      .select("first_known_at")
      .eq("owner_ref", input.ownerRef)
      .eq("field_key", answer.fieldKey)
      .maybeSingle();

    const { error } = await admin
      .from("cooperative_user_profile_fields")
      .update({
        value_text: known ? answer.value : null,
        status: known ? "known" : answer.status,
        confidence: 1,
        source_conversation_id: input.conversationId,
        source_message_id: input.sourceMessageId,
        source_kind:
          answer.status === "unknown"
            ? "personal-intake-skipped"
            : answer.status === "deferred"
              ? "personal-intake-deferred"
              : "personal-intake",
        first_known_at: known ? existing?.first_known_at || now : existing?.first_known_at || null,
        last_confirmed_at: known ? now : null,
        updated_at: now,
      })
      .eq("owner_ref", input.ownerRef)
      .eq("field_key", answer.fieldKey);
    if (error) throw error;
  }

  return answers.length;
}

function numericBusinessField(key: string) {
  return [
    "team_size",
    "monthly_ai_spend",
    "monthly_technology_spend",
    "monthly_technology_budget",
    "max_cooperative_managed_spend",
    "target_savings_percent",
  ].includes(key);
}

function businessProfileKey(fieldKey: string) {
  return BUSINESS_PROFILE_FIELD_DEFINITIONS.find((field) => field.key === fieldKey)?.profileKey || null;
}

async function syncBusinessRecord(
  ownerRef: string,
  businessId: string,
  updates: Array<{ fieldKey: string; value: string }>,
) {
  if (!updates.length) return;
  const businesses = await ownedBusinesses(ownerRef);
  const business = businesses.find((item) => item.id === businessId);
  if (!business) throw new Error("Business is not available to this account.");

  const profile =
    business.profile && typeof business.profile === "object" && !Array.isArray(business.profile)
      ? { ...(business.profile as Record<string, unknown>) }
      : {};
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const update of updates) {
    const raw = update.value.trim();
    if (update.fieldKey === "business_name") patch.name = raw.slice(0, 120);
    else if (update.fieldKey === "industry") patch.industry = raw.slice(0, 180);
    else if (update.fieldKey === "team_size") {
      const parsed = Number(raw.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed >= 1) patch.team_size = Math.round(parsed);
    } else {
      const key = businessProfileKey(update.fieldKey);
      if (!key) continue;
      if (numericBusinessField(update.fieldKey)) {
        const parsed = Number(raw.replace(/[^0-9.]/g, ""));
        profile[key] = Number.isFinite(parsed) ? parsed : raw;
      } else {
        profile[key] = raw;
      }
    }
  }
  patch.profile = profile;

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("businesses").update(patch).eq("id", businessId);
  if (error) throw error;
}

async function saveBusinessAnswers(input: {
  ownerRef: string;
  businessId: string;
  conversationId: string;
  sourceMessageId: string | null;
  fields: BusinessProfileFieldDefinition[];
  message: string;
  sourceKind?: string;
}) {
  const answers = parseProvidedBatchReply(input.message, input.fields);
  if (!answers.length) return 0;
  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();
  const sync: Array<{ fieldKey: string; value: string }> = [];

  for (const answer of answers) {
    const field = BUSINESS_PROFILE_FIELD_DEFINITIONS.find((item) => item.key === answer.fieldKey);
    if (!field) continue;
    const known = answer.status === "known" && Boolean(answer.value);

    const { data: existing } = await admin
      .from("cooperative_business_profile_fields")
      .select("first_known_at")
      .eq("owner_ref", input.ownerRef)
      .eq("business_id", input.businessId)
      .eq("field_key", answer.fieldKey)
      .maybeSingle();

    const { error } = await admin
      .from("cooperative_business_profile_fields")
      .upsert(
        {
          owner_ref: input.ownerRef,
          business_id: input.businessId,
          field_key: field.key,
          category: field.category,
          label: field.label,
          value_text: known ? answer.value : null,
          status: known ? "known" : answer.status,
          confidence: 1,
          source_conversation_id: input.conversationId,
          source_message_id: input.sourceMessageId,
          source_kind:
            answer.status === "unknown"
              ? `${input.sourceKind || "business-intake"}-skipped`
              : answer.status === "deferred"
                ? `${input.sourceKind || "business-intake"}-deferred`
                : input.sourceKind || "business-intake",
          first_known_at: known ? existing?.first_known_at || now : existing?.first_known_at || null,
          last_confirmed_at: known ? now : null,
          updated_at: now,
        },
        { onConflict: "owner_ref,business_id,field_key" },
      );
    if (error) throw error;
    if (known && answer.value) sync.push({ fieldKey: answer.fieldKey, value: answer.value });
  }

  await syncBusinessRecord(input.ownerRef, input.businessId, sync);
  return answers.length;
}

function businessSelectionText(
  businesses: Array<{ id: string; name: string }>,
) {
  return [
    "Which business should we set up or update?",
    "",
    ...businesses.map((business, index) => `${index + 1}. ${business.name}`),
    `${businesses.length + 1}. New business`,
    "",
    "You can also type the business name. Say “later” to pause intake.",
  ].join("\n");
}

function newBusinessBasicsText() {
  return batchQuestionText(
    [
      { key: "business_name", category: "identity", label: "Business name", question: "What is the business called?" },
      { key: "industry", category: "identity", label: "Industry", question: "What type of business or industry is it?" },
      { key: "owner_role", category: "identity", label: "Your role", question: "What is your role in the business?" },
    ],
    "business",
  );
}

async function createBusinessFromBasics(input: {
  ownerRef: string;
  conversationId: string;
  message: string;
}) {
  const basics = [
    BUSINESS_PROFILE_FIELD_DEFINITIONS.find((field) => field.key === "business_name")!,
    BUSINESS_PROFILE_FIELD_DEFINITIONS.find((field) => field.key === "industry")!,
    BUSINESS_PROFILE_FIELD_DEFINITIONS.find((field) => field.key === "owner_role")!,
  ];
  const answers = parseProvidedBatchReply(input.message, basics);
  const byKey = new Map(answers.map((answer) => [answer.fieldKey, answer]));
  const name = byKey.get("business_name");
  if (!name || name.status !== "known" || !name.value?.trim()) return null;

  const organizationId = await ensureOrganization(input.ownerRef, name.value.trim());
  const industry = byKey.get("industry");
  const role = byKey.get("owner_role");
  const profile: Record<string, unknown> = {};
  if (role?.status === "known" && role.value) profile.ownerRole = role.value;

  const admin = createAdminSupabaseClient();
  const { data: business, error } = await admin
    .from("businesses")
    .insert({
      organization_id: organizationId,
      name: name.value.trim().slice(0, 120),
      industry:
        industry?.status === "known" && industry.value
          ? industry.value.trim().slice(0, 180)
          : "",
      team_size: 1,
      profile,
    })
    .select("id")
    .single();
  if (error) throw error;

  await ensureBusinessFieldRows(input.ownerRef, business.id);
  const sourceMessageId = await addUserMessage(
    input.ownerRef,
    input.conversationId,
    input.message,
  );
  await saveBusinessAnswers({
    ownerRef: input.ownerRef,
    businessId: business.id,
    conversationId: input.conversationId,
    sourceMessageId,
    fields: basics,
    message: input.message,
  });

  return business.id as string;
}

export async function onboardingState(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  await ensureProfileFieldRows(ownerRef);

  const [{ data: session, error: sessionError }, fields] = await Promise.all([
    admin
      .from("cooperative_onboarding_sessions")
      .select("status,current_batch,conversation_id,mode,phase,business_id,draft,last_question_keys,paused_reason")
      .eq("owner_ref", ownerRef)
      .maybeSingle(),
    personalRows(ownerRef),
  ]);
  if (sessionError) throw sessionError;

  return {
    status: session?.status || "not_started",
    currentBatch: Number(session?.current_batch || 0),
    conversationId: session?.conversation_id || null,
    mode: (session?.mode || "choose") as IntakeMode,
    phase: session?.phase || "choose_mode",
    businessId: session?.business_id || null,
    pausedReason: session?.paused_reason || null,
    totalBatches: Math.ceil(USER_PROFILE_FIELD_DEFINITIONS.length / BATCH_SIZE),
    fields,
  };
}

export async function startOnboarding(ownerRef: string) {
  const admin = createAdminSupabaseClient();
  const state = await onboardingState(ownerRef);
  if (
    state.status === "in_progress" &&
    state.conversationId &&
    state.phase !== "paused"
  ) {
    return state;
  }
  if (state.status === "completed" || state.status === "dismissed") return state;

  const now = new Date().toISOString();
  const conversationId = state.conversationId || crypto.randomUUID();

  if (!state.conversationId) {
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
  }

  const { error: messageError } = await admin.from("local_ai_messages").insert({
    conversation_id: conversationId,
    owner_ref: ownerRef,
    role: "assistant",
    content: choiceText(),
    attachment_ids: [],
    created_at: now,
  });
  if (messageError) throw messageError;

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
        started_at: state.status === "not_started" ? now : undefined,
        completed_at: null,
        dismissed_at: null,
        updated_at: now,
      },
      { onConflict: "owner_ref" },
    );
  if (sessionError) throw sessionError;

  return onboardingState(ownerRef);
}

export async function resumeOnboarding(ownerRef: string) {
  const state = await onboardingState(ownerRef);
  if (state.status === "completed" || state.status === "dismissed") return state;
  if (state.status === "not_started" || !state.conversationId) {
    return startOnboarding(ownerRef);
  }

  const admin = createAdminSupabaseClient();
  let assistantText = choiceText();
  let phase = state.phase;
  let mode = state.mode;
  let businessId = state.businessId;

  if (mode === "personal") {
    const rows = await personalRows(ownerRef);
    const fields = nextFields(USER_PROFILE_FIELD_DEFINITIONS, rows);
    if (!fields.length) {
      await updateSession(ownerRef, { status: "completed", phase: "completed", completed_at: new Date().toISOString() });
      return onboardingState(ownerRef);
    }
    phase = "personal_questions";
    assistantText = batchQuestionText(fields, "personal");
  } else if (mode === "business" && businessId) {
    const rows = await businessRows(ownerRef, businessId);
    const fields = nextFields(BUSINESS_PROFILE_FIELD_DEFINITIONS, rows);
    if (!fields.length) {
      await updateSession(ownerRef, { status: "completed", phase: "completed", completed_at: new Date().toISOString() });
      return onboardingState(ownerRef);
    }
    phase = "business_questions";
    assistantText = batchQuestionText(fields, "business");
  } else if (mode === "business") {
    const businesses = await ownedBusinesses(ownerRef);
    phase = businesses.length ? "select_business" : "new_business_basics";
    assistantText = businesses.length
      ? businessSelectionText(businesses)
      : newBusinessBasicsText();
  } else {
    mode = "choose";
    phase = "choose_mode";
  }

  await updateSession(ownerRef, {
    status: "in_progress",
    mode,
    phase,
    business_id: businessId,
    paused_reason: null,
  });
  await addAssistantMessage(ownerRef, state.conversationId, assistantText);
  await touchConversation(ownerRef, state.conversationId);
  return onboardingState(ownerRef);
}

export async function answerOnboarding(input: {
  ownerRef: string;
  conversationId: string;
  message: string;
}) {
  const state = await onboardingState(input.ownerRef);
  if (
    state.status !== "in_progress" ||
    state.conversationId !== input.conversationId ||
    state.phase === "paused"
  ) {
    throw new Error("No active intake conversation matches this reply.");
  }

  const value = input.message.trim();
  const lower = value.toLowerCase();

  if (/^(?:pause|stop|end|skip)(?: the)? (?:intake|onboarding|setup)\.?$/.test(lower) || /^(?:later|not now)\.?$/.test(lower)) {
    const userId = await addUserMessage(input.ownerRef, input.conversationId, value);
    void userId;
    await updateSession(input.ownerRef, {
      phase: "paused",
      paused_reason: "user",
    });
    const assistantText = pauseText();
    await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
    await touchConversation(input.ownerRef, input.conversationId);
    return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
  }

  if (state.phase === "choose_mode") {
    const personal = /^(?:1|personal|personal intake|personal setup)\b/i.test(value);
    const business = /^(?:2|business|business intake|business setup)\b/i.test(value);

    if (!personal && !business) {
      await updateSession(input.ownerRef, {
        phase: "paused",
        paused_reason: "unrelated-request",
      });
      return { handled: false, state: await onboardingState(input.ownerRef) };
    }

    await addUserMessage(input.ownerRef, input.conversationId, value);

    if (personal) {
      const rows = await personalRows(input.ownerRef);
      const fields = nextFields(USER_PROFILE_FIELD_DEFINITIONS, rows);
      const assistantText = batchQuestionText(fields, "personal");
      await updateSession(input.ownerRef, {
        mode: "personal",
        phase: "personal_questions",
        current_batch: 0,
        last_question_keys: fields.map((field) => field.key),
      });
      await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
      await touchConversation(input.ownerRef, input.conversationId);
      return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
    }

    const businesses = await ownedBusinesses(input.ownerRef);
    const assistantText = businesses.length
      ? businessSelectionText(businesses)
      : newBusinessBasicsText();
    await updateSession(input.ownerRef, {
      mode: "business",
      phase: businesses.length ? "select_business" : "new_business_basics",
      current_batch: 0,
      business_id: null,
      last_question_keys: businesses.length
        ? []
        : ["business_name", "industry", "owner_role"],
    });
    await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
    await touchConversation(input.ownerRef, input.conversationId);
    return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
  }

  if (looksLikeUnrelatedRequest(value)) {
    await updateSession(input.ownerRef, {
      phase: "paused",
      paused_reason: "unrelated-request",
    });
    return { handled: false, state: await onboardingState(input.ownerRef) };
  }

  if (state.phase === "select_business") {
    const businesses = await ownedBusinesses(input.ownerRef);
    let selected = null as (typeof businesses)[number] | null;
    const numeric = Number(value.replace(/[^0-9]/g, ""));
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= businesses.length) {
      selected = businesses[numeric - 1];
    } else {
      selected =
        businesses.find((business) =>
          business.name.toLowerCase() === lower.replace(/^the\s+/, ""),
        ) || null;
    }
    const wantsNew =
      /\bnew business\b/i.test(value) ||
      numeric === businesses.length + 1;

    await addUserMessage(input.ownerRef, input.conversationId, value);

    if (!selected && wantsNew) {
      const assistantText = newBusinessBasicsText();
      await updateSession(input.ownerRef, {
        phase: "new_business_basics",
        business_id: null,
        last_question_keys: ["business_name", "industry", "owner_role"],
      });
      await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
      return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
    }

    if (!selected) {
      const assistantText = "I couldn't match that to one of your businesses. Pick a number/name from the list, choose “New business,” or say “later.”";
      await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
      return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
    }

    const rows = await businessRows(input.ownerRef, selected.id);
    const fields = nextFields(BUSINESS_PROFILE_FIELD_DEFINITIONS, rows);
    const assistantText = fields.length
      ? batchQuestionText(fields, "business")
      : completionText("business");
    await updateSession(input.ownerRef, {
      business_id: selected.id,
      phase: fields.length ? "business_questions" : "completed",
      status: fields.length ? "in_progress" : "completed",
      last_question_keys: fields.map((field) => field.key),
      completed_at: fields.length ? null : new Date().toISOString(),
    });
    await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
    await touchConversation(input.ownerRef, input.conversationId);
    return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
  }

  if (state.phase === "new_business_basics") {
    const businessId = await createBusinessFromBasics({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      message: value,
    });

    if (!businessId) {
      const assistantText = "I need the business name before I can create its separate profile. You can answer just “1. Business Name” and leave the other two for later.";
      await addUserMessage(input.ownerRef, input.conversationId, value);
      await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
      return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
    }

    const rows = await businessRows(input.ownerRef, businessId);
    const fields = nextFields(BUSINESS_PROFILE_FIELD_DEFINITIONS, rows);
    const assistantText = fields.length
      ? batchQuestionText(fields, "business")
      : completionText("business");
    await updateSession(input.ownerRef, {
      business_id: businessId,
      phase: fields.length ? "business_questions" : "completed",
      status: fields.length ? "in_progress" : "completed",
      last_question_keys: fields.map((field) => field.key),
      completed_at: fields.length ? null : new Date().toISOString(),
    });
    await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
    await touchConversation(input.ownerRef, input.conversationId);
    return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
  }

  if (state.phase === "personal_questions") {
    const rows = await personalRows(input.ownerRef);
    const fields = nextFields(USER_PROFILE_FIELD_DEFINITIONS, rows);
    const answers = parseProvidedBatchReply(value, fields);
    if (!answers.length) {
      await updateSession(input.ownerRef, { phase: "paused", paused_reason: "unrelated-or-unmapped" });
      return { handled: false, state: await onboardingState(input.ownerRef) };
    }

    const sourceMessageId = await addUserMessage(input.ownerRef, input.conversationId, value);
    await savePersonalAnswers({
      ownerRef: input.ownerRef,
      conversationId: input.conversationId,
      sourceMessageId,
      fields,
      message: value,
    });
    const updated = await personalRows(input.ownerRef);
    const next = nextFields(USER_PROFILE_FIELD_DEFINITIONS, updated);
    const assistantText = next.length
      ? batchQuestionText(next, "personal")
      : completionText("personal");
    await updateSession(input.ownerRef, {
      current_batch: state.currentBatch + 1,
      phase: next.length ? "personal_questions" : "completed",
      status: next.length ? "in_progress" : "completed",
      last_question_keys: next.map((field) => field.key),
      completed_at: next.length ? null : new Date().toISOString(),
    });
    await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
    await touchConversation(input.ownerRef, input.conversationId);
    return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
  }

  if (state.phase === "business_questions" && state.businessId) {
    const rows = await businessRows(input.ownerRef, state.businessId);
    const fields = nextFields(BUSINESS_PROFILE_FIELD_DEFINITIONS, rows);
    const answers = parseProvidedBatchReply(value, fields);
    if (!answers.length) {
      await updateSession(input.ownerRef, { phase: "paused", paused_reason: "unrelated-or-unmapped" });
      return { handled: false, state: await onboardingState(input.ownerRef) };
    }

    const sourceMessageId = await addUserMessage(input.ownerRef, input.conversationId, value);
    await saveBusinessAnswers({
      ownerRef: input.ownerRef,
      businessId: state.businessId,
      conversationId: input.conversationId,
      sourceMessageId,
      fields,
      message: value,
    });
    const updated = await businessRows(input.ownerRef, state.businessId);
    const next = nextFields(BUSINESS_PROFILE_FIELD_DEFINITIONS, updated);
    const assistantText = next.length
      ? batchQuestionText(next, "business")
      : completionText("business");
    await updateSession(input.ownerRef, {
      current_batch: state.currentBatch + 1,
      phase: next.length ? "business_questions" : "completed",
      status: next.length ? "in_progress" : "completed",
      last_question_keys: next.map((field) => field.key),
      completed_at: next.length ? null : new Date().toISOString(),
    });
    await addAssistantMessage(input.ownerRef, input.conversationId, assistantText);
    await touchConversation(input.ownerRef, input.conversationId);
    return { handled: true, assistantText, state: await onboardingState(input.ownerRef) };
  }

  await updateSession(input.ownerRef, { phase: "paused", paused_reason: "unhandled-phase" });
  return { handled: false, state: await onboardingState(input.ownerRef) };
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
  const allowed = new Map(USER_PROFILE_FIELD_DEFINITIONS.map((field) => [field.key, field]));
  const now = new Date().toISOString();

  for (const update of input.updates) {
    const field = allowed.get(update.fieldKey);
    if (!field || !update.explicitOwnerStatement || update.confidence < 0.82 || !update.value.trim()) continue;

    const { data: existing } = await admin
      .from("cooperative_user_profile_fields")
      .select("first_known_at")
      .eq("owner_ref", input.ownerRef)
      .eq("field_key", update.fieldKey)
      .maybeSingle();

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

export async function applyBusinessProfileFieldUpdates(input: {
  ownerRef: string;
  businessId: string;
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
  await ensureBusinessFieldRows(input.ownerRef, input.businessId);
  const fields = new Map(BUSINESS_PROFILE_FIELD_DEFINITIONS.map((field) => [field.key, field]));
  const accepted = input.updates.filter(
    (update) =>
      fields.has(update.fieldKey) &&
      update.explicitOwnerStatement &&
      update.confidence >= 0.82 &&
      Boolean(update.value.trim()),
  );
  if (!accepted.length) return;

  const admin = createAdminSupabaseClient();
  const now = new Date().toISOString();
  for (const update of accepted) {
    const field = fields.get(update.fieldKey)!;
    const { data: existing } = await admin
      .from("cooperative_business_profile_fields")
      .select("first_known_at")
      .eq("owner_ref", input.ownerRef)
      .eq("business_id", input.businessId)
      .eq("field_key", update.fieldKey)
      .maybeSingle();

    const { error } = await admin
      .from("cooperative_business_profile_fields")
      .upsert(
        {
          owner_ref: input.ownerRef,
          business_id: input.businessId,
          field_key: field.key,
          category: field.category,
          label: field.label,
          value_text: update.value.trim().slice(0, 3000),
          status: "known",
          confidence: update.confidence,
          source_conversation_id: input.conversationId || null,
          source_message_id: input.sourceMessageId || null,
          source_kind: input.sourceKind,
          first_known_at: existing?.first_known_at || now,
          last_confirmed_at: now,
          updated_at: now,
        },
        { onConflict: "owner_ref,business_id,field_key" },
      );
    if (error) throw error;
  }

  await syncBusinessRecord(
    input.ownerRef,
    input.businessId,
    accepted.map((update) => ({ fieldKey: update.fieldKey, value: update.value })),
  );
}

export async function profileFieldsForRuntime(ownerRef: string) {
  return personalRows(ownerRef);
}

export async function businessProfileFieldsForRuntime(
  ownerRef: string,
  businessId?: string | null,
) {
  if (!businessId) return [];
  try {
    return await businessRows(ownerRef, businessId);
  } catch {
    return [];
  }
}

function normalizedBusinessName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function resolveBusinessScope(input: {
  ownerRef: string;
  requestedBusinessId?: string | null;
  message?: string | null;
}) {
  const businesses = await ownedBusinesses(input.ownerRef);
  if (!businesses.length) {
    return { businessId: null, businessName: null, source: "none" as const };
  }

  if (input.requestedBusinessId) {
    const selected = businesses.find(
      (business) => business.id === input.requestedBusinessId,
    );
    if (selected) {
      return {
        businessId: selected.id as string,
        businessName: selected.name as string,
        source: "selected" as const,
      };
    }
  }

  const message = normalizedBusinessName(input.message || "");
  if (message) {
    const matches = businesses.filter((business) => {
      const name = normalizedBusinessName(business.name || "");
      if (!name || name.length < 2) return false;
      return (
        message === name ||
        message.includes(` ${name} `) ||
        message.startsWith(`${name} `) ||
        message.endsWith(` ${name}`)
      );
    });

    if (matches.length === 1) {
      return {
        businessId: matches[0].id as string,
        businessName: matches[0].name as string,
        source: "explicit-message" as const,
      };
    }
  }

  return { businessId: null, businessName: null, source: "none" as const };
}

export async function businessScopePromptContext(
  ownerRef: string,
  activeBusinessId?: string | null,
) {
  const businesses = await ownedBusinesses(ownerRef);
  if (!businesses.length) {
    return [
      "SCOPE CLARIFICATION POLICY.",
      "No business profile is currently available. Treat ambiguous requests as personal unless the user says they are for a business.",
    ].join("\n");
  }

  const active = activeBusinessId
    ? businesses.find((business) => business.id === activeBusinessId)
    : null;
  return [
    "PERSONAL VS BUSINESS SCOPE POLICY.",
    `Known businesses for this user: ${businesses.map((business) => business.name).join(", ")}.`,
    active ? `UI-selected business context: ${active.name}. This is a useful signal, not permission to assume every request is business-related.` : "No business is explicitly selected for this request.",
    "If the user's request would materially change depending on whether it is personal or for a business, and recent conversation does not already establish the scope, ask one short contextual clarification before proceeding.",
    `Example: “Sure — is this personal, or is it for ${businesses.slice(0, 3).map((business) => business.name).join(", ")}?”`,
    "Do not ask when the scope is already clear from the current request or conversation.",
    "When the user explicitly reveals a durable personal or business fact while answering another request, it may be saved to the matching structured profile with provenance.",
  ].join("\n");
}
