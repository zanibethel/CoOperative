import "server-only";

export const PLATFORM_FAQ_REGISTRY_REVISION = "2026-10-04.1";

export type PlatformFaqContext = {
  profile: "fast" | "quality";
  nodeRouting: "default" | "prefer-owned" | "require-node";
  businessId?: string | null;
  businessName?: string | null;
  availableAiBalanceUsd: number;
  paidAiFunded: boolean;
  onboardingStatus?: string | null;
  onboardingMode?: string | null;
  onboardingPhase?: string | null;
};

export type PlatformFaqAnswer = {
  key: string;
  text: string;
  routeReason: string;
};

type PlatformFaqEntry = {
  key: string;
  matches: (value: string) => boolean;
  answer: (context: PlatformFaqContext) => string;
};

function normalized(message: string) {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function money(value: number) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `$${safe.toFixed(2)}`;
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export const PLATFORM_FAQ_REGISTRY: PlatformFaqEntry[] = [
  {
    key: "platform-code-first-policy",
    matches: (value) =>
      hasAny(value, [
        /\b(?:when|why|how) (?:do|would|will) you (?:use|call|invoke|route to) ai\b/,
        /\b(?:are|is) (?:you|this) using ai\b/,
        /\bdo you need ai\b/,
        /\bcode[- ]first\b/,
        /\bonly call (?:for )?ai\b/,
        /\bdefault to code\b/,
        /\bwhat can code answer\b/,
        /\bwhat does code handle\b/,
      ]),
    answer: () =>
      "Code is the default responder. CoOperative handles supported state lookups, settings, budgets, intake, scope, service setup, routing, status, fixed platform FAQs, and known workflows deterministically. AI is called only for the unresolved part when the request needs interpretation, reasoning, synthesis, creative generation, vision, or another capability code cannot fully provide. When AI is needed, owned/local capacity stays first, eligible free routes can follow, and paid AI is only considered when funded and inside the approved spend ceiling.",
  },
  {
    key: "platform-faq-index",
    matches: (value) =>
      hasAny(value, [
        /\b(?:platform|cooperative) faqs?\b/,
        /\bwhat (?:questions|things) can (?:code|the platform) answer\b/,
        /\bwhat can i ask about (?:the )?platform\b/,
        /\bshow (?:me )?(?:platform )?help\b/,
      ]),
    answer: () =>
      "Code can directly answer common CoOperative questions about AI usage, balances and spend caps, Model Mixer behavior, Personal vs Business scope, onboarding, local vs cloud routing, Unison nodes, Recovery Agent behavior, provider connections, API-key safety, media controls, SFW/NSFW behavior, chat history, and current Fast/Quality routing preferences. Known workflow commands and saved-state questions should also stay in code whenever the answer is already deterministic.",
  },
  {
    key: "platform-ai-balance",
    matches: (value) =>
      hasAny(value, [
        /\b(?:what(?:'s| is)|show|tell me)\b.{0,24}\b(?:ai )?(?:balance|credits?)\b/,
        /\bhow much\b.{0,16}\b(?:ai )?(?:balance|credit|money)\b/,
        /\bpaid ai balance\b/,
        /\bis paid ai (?:available|enabled|funded)\b/,
      ]),
    answer: (context) =>
      context.paidAiFunded
        ? `Your available CoOperative AI balance is ${money(context.availableAiBalanceUsd)}. Paid AI is eligible only when the request actually needs it and the estimated route stays within the per-prompt spend ceiling.`
        : `Your available CoOperative AI balance is ${money(context.availableAiBalanceUsd)}. Paid AI is not currently eligible, so requests stay on code, owned/local, or eligible free routes.`,
  },
  {
    key: "platform-disable-paid-ai",
    matches: (value) =>
      hasAny(value, [
        /\bhow (?:do|can) i (?:disable|turn off|block|prevent) paid ai\b/,
        /\bcan i (?:disable|turn off|block) paid ai\b/,
        /\bnever use paid ai\b/,
      ]),
    answer: () =>
      "Set the per-prompt spend ceiling to $0.00 to prevent paid-provider spend for chat requests. Code, owned/local execution, and eligible free routes can still be used when available.",
  },
  {
    key: "platform-model-mixer",
    matches: (value) =>
      hasAny(value, [
        /\bwhat is (?:the )?model mixer\b/,
        /\bhow does (?:the )?model mixer work\b/,
        /\bwhat do (?:economy|balanced|premium) mean\b/,
        /\bmodel mixer (?:help|settings|preset|presets)\b/,
      ]),
    answer: () =>
      "Model Mixer sets the request-level quality and spend ceiling rather than forcing every subtask onto one model. Economy, Balanced, Premium, or custom agent levels define how much capability CoOperative may use. Deterministic work still stays in code, and cheaper or free models can handle simpler subtasks while stronger models are reserved for work that materially benefits from them.",
  },
  {
    key: "platform-spend-cap-help",
    matches: (value) =>
      hasAny(value, [
        /\bhow (?:do|can) i (?:change|set|update) (?:my )?(?:spend|budget|prompt cap|spend cap)\b/,
        /\bwhat is (?:the )?(?:per[- ]prompt|prompt) spend (?:cap|limit|ceiling)\b/,
        /\bhow does (?:the )?(?:spend|budget) cap work\b/,
      ]),
    answer: () =>
      'The per-prompt spend cap is a hard ceiling for paid AI on a request, not a target. You can change it in chat with wording such as "set my max spend per prompt to 10 cents" or with the Model Mixer control. CoOperative may still complete the request for less by using code, local capacity, or free routes.',
  },
  {
    key: "platform-business-scope",
    matches: (value) =>
      hasAny(value, [
        /\bwhich business (?:is|are) (?:this|we)\b/,
        /\bwhat business is this for\b/,
        /\bcurrent business\b/,
        /\bactive business\b/,
        /\bis this personal or business\b/,
      ]),
    answer: (context) =>
      context.businessId
        ? `This request is currently scoped to ${context.businessName || "the selected business"}.`
        : "This request is currently scoped as Personal / no business.",
  },
  {
    key: "platform-personal-business-help",
    matches: (value) =>
      hasAny(value, [
        /\bhow does (?:personal|business) scope work\b/,
        /\bwhat does (?:personal|business) scope mean\b/,
        /\bhow do you know which business\b/,
        /\bhow do i switch (?:business|to personal)\b/,
        /\bpersonal vs business\b/,
      ]),
    answer: () =>
      "Personal is the safe default when no business is established. If you name a known business, code can resolve that scope before AI is considered. If the request could materially change based on scope and the business is ambiguous, CoOperative asks a short Personal-or-Business clarification instead of guessing.",
  },
  {
    key: "platform-onboarding-status",
    matches: (value) =>
      hasAny(value, [
        /\b(?:is|what(?:'s| is))\b.{0,18}\b(?:intake|onboarding|profile setup)\b.{0,18}\b(?:status|complete|done|finished)\b/,
        /\bhow far (?:am i|are we)\b.{0,20}\b(?:intake|onboarding|profile setup)\b/,
      ]),
    answer: (context) => {
      const status = context.onboardingStatus || "not_started";
      const mode = context.onboardingMode ? ` ${context.onboardingMode}` : "";
      const phase = context.onboardingPhase ? ` (${context.onboardingPhase})` : "";
      if (status === "completed") return `Your${mode} intake is completed${phase}.`;
      if (status === "in_progress") {
        return `Your${mode} intake is still in progress${phase}. You can continue it whenever you want.`;
      }
      if (status === "dismissed") {
        return `Your${mode} intake is currently dismissed${phase}. You can restart it later.`;
      }
      return "Your get-to-know-you intake has not been completed yet. You can start Personal or Business intake whenever you want.";
    },
  },
  {
    key: "platform-onboarding-help",
    matches: (value) =>
      hasAny(value, [
        /\bwhat is (?:the )?(?:intake|onboarding|get[- ]to[- ]know[- ]you)\b/,
        /\bhow does (?:the )?(?:intake|onboarding|get[- ]to[- ]know[- ]you) work\b/,
        /\bdo i have to (?:finish|complete) (?:the )?(?:intake|onboarding)\b/,
      ]),
    answer: () =>
      "The get-to-know-you flow saves useful Personal or Business context in small batches. It is optional and resumable: you can answer, say later, skip a question, or move on to another request. If a durable answer naturally comes up later, CoOperative can save it without forcing you back through the entire intake.",
  },
  {
    key: "platform-execution-preference",
    matches: (value) =>
      hasAny(value, [
        /\bwhat (?:mode|profile) (?:are we|am i|is this) (?:using|on)\b/,
        /\bcurrent (?:mode|profile)\b/,
        /\b(?:local )?(?:fast|quality) mode\b/,
        /\bwhat is (?:fast|quality) mode\b/,
        /\bfast vs quality\b/,
      ]),
    answer: (context) => {
      const profileLabel = context.profile === "quality" ? "Local Quality" : "Local Fast";
      const nodeLabel =
        context.nodeRouting === "require-node"
          ? "a required authorized Unison node"
          : context.nodeRouting === "prefer-owned"
            ? "owned/authorized Unison capacity first"
            : "normal local-first routing";
      return `If AI is needed, this chat is currently set to ${profileLabel} with ${nodeLabel}. Fast favors lower latency and cost; Quality allows a stronger local route when available. Code still gets the first chance to answer before any model job is created.`;
    },
  },
  {
    key: "platform-local-cloud-routing",
    matches: (value) =>
      hasAny(value, [
        /\bhow does (?:local|cloud) routing work\b/,
        /\blocal (?:ai )?(?:first|vs|or) cloud\b/,
        /\bwhat happens if (?:local ai|my pc|my node) (?:is|goes) (?:offline|unavailable|down)\b/,
        /\bwhen do you use (?:cloud|local ai|my pc)\b/,
      ]),
    answer: () =>
      "Routing starts with deterministic code. When AI is necessary, CoOperative prefers authorized owned/local capacity first. If that route is unavailable or insufficient, eligible community/free capacity can be considered, followed by paid cloud only when the profile is funded, policy allows it, and the request stays within its spend ceiling.",
  },
  {
    key: "platform-unison",
    matches: (value) =>
      hasAny(value, [
        /\bwhat is unison\b/,
        /\bwhat are unison nodes?\b/,
        /\bwhat is a (?:cooperative )?node\b/,
        /\bhow do nodes work\b/,
      ]),
    answer: () =>
      "Unison is CoOperative's distributed compute layer. Authorized computers can contribute eligible capacity so workloads can stay on user- or member-owned hardware before commercial cloud is considered. Node health, permissions, capabilities, and routing policy determine whether a node is eligible for a specific job.",
  },
  {
    key: "platform-node-routing",
    matches: (value) =>
      hasAny(value, [
        /\bwhat does prefer[- ]owned mean\b/,
        /\bwhat does require[- ]node mean\b/,
        /\bnode routing (?:modes?|settings?|help)\b/,
        /\bhow does node routing work\b/,
      ]),
    answer: () =>
      'Node routing supports normal local-first routing, "prefer owned" for prioritizing authorized owned capacity, and "require node" when a request should only proceed through the selected eligible node path. These are routing constraints; they do not make AI run when code can already answer the request.',
  },
  {
    key: "platform-recovery-agent",
    matches: (value) =>
      hasAny(value, [
        /\bwhat is (?:the )?recovery agent\b/,
        /\bhow does (?:the )?recovery agent work\b/,
        /\bwhat happens when (?:an ai|a model|a provider|a job) fails\b/,
        /\bhow do fallbacks work\b/,
      ]),
    answer: () =>
      "Recovery is a bounded fallback path for failed AI work. It can inspect the failed route and attempt an allowed alternative rather than silently repeating the same provider. Fallbacks still respect ownership preference, capability requirements, content policy, and the request's spend boundary.",
  },
  {
    key: "platform-provider-connect",
    matches: (value) =>
      hasAny(value, [
        /\bhow (?:do|can) i connect (?:a )?(?:provider|service|openrouter|nous)\b/,
        /\bwhere do i put (?:my )?(?:api key|provider key)\b/,
        /\bhow do provider connections work\b/,
      ]),
    answer: () =>
      'Ask CoOperative to connect the provider or service. The platform should route that through the secure connection flow rather than normal chat. Do not paste API keys into a chat message; the chat route deliberately blocks strings that look like credentials.',
  },
  {
    key: "platform-api-key-safety",
    matches: (value) =>
      hasAny(value, [
        /\bis it safe to paste (?:an |my )?api key\b/,
        /\bshould i paste (?:an |my )?api key\b/,
        /\bapi key (?:safety|security)\b/,
        /\bwhy (?:can't|cant|cannot) i paste (?:an |my )?api key\b/,
      ]),
    answer: () =>
      "Do not paste API keys into normal chat. CoOperative detects credential-like text and blocks it so provider secrets can be collected through the secure connection flow instead of being stored as ordinary conversation content.",
  },
  {
    key: "platform-media-generation",
    matches: (value) =>
      hasAny(value, [
        /\bcan (?:you|cooperative) generate (?:images?|videos?|media)\b/,
        /\bhow does (?:image|video|media) generation work\b/,
        /\bdoes cooperative make (?:images?|videos?)\b/,
      ]),
    answer: () =>
      "Yes. Media requests go through code-based planning first for scope, controls, budget, provider eligibility, content gates, and routing. The actual image or video generation is then sent only to an eligible media model or local worker because generation itself requires a model.",
  },
  {
    key: "platform-attachments",
    matches: (value) =>
      hasAny(value, [
        /\bwhat happens when i attach (?:an )?image\b/,
        /\bhow do image attachments work\b/,
        /\bdo attachments use ai\b/,
        /\bwhy does an attachment need ai\b/,
      ]),
    answer: () =>
      "Code handles attachment ownership, conversation association, and routing checks. Understanding the pixels in an attached image requires vision/model interpretation, so an attachment question can legitimately escalate after the deterministic checks are complete.",
  },
  {
    key: "platform-content-controls",
    matches: (value) =>
      hasAny(value, [
        /\bhow does (?:sfw|nsfw) work\b/,
        /\bwhat does (?:sfw|nsfw) mean in (?:the )?model mixer\b/,
        /\bnsfw (?:setting|settings|controls?)\b/,
        /\bsfw (?:setting|settings|controls?)\b/,
      ]),
    answer: () =>
      "Media defaults to SFW behavior. That means the requested output must stay SFW; it does not disqualify a model merely because that model is capable of other content. When NSFW is explicitly enabled, the additional Allowed, Prefer, or Required preference can guide eligible media-model selection, subject to the platform's content and provider gates.",
  },
  {
    key: "platform-chat-history",
    matches: (value) =>
      hasAny(value, [
        /\bdoes (?:cooperative|this) save (?:my )?chat history\b/,
        /\bhow does (?:chat )?history work\b/,
        /\bare conversations saved\b/,
        /\bwhat gets saved from chats\b/,
      ]),
    answer: () =>
      "CoOperative stores conversation messages and can persist supported durable Personal or Business facts separately from the raw turn. Business context is scoped to the selected business, and a Personal/no-business request does not automatically load the first business.",
  },
  {
    key: "platform-project-work",
    matches: (value) =>
      hasAny(value, [
        /\bcan (?:you|cooperative) work on (?:my )?(?:project|code|repo|repository)\b/,
        /\bhow does project work work\b/,
        /\bwhat is (?:the )?project agent\b/,
      ]),
    answer: () =>
      "CoOperative has a governed project capability for approved project work. Code should handle project state, permissions, workflow checks, and simple transformations first; model reasoning is reserved for work such as planning, code generation, analysis, or verification that actually benefits from it.",
  },
  {
    key: "platform-identity",
    matches: (value) =>
      /^(?:who are you|what are you|what is cooperative|who is cooperative)[?.! ]*$/.test(
        value,
      ),
    answer: () =>
      "I’m CoOperative, the conversational layer for personal and business workflows. I use deterministic application logic and saved state first, then call specialized AI capabilities only for the parts that actually need them.",
  },
  {
    key: "platform-capabilities",
    matches: (value) =>
      hasAny(value, [
        /\bwhat can (?:you|cooperative) do\b/,
        /\bwhat do (?:you|cooperative) do\b/,
        /\bshow (?:me )?(?:your )?capabilities\b/,
      ]),
    answer: () =>
      "CoOperative can handle Personal and Business intake, durable scoped context, budget and Model Mixer controls, secure service-connection flows, local and Unison routing, media workflows, governed project work, recovery/fallback routing, and general conversation. Supported platform/state questions stay in code; open-ended reasoning, writing, analysis, generation, or interpretation escalates only when needed.",
  },
];

export function answerPlatformFaq(
  message: string,
  context: PlatformFaqContext,
): PlatformFaqAnswer | null {
  const value = normalized(message);
  if (!value) return null;

  const match = PLATFORM_FAQ_REGISTRY.find((entry) => entry.matches(value));
  if (!match) return null;

  return {
    key: match.key,
    text: match.answer(context),
    routeReason: `A deterministic platform FAQ handler (${match.key}) fully answered the request without invoking AI.`,
  };
}
