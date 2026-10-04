import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase-admin";
import type { DirectConversationResult } from "@/lib/runtime/contracts";

type JsonRecord = Record<string, unknown>;

type BusinessRow = {
  id: string;
  organization_id: string;
  name: string;
  industry: string | null;
  team_size: number | null;
  profile: unknown;
};

type IntakeFieldKey =
  | "industry"
  | "teamSize"
  | "customerDescription"
  | "leadSources"
  | "dailyWork"
  | "repetitiveWork"
  | "tools"
  | "bottlenecks"
  | "humanApprovalAreas"
  | "websiteAndInquiryFlow"
  | "marketingAndSocial"
  | "bookingAndScheduling"
  | "aiUsageToday"
  | "aiServicesAndSpend"
  | "monthlyAiSpend"
  | "businessComputeAvailable"
  | "businessComputeDetails"
  | "localAiPreference"
  | "monthlyTechnologySpend"
  | "monthlyTechnologyBudget"
  | "maxCooperativeManagedSpend"
  | "targetSavingsPercent"
  | "costPriority";

type ParsedAnswer =
  | { ok: true; value: string | number | boolean }
  | { ok: false; clarification: string };

type IntakeDefinition = {
  key: IntakeFieldKey;
  question: string;
  isMissing: (business: BusinessRow, profile: JsonRecord) => boolean;
  parse: (answer: string) => ParsedAnswer;
};

const META_KEY = "__cooperative";
const START_PATTERN =
  /\b(start|continue|finish|update|complete|help with|do)\b.{0,28}\b(business )?(intake|onboarding|profile|setup)\b|\blearn (about )?my business\b|\bunderstand my business\b/i;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as JsonRecord) }
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function freeText(answer: string, label: string, min = 2): ParsedAnswer {
  const value = answer.trim();
  if (value.length < min) {
    return {
      ok: false,
      clarification: `Tell me a little more about ${label}. A short sentence is enough.`,
    };
  }
  return { ok: true, value: value.slice(0, 3000) };
}

function parseNumber(
  answer: string,
  label: string,
  options: { integer?: boolean; min?: number; max?: number } = {},
): ParsedAnswer {
  const match = answer.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return {
      ok: false,
      clarification: `I need a number for ${label}. You can answer with something like “500” or “$500”.`,
    };
  }

  let value = Number(match[0]);
  if (!Number.isFinite(value)) {
    return { ok: false, clarification: `I could not read that number for ${label}.` };
  }
  if (options.integer) value = Math.round(value);
  if (typeof options.min === "number" && value < options.min) {
    return { ok: false, clarification: `${label} must be at least ${options.min}.` };
  }
  if (typeof options.max === "number" && value > options.max) {
    return { ok: false, clarification: `${label} must be ${options.max} or less.` };
  }

  return { ok: true, value };
}

