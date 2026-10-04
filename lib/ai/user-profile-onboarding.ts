import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";


export type ProfileFieldStatus = "known" | "unknown" | "deferred";

export type UserProfileFieldDefinition = {
  key: string;
  category: string;
  label: string;
  question: string;
};

export const USER_PROFILE_FIELD_DEFINITIONS: UserProfileFieldDefinition[] = [
  { key: "preferred_name", category: "identity", label: "Preferred name", question: "What should I call you?" },
  { key: "primary_help", category: "goals", label: "Primary help", question: "What are the main things you want CoOperative to help you with?" },
  { key: "response_style", category: "preferences", label: "Response style", question: "How do you like answers: short/direct, detailed, options to compare, step-by-step, or something else?" },
  { key: "current_work_projects", category: "work", label: "Current work and projects", question: "What work, businesses, projects, or roles matter most to you right now?" },
  { key: "near_term_goals", category: "goals", label: "Near-term goals", question: "What goals should I keep in mind over the next few months?" },
  { key: "tradeoff_priorities", category: "preferences", label: "Tradeoff priorities", question: "When there is a tradeoff, what matters most to you: speed, quality, privacy, cost, control, or a mix?" },
  { key: "recurring_workflows", category: "routines", label: "Recurring workflows", question: "Are there recurring routines or workflows you want me to help with?" },
  { key: "tools_services_devices", category: "tools", label: "Tools, services, and devices", question: "What tools, services, apps, or devices do you use often that I should account for?" },
  { key: "boundaries_and_permissions", category: "preferences", label: "Boundaries and permissions", question: "Are there things you want me to avoid, ask permission before doing, or never assume?" },
  { key: "important_context", category: "context", label: "Important people or context", question: "Are there people, teams, businesses, or other contexts that matter enough for me to remember? Share only what you want remembered." },
  { key: "interests", category: "interests", label: "Interests", question: "What interests or topics do you enjoy or want more help with?" },
  { key: "anything_else", category: "context", label: "Anything else", question: "Anything else that would make CoOperative more useful to you or help it understand how you work?" },
];

const BATCH_SIZE = 3;
const TOTAL_BATCHES = Math.ceil(USER_PROFILE_FIELD_DEFINITIONS.length / BATCH_SIZE);

function batchFields(batchIndex: number) {
  const safe = Math.max(0, Math.min(TOTAL_BATCHES - 1, batchIndex));
  return USER_PROFILE_FIELD_DEFINITIONS.slice(
    safe * BATCH_SIZE,
    safe * BATCH_SIZE + BATCH_SIZE,
  );
}

function questionText(batchIndex = 0) {
  const questions = batchFields(batchIndex);
  const intro =
    batchIndex === 0
      ? [
          "I’d like to get to know you a little so I can make future conversations more useful.",
          "I’ll ask only a few questions at a time. Numbering your answers 1–3 helps me map them exactly.",
          "For any question, say “I’ll tell you later” to defer it, or “skip” to leave it unknown until a later conversation fills it in.",
          "You can say “skip onboarding” at any time.",
          "",
        ]
      : [
          "Thanks. Here are the next few. Answer, say “later,” or skip anything you do not want to answer.",
          "",
        ];

  return [
    ...intro,
    ...questions.map((field, index) => `${index + 1}. ${field.question}`),
  ].join("\n");
}

function completionText() {
  return [
    "That’s enough to get started.",
    "Anything you answered is now structured profile context. Skipped values stay unknown, and deferred values stay marked for later.",
    "Normal conversation can fill or correct those fields later when you explicitly tell me something relevant.",
  ].join("\n");
}

function dismissedText() {
  return [
    "No problem — I’ll stop the get-to-know-you questions.",
    "Anything already answered stays saved. Unanswered fields remain unknown until a later conversation gives me something explicit to use.",
  ].join("\n");
}

function answerValue(value: string) {
  const text = value.trim();
  if (/^(?:later|tell you later|i'?ll tell you later|not now|maybe later|defer)$/i.test(text)) {
    return { status: "deferred" as const, value: null };
  }
  if (/^(?:skip|unknown|don'?t know|do not know|n\/a|na|none|pass)$/i.test(text)) {
    return { status: "unknown" as const, value: null };
  }
  return { status: "known" as const, value: text.slice(0, 2000) || null };
}

function parseBatchReply(message: string, fields: UserProfileFieldDefinition[]) {
  const normalized = message.trim();
  const matches = Array.from(
    normalized.matchAll(
      /(?:^|\s)([1-3])\s*[).:\-]\s*([\s\S]*?)(?=(?:\s+[1-3]\s*[).:\-])|$)/g,
    ),
  );

  if (matches.length) {
    const numbered = new Map<number, string>();
    for (const match of matches) {
      numbered.set(Number(match[1]), (match[2] || "").trim());
    }
    return fields.map((field, index) => {
      const raw = numbered.get(index + 1);
      return raw === undefined
        ? { fieldKey: field.key, status: "unknown" as const, value: null }
        : { fieldKey: field.key, ...answerValue(raw) };
    });
  }

  const lines = normalized.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  return fields.map((field, index) => {
    const raw = lines[index];
    return raw === undefined
      ? { fieldKey: field.key, status: "unknown" as const, value: null }
      : { fieldKey: field.key, ...answerValue(raw) };
  });
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
        .select("status,current_batch,conversation_id")
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

  return {
    status: session?.status || "not_started",
    currentBatch: Number(session?.current_batch || 0),
    conversationId: session?.conversation_id || null,
    totalBatches: TOTAL_BATCHES,
    fields: fields || [],
  };
}