function parseAiUsage(answer: string): ParsedAnswer {
  const value = answer.toLowerCase();
  if (/\b(no|none|don't|do not|not using)\b/.test(value)) return { ok: true, value: "none" };
  if (/\b(mix|both|combination)\b/.test(value)) return { ok: true, value: "mixed" };
  if (/\b(local|own hardware|self[- ]?host)\b/.test(value)) return { ok: true, value: "local" };
  if (/\b(paid|chatgpt|claude|gemini|api|subscription|cloud)\b/.test(value)) {
    return { ok: true, value: "paid-services" };
  }
  if (/\b(unsure|not sure|don't know|do not know)\b/.test(value)) {
    return { ok: true, value: "unsure" };
  }
  return {
    ok: false,
    clarification:
      "Is your AI use mostly paid services, mostly local AI, a mix of both, none, or are you unsure?",
  };
}

function parseYesNoUnsure(answer: string): ParsedAnswer {
  const value = answer.toLowerCase().trim();
  if (/^(yes|y|yeah|yep|we do|i do|have one|have some)/.test(value)) {
    return { ok: true, value: "yes" };
  }
  if (/^(no|n|nope|we don't|we do not|i don't|i do not)/.test(value)) {
    return { ok: true, value: "no" };
  }
  if (/\b(unsure|not sure|don't know|do not know)\b/.test(value)) {
    return { ok: true, value: "unsure" };
  }
  return {
    ok: false,
    clarification: "Answer yes, no, or not sure.",
  };
}

function parseLocalPreference(answer: string): ParsedAnswer {
  const value = answer.toLowerCase();
  if (/\b(prefer|first|whenever)\b.*\b(own|local|our hardware)\b|\bprefer-owned\b/.test(value)) {
    return { ok: true, value: "prefer-owned" };
  }
  if (/\b(cloud|external)\b.*\b(first|prefer)\b|\bcloud-first\b/.test(value)) {
    return { ok: true, value: "cloud-first" };
  }
  if (/\b(open|flexible|good fit|when it makes sense)\b/.test(value)) {
    return { ok: true, value: "open-to-owned" };
  }
  if (/\b(unsure|not sure|don't know|do not know)\b/.test(value)) {
    return { ok: true, value: "unsure" };
  }
  return {
    ok: false,
    clarification:
      "Should I prefer your own hardware, use it when it is a good fit, prefer cloud services, or leave that undecided?",
  };
}

function parseCostPriority(answer: string): ParsedAnswer {
  const value = answer.toLowerCase();
  if (/\b(lowest|cheapest|save|cost first)\b/.test(value)) {
    return { ok: true, value: "lowest-cost" };
  }
  if (/\b(best fit|quality|performance first|best)\b/.test(value)) {
    return { ok: true, value: "best-fit" };
  }
  if (/\b(balance|balanced|middle)\b/.test(value)) {
    return { ok: true, value: "balanced" };
  }
  return {
    ok: false,
    clarification: "Should I prioritize lowest cost, a balance of cost and convenience, or best fit?",
  };
}

const FIELDS: IntakeDefinition[] = [
  {
    key: "industry",
    question: "What type of business is this?",
    isMissing: (business) => !textValue(business.industry),
    parse: (answer) => freeText(answer, "the type of business"),
  },
  {
    key: "teamSize",
    question: "How many people are on the team, including you?",
    isMissing: (business, profile) =>
      !(numberValue(profile.teamSize) ?? numberValue(business.team_size)),
    parse: (answer) => parseNumber(answer, "team size", { integer: true, min: 1, max: 100000 }),
  },
  {
    key: "customerDescription",
    question: "Who are your main customers, and what are they usually trying to get done?",
    isMissing: (_business, profile) => !textValue(profile.customerDescription),
    parse: (answer) => freeText(answer, "your customers", 6),
  },
  {
    key: "leadSources",
    question: "Where do new leads or customer requests usually come from?",
    isMissing: (_business, profile) => !textValue(profile.leadSources),
    parse: (answer) => freeText(answer, "where leads come from"),
  },
  {
    key: "dailyWork",
    question: "What does a normal workday look like for the business?",
    isMissing: (_business, profile) => !textValue(profile.dailyWork),
    parse: (answer) => freeText(answer, "a normal workday", 8),
  },
  {
    key: "repetitiveWork",
    question: "What work gets repeated over and over?",
    isMissing: (_business, profile) => !textValue(profile.repetitiveWork),
    parse: (answer) => freeText(answer, "repetitive work", 4),
  },
  {
    key: "tools",
    question: "What software, websites, or tools do you use to run the business today?",
    isMissing: (_business, profile) => !textValue(profile.tools),
    parse: (answer) => freeText(answer, "the tools you use"),
  },
  {
    key: "bottlenecks",
    question: "What regularly slows the business down or creates extra work?",
    isMissing: (_business, profile) => !textValue(profile.bottlenecks),
    parse: (answer) => freeText(answer, "the main bottlenecks", 4),
  },
  {
    key: "websiteAndInquiryFlow",
    question: "How do your website and customer inquiries work today?",
    isMissing: (_business, profile) => !textValue(profile.websiteAndInquiryFlow),
    parse: (answer) => freeText(answer, "your website or inquiry flow"),
  },
  {
    key: "marketingAndSocial",
    question: "How do you currently handle marketing and social media?",
    isMissing: (_business, profile) => !textValue(profile.marketingAndSocial),
    parse: (answer) => freeText(answer, "marketing and social media"),
  },
  {
    key: "bookingAndScheduling",
    question: "How do booking and scheduling work today?",
    isMissing: (_business, profile) => !textValue(profile.bookingAndScheduling),
    parse: (answer) => freeText(answer, "booking and scheduling"),
  },
  {
    key: "humanApprovalAreas",
    question: "What decisions or actions should always require a human approval?",
    isMissing: (_business, profile) => !textValue(profile.humanApprovalAreas),
    parse: (answer) => freeText(answer, "human approval boundaries"),
  },
  {
    key: "aiUsageToday",
    question: "How does the business use AI today: paid services, local AI, a mix, none, or not sure?",
    isMissing: (_business, profile) =>
      !textValue(profile.aiUsageToday) || profile.aiUsageToday === "unsure",
    parse: parseAiUsage,
  },
  {
    key: "aiServicesAndSpend",
    question: "Which AI tools do you use, and what do you use them for?",
    isMissing: (_business, profile) =>
      profile.aiUsageToday !== "none" && !textValue(profile.aiServicesAndSpend),
    parse: (answer) => freeText(answer, "your AI tools"),
  },
  {
    key: "monthlyAiSpend",
    question: "About how much do you spend on AI in a typical month?",
    isMissing: (_business, profile) =>
      profile.aiUsageToday !== "none" &&
      !factIsRecorded(profile, "monthlyAiSpend") &&
      !(numberValue(profile.monthlyAiSpend) ?? 0),
    parse: (answer) => parseNumber(answer, "monthly AI spend", { min: 0, max: 1000000 }),
  },
  {
    key: "businessComputeAvailable",
    question: "Does the business own a PC, workstation, server, or GPU that could run AI workloads?",
    isMissing: (_business, profile) =>
      !textValue(profile.businessComputeAvailable) || profile.businessComputeAvailable === "unsure",
    parse: parseYesNoUnsure,
  },
  {
    key: "businessComputeDetails",
    question: "What do you know about that hardware? If you do not know the specs, just say so.",
    isMissing: (_business, profile) =>
      profile.businessComputeAvailable === "yes" && !textValue(profile.businessComputeDetails),
    parse: (answer) => freeText(answer, "the available hardware"),
  },
  {
    key: "localAiPreference",
    question: "Should CoOperative prefer your own hardware, use it when it is a good fit, or prefer cloud services?",
    isMissing: (_business, profile) =>
      !textValue(profile.localAiPreference) || profile.localAiPreference === "unsure",
    parse: parseLocalPreference,
  },
  {
    key: "monthlyTechnologySpend",
    question: "About how much do you currently spend per month on technology and software?",
    isMissing: (_business, profile) =>
      !factIsRecorded(profile, "monthlyTechnologySpend") &&
      !(numberValue(profile.monthlyTechnologySpend) ?? 0),
    parse: (answer) =>
      parseNumber(answer, "monthly technology spend", { min: 0, max: 1000000 }),
  },
  {
    key: "monthlyTechnologyBudget",
    question: "What is the maximum total monthly technology budget you want me to respect?",
    isMissing: (_business, profile) =>
      !factIsRecorded(profile, "monthlyTechnologyBudget") &&
      !(numberValue(profile.monthlyTechnologyBudget) ?? 0),
    parse: (answer) =>
      parseNumber(answer, "monthly technology budget", { min: 0, max: 1000000 }),
  },
  {
    key: "maxCooperativeManagedSpend",
    question: "What is the maximum amount CoOperative may manage or spend per month without a new approval?",
    isMissing: (_business, profile) =>
      !factIsRecorded(profile, "maxCooperativeManagedSpend") &&
      !(numberValue(profile.maxCooperativeManagedSpend) ?? 0),
    parse: (answer) =>
      parseNumber(answer, "CoOperative-managed monthly spend", { min: 0, max: 1000000 }),
  },
  {
    key: "targetSavingsPercent",
    question: "What percentage reduction in technology cost should CoOperative aim for?",
    isMissing: (_business, profile) => numberValue(profile.targetSavingsPercent) === null,
    parse: (answer) => parseNumber(answer, "target savings percent", { min: 0, max: 95 }),
  },
  {
    key: "costPriority",
    question: "Should I optimize for lowest cost, balanced cost and convenience, or best fit?",
    isMissing: (_business, profile) => !textValue(profile.costPriority),
    parse: parseCostPriority,
  },
];

function metadata(profile: JsonRecord) {
  const existing = record(profile[META_KEY]);
  return {
    ...existing,
    facts: record(existing.facts),
    intake: record(existing.intake),
  };
}

function skippedFields(profile: JsonRecord) {
  const intake = record(metadata(profile).intake);
  return Array.isArray(intake.skippedFields)
    ? intake.skippedFields.filter((item): item is string => typeof item === "string")
    : [];
}

function deferredFields(profile: JsonRecord) {
  const intake = record(metadata(profile).intake);
  return Array.isArray(intake.deferredFields)
    ? intake.deferredFields.filter((item): item is string => typeof item === "string")
    : [];
}

function factIsRecorded(profile: JsonRecord, key: IntakeFieldKey) {
  const facts = record(metadata(profile).facts);
  return Boolean(record(facts[key]).updatedAt);
}

function activeField(profile: JsonRecord): IntakeFieldKey | null {
  const intake = record(metadata(profile).intake);
  const key = typeof intake.currentField === "string" ? intake.currentField : "";
  return FIELDS.some((field) => field.key === key) ? (key as IntakeFieldKey) : null;
}

function intakeIsActive(profile: JsonRecord) {
  return record(metadata(profile).intake).active === true;
}

function nextMissingField(business: BusinessRow, profile: JsonRecord) {
  const skipped = new Set([...skippedFields(profile), ...deferredFields(profile)]);
  return FIELDS.find((field) => !skipped.has(field.key) && field.isMissing(business, profile)) || null;
}

function withIntakeState(
  profile: JsonRecord,
  values: {
    active: boolean;
    currentField: IntakeFieldKey | null;
    conversationId: string;
    skippedFields?: string[];
  },
) {
  const meta = metadata(profile);
  const prior = record(meta.intake);
  const now = new Date().toISOString();

  return {
    ...profile,
    [META_KEY]: {
      ...meta,
      intake: {
        ...prior,
        active: values.active,
        currentField: values.currentField,
        conversationId: values.conversationId,
        skippedFields: values.skippedFields ?? skippedFields(profile),
        startedAt: prior.startedAt || now,
        updatedAt: now,
        version: "business-intake-v1",
      },
    },
  };
}

function withFact(
  profile: JsonRecord,
  field: IntakeFieldKey,
  value: string | number | boolean,
  conversationId: string,
) {
  const meta = metadata(profile);
  const facts = record(meta.facts);
  const now = new Date().toISOString();

  return {
    ...profile,
    [field]: value,
    [META_KEY]: {
      ...meta,
      facts: {
        ...facts,
        [field]: {
          source: "user",
          agent: "business-intake",
          method: "deterministic",
          confidence: 1,
          conversationId,
          updatedAt: now,
        },
      },
    },
  };
}

async function loadOwnedBusiness(userId: string, businessId: string) {
  const admin = createAdminSupabaseClient();
  const { data: organizations, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_user_id", userId);

  if (organizationError) throw organizationError;
  const organizationIds = (organizations || []).map((item) => item.id);
  if (organizationIds.length === 0) return null;

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select("id,organization_id,name,industry,team_size,profile")
    .eq("id", businessId)
    .in("organization_id", organizationIds)
    .maybeSingle();

  if (businessError) throw businessError;
  return (business || null) as BusinessRow | null;
}

async function saveBusiness(
  business: BusinessRow,
  profile: JsonRecord,
  field?: IntakeFieldKey,
  value?: string | number | boolean,
) {
  const admin = createAdminSupabaseClient();
  const updates: JsonRecord = {
    profile,
    updated_at: new Date().toISOString(),
  };

  if (field === "industry" && typeof value === "string") {
    updates.industry = value;
  }
  if (field === "teamSize" && typeof value === "number") {
    updates.team_size = value;
  }

  const { error } = await admin.from("businesses").update(updates).eq("id", business.id);
  if (error) throw error;
}

function questionText(business: BusinessRow, field: IntakeDefinition) {
  return `${field.question}\n\nI already have the information you've previously saved, so I'm only asking for what is missing. You can say “skip” or “stop intake” at any time.`;
}

export async function handleBusinessIntake(input: {
  userId: string;
  businessId?: string | null;
  conversationId: string;
  message: string;
  hasAttachments: boolean;
}): Promise<DirectConversationResult> {
  if (!input.businessId || input.hasAttachments) {
    return { handled: false, execution: "code" };
  }

  const business = await loadOwnedBusiness(input.userId, input.businessId);
  if (!business) return { handled: false, execution: "code" };

  let profile = record(business.profile);
  const active = intakeIsActive(profile);
  const startRequested = START_PATTERN.test(input.message.trim());

  if (!active && !startRequested) {
    return { handled: false, execution: "code" };
  }

  const lower = input.message.trim().toLowerCase();
  if (active && /^(stop|cancel|end|quit)( the)? (intake|onboarding|setup)?\.?$/.test(lower)) {
    profile = withIntakeState(profile, {
      active: false,
      currentField: null,
      conversationId: input.conversationId,
    });
    await saveBusiness(business, profile);
    return {
      handled: true,
      execution: "code",
      capability: "business.intake",
      agent: "business-intake",
      text: "Business intake stopped. Everything already saved stays on the business profile, and we can continue later.",
      routeReason: "Active business intake stopped by deterministic command.",
    };
  }

  if (!active) {
    const next = nextMissingField(business, profile);
    if (!next) {
      return {
        handled: true,
        execution: "code",
        capability: "business.intake",
        agent: "business-intake",
        text:
          "I already have the baseline business intake information saved. I won't ask you to repeat it. You can tell me what you want to accomplish next, and I'll use the saved business state.",
        routeReason: "Business intake requested, but no baseline fields are missing.",
      };
    }

    profile = withIntakeState(profile, {
      active: true,
      currentField: next.key,
      conversationId: input.conversationId,
    });
    await saveBusiness(business, profile);

    return {
      handled: true,
      execution: "code",
      capability: "business.intake",
      agent: "business-intake",
      text: questionText(business, next),
      routeReason: `Code-first intake selected next missing field: ${next.key}.`,
    };
  }

  let current = activeField(profile);
  let definition = current ? FIELDS.find((field) => field.key === current) || null : null;

  if (!definition) {
    definition = nextMissingField(business, profile);
    current = definition?.key || null;
  }

  if (!definition || !current) {
    profile = withIntakeState(profile, {
      active: false,
      currentField: null,
      conversationId: input.conversationId,
    });
    await saveBusiness(business, profile);

    return {
      handled: true,
      execution: "code",
      capability: "business.intake",
      agent: "business-intake",
      text:
        "Your baseline business intake is complete. I saved the structured information and will use it as business context instead of asking you for it again.",
      routeReason: "Business intake completed with no remaining baseline fields.",
    };
  }

  if (/^(skip|pass|skip this|not now)\.?$/.test(lower)) {
    const skipped = Array.from(new Set([...skippedFields(profile), current]));
    const profileAfterSkip = withIntakeState(profile, {
      active: true,
      currentField: null,
      conversationId: input.conversationId,
      skippedFields: skipped,
    });
    const next = nextMissingField(business, profileAfterSkip);
    profile = withIntakeState(profileAfterSkip, {
      active: Boolean(next),
      currentField: next?.key || null,
      conversationId: input.conversationId,
      skippedFields: skipped,
    });
    await saveBusiness(business, profile);

    return {
      handled: true,
      execution: "code",
      capability: "business.intake",
      agent: "business-intake",
      text: next
        ? `Skipped for now. ${questionText(business, next)}`
        : "Skipped. That's the end of the remaining baseline questions for now.",
      routeReason: `Skipped intake field ${current} without invoking AI.`,
    };
  }

  const parsed = definition.parse(input.message);
  if (!parsed.ok) {
    return {
      handled: true,
      execution: "code",
      capability: "business.intake",
      agent: "business-intake",
      text: parsed.clarification,
      routeReason: `Deterministic parser could not safely normalize ${current}; clarification requested instead of guessing or calling AI.`,
    };
  }

  profile = withFact(profile, current, parsed.value, input.conversationId);

  const nextBusiness: BusinessRow = {
    ...business,
    industry:
      current === "industry" && typeof parsed.value === "string"
        ? parsed.value
        : business.industry,
    team_size:
      current === "teamSize" && typeof parsed.value === "number"
        ? parsed.value
        : business.team_size,
    profile,
  };

  const next = nextMissingField(nextBusiness, profile);
  profile = withIntakeState(profile, {
    active: Boolean(next),
    currentField: next?.key || null,
    conversationId: input.conversationId,
  });

  await saveBusiness(business, profile, current, parsed.value);

  return {
    handled: true,
    execution: "code",
    capability: "business.intake",
    agent: "business-intake",
    text: next
      ? `Saved. ${questionText(nextBusiness, next)}`
      : "Saved. Your baseline business intake is complete. I'll use these structured facts in future workflows and only ask again if something changes or a specific goal needs more information.",
    routeReason: `Saved ${current} through deterministic business-intake capability.`,
    savedFacts: [current],
  };
}


export type BusinessIntakeBatchQuestion = {
  key: IntakeFieldKey;
  question: string;
};

export type BusinessIntakeBatchAnswer = {
  key: IntakeFieldKey;
  status: "known" | "unknown" | "deferred";
  value?: string | null;
};

export async function ownedBusinessesForOnboarding(userId: string) {
  const admin = createAdminSupabaseClient();
  const { data: organizations, error: organizationError } = await admin
    .from("organizations")
    .select("id,name")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  if (organizationError) throw organizationError;

  const organizationIds = (organizations || []).map((item) => item.id);
  if (!organizationIds.length) {
    return { organizations: [], businesses: [] as Array<{ id: string; name: string; industry: string | null }> };
  }

  const { data: businesses, error: businessError } = await admin
    .from("businesses")
    .select("id,organization_id,name,industry,updated_at")
    .in("organization_id", organizationIds)
    .order("updated_at", { ascending: false });
  if (businessError) throw businessError;

  return {
    organizations: organizations || [],
    businesses: (businesses || []).map((business) => ({
      id: business.id,
      name: business.name,
      industry: business.industry || null,
    })),
  };
}

export async function createBusinessFromOnboarding(input: {
  userId: string;
  name: string;
  industry?: string | null;
  teamSize?: number | null;
  conversationId: string;
}) {
  const admin = createAdminSupabaseClient();
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new Error("Business name is required before the business can be created.");

  const { organizations } = await ownedBusinessesForOnboarding(input.userId);
  let organizationId = organizations[0]?.id || null;

  if (!organizationId) {
    const { data: organization, error: organizationError } = await admin
      .from("organizations")
      .insert({
        owner_user_id: input.userId,
        name,
      })
      .select("id")
      .single();
    if (organizationError) throw organizationError;
    organizationId = organization.id;
  }

  const { data: existing, error: existingError } = await admin
    .from("businesses")
    .select("id,name,industry,team_size,profile")
    .eq("organization_id", organizationId)
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing) return existing.id as string;

  const now = new Date().toISOString();
  const profile: JsonRecord = {
    ...(input.teamSize ? { teamSize: Math.max(1, Math.round(input.teamSize)) } : {}),
    [META_KEY]: {
      facts: {
        ...(input.industry
          ? {
              industry: {
                source: "user",
                agent: "conversational-onboarding",
                method: "deterministic",
                confidence: 1,
                conversationId: input.conversationId,
                updatedAt: now,
              },
            }
          : {}),
        ...(input.teamSize
          ? {
              teamSize: {
                source: "user",
                agent: "conversational-onboarding",
                method: "deterministic",
                confidence: 1,
                conversationId: input.conversationId,
                updatedAt: now,
              },
            }
          : {}),
      },
      intake: {
        active: true,
        currentField: null,
        conversationId: input.conversationId,
        skippedFields: [],
        deferredFields: [],
        startedAt: now,
        updatedAt: now,
        version: "business-intake-v2",
      },
    },
  };

  const { data: business, error: businessError } = await admin
    .from("businesses")
    .insert({
      organization_id: organizationId,
      name,
      industry: input.industry?.trim().slice(0, 240) || "",
      team_size: input.teamSize ? Math.max(1, Math.round(input.teamSize)) : 1,
      profile,
    })
    .select("id")
    .single();
  if (businessError) throw businessError;

  return business.id as string;
}

export async function businessIntakeBatchForUser(input: {
  userId: string;
  businessId: string;
  limit?: number;
}) {
  const business = await loadOwnedBusiness(input.userId, input.businessId);
  if (!business) throw new Error("Business not found for this account.");

  const profile = record(business.profile);
  const excluded = new Set([...skippedFields(profile), ...deferredFields(profile)]);
  const questions = FIELDS.filter(
    (field) => !excluded.has(field.key) && field.isMissing(business, profile),
  )
    .slice(0, Math.max(1, Math.min(4, input.limit || 3)))
    .map((field) => ({ key: field.key, question: field.question }));

  return {
    business: {
      id: business.id,
      name: business.name,
      industry: business.industry,
    },
    questions,
    complete: questions.length === 0,
  };
}

export async function saveBusinessIntakeBatch(input: {
  userId: string;
  businessId: string;
  conversationId: string;
  answers: BusinessIntakeBatchAnswer[];
}) {
  const business = await loadOwnedBusiness(input.userId, input.businessId);
  if (!business) throw new Error("Business not found for this account.");

  let profile = record(business.profile);
  const savedFacts: string[] = [];
  const skipped = new Set(skippedFields(profile));
  const deferred = new Set(deferredFields(profile));

  for (const answer of input.answers) {
    const definition = FIELDS.find((field) => field.key === answer.key);
    if (!definition) continue;

    if (answer.status === "unknown") {
      skipped.add(answer.key);
      deferred.delete(answer.key);
      continue;
    }
    if (answer.status === "deferred") {
      deferred.add(answer.key);
      skipped.delete(answer.key);
      continue;
    }

    const raw = (answer.value || "").trim();
    if (!raw) continue;
    const parsed = definition.parse(raw);
    if (!parsed.ok) {
      return {
        ok: false as const,
        clarification: parsed.clarification,
        fieldKey: answer.key,
      };
    }

    profile = withFact(profile, answer.key, parsed.value, input.conversationId);
    skipped.delete(answer.key);
    deferred.delete(answer.key);
    savedFacts.push(answer.key);

    if (answer.key === "industry" && typeof parsed.value === "string") {
      business.industry = parsed.value;
    }
    if (answer.key === "teamSize" && typeof parsed.value === "number") {
      business.team_size = parsed.value;
    }
  }

  const meta = metadata(profile);
  profile = {
    ...profile,
    [META_KEY]: {
      ...meta,
      intake: {
        ...record(meta.intake),
        active: true,
        currentField: null,
        conversationId: input.conversationId,
        skippedFields: Array.from(skipped),
        deferredFields: Array.from(deferred),
        updatedAt: new Date().toISOString(),
        version: "business-intake-v2",
      },
    },
  };

  await saveBusiness(business, profile);
  if (business.industry) {
    await createAdminSupabaseClient()
      .from("businesses")
      .update({
        industry: business.industry,
        team_size: business.team_size || 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", business.id);
  }

  const next = await businessIntakeBatchForUser({
    userId: input.userId,
    businessId: input.businessId,
    limit: 3,
  });

  return {
    ok: true as const,
    savedFacts,
    ...next,
  };
}

export async function applyBusinessConversationUpdates(input: {
  userId: string;
  businessId: string;
  conversationId?: string | null;
  updates: Array<{
    fieldKey: string;
    value: string;
    confidence: number;
    explicitOwnerStatement: boolean;
  }>;
}) {
  const business = await loadOwnedBusiness(input.userId, input.businessId);
  if (!business) return [];

  let profile = record(business.profile);
  const saved: string[] = [];
  const conversationId = input.conversationId || crypto.randomUUID();

  for (const update of input.updates) {
    const definition = FIELDS.find((field) => field.key === update.fieldKey);
    if (
      !definition ||
      !update.explicitOwnerStatement ||
      update.confidence < 0.82 ||
      !update.value.trim()
    ) {
      continue;
    }

    const parsed = definition.parse(update.value);
    if (!parsed.ok) continue;

    profile = withFact(profile, definition.key, parsed.value, conversationId);
    saved.push(definition.key);

    if (definition.key === "industry" && typeof parsed.value === "string") {
      business.industry = parsed.value;
    }
    if (definition.key === "teamSize" && typeof parsed.value === "number") {
      business.team_size = parsed.value;
    }
  }

  if (!saved.length) return saved;

  await saveBusiness(business, profile);
  await createAdminSupabaseClient()
    .from("businesses")
    .update({
      industry: business.industry || "",
      team_size: business.team_size || 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", business.id);

  return saved;
}

export const BUSINESS_CONVERSATION_FIELD_KEYS = FIELDS.map((field) => field.key);
