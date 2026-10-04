import "server-only";\n\nimport { answerPlatformFaq } from "@/lib/runtime/platform-faq";

export type CodeFirstChatDecision = {
  handled: boolean;
  text?: string;
  handler: string;
  routeReason: string;
  aiNeeded: boolean;
};

export type CodeFirstChatInput = {
  message: string;
  hasAttachments: boolean;
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

function normalized(message: string) {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

function exactGreeting(value: string) {
  return /^(?:hi|hello|hey|hey there|yo|good morning|good afternoon|good evening)[!.? ]*$/.test(
    value,
  );
}

function exactAcknowledgement(value: string) {
  return /^(?:thanks|thank you|thx|appreciate it|perfect|great|cool|nice|sounds good|got it|ok|okay)[!.? ]*$/.test(
    value,
  );
}

function asksCapabilities(value: string) {
  return (
    /\bwhat can (?:you|cooperative) do\b/.test(value) ||
    /\bwhat do (?:you|cooperative) do\b/.test(value) ||
    /\bshow (?:me )?(?:your )?capabilities\b/.test(value) ||
    /\bhelp menu\b/.test(value)
  );
}

function asksIdentity(value: string) {
  return /^(?:who are you|what are you|what is cooperative|who is cooperative)[?.! ]*$/.test(
    value,
  );
}

function asksAiUsagePolicy(value: string) {
  return (
    /\b(?:when|why|how) (?:do|would|will) you (?:use|call|invoke|route to) ai\b/.test(
      value,
    ) ||
    /\b(?:are|is) (?:you|this) using ai\b/.test(value) ||
    /\bdo you need ai\b/.test(value) ||
    /\bcode[- ]first\b/.test(value) ||
    /\bonly call (?:for )?ai\b/.test(value) ||
    /\bdefault to code\b/.test(value)
  );
}

function asksAiBalance(value: string) {
  return (
    /\b(?:what(?:'s| is)|show|tell me)\b.{0,24}\b(?:ai )?(?:balance|credits?)\b/.test(
      value,
    ) ||
    /\bhow much\b.{0,16}\b(?:ai )?(?:balance|credit|money)\b/.test(value) ||
    /\bpaid ai balance\b/.test(value)
  );
}

function asksBusinessScope(value: string) {
  return (
    /\bwhich business (?:is|are) (?:this|we)\b/.test(value) ||
    /\bwhat business is this for\b/.test(value) ||
    /\bcurrent business\b/.test(value) ||
    /\bactive business\b/.test(value)
  );
}

function asksExecutionPreference(value: string) {
  return (
    /\bwhat (?:mode|profile) (?:are we|am i|is this) (?:using|on)\b/.test(value) ||
    /\bcurrent (?:mode|profile)\b/.test(value) ||
    /\b(?:local )?(?:fast|quality) mode\b/.test(value)
  );
}

function asksOnboardingStatus(value: string) {
  return (
    /\b(?:is|what(?:'s| is))\b.{0,18}\b(?:intake|onboarding|profile setup)\b.{0,18}\b(?:status|complete|done|finished)\b/.test(
      value,
    ) ||
    /\bhow far (?:am i|are we)\b.{0,20}\b(?:intake|onboarding|profile setup)\b/.test(
      value,
    )
  );
}

export function handleCodeFirstChat(
  input: CodeFirstChatInput,
): CodeFirstChatDecision {
  const value = normalized(input.message);

  if (!value) {
    return {
      handled: false,
      handler: "code-first-escalation",
      routeReason: "The request contains no deterministic text intent to resolve.",
      aiNeeded: true,
    };
  }

  if (!input.hasAttachments) {
    const faq = answerPlatformFaq(input.message, input);
    if (faq) {
      return {
        handled: true,
        handler: faq.key,
        text: faq.text,
        routeReason: faq.routeReason,
        aiNeeded: false,
      };
    }
  }

  if (input.hasAttachments) {
    return {
      handled: false,
      handler: "code-first-escalation",
      routeReason:
        "The request includes attached content that needs model interpretation after deterministic attachment checks.",
      aiNeeded: true,
    };
  }

  if (asksAiUsagePolicy(value)) {
    return {
      handled: true,
      handler: "code-first-policy",
      text:
        "Code is always the first responder. CoOperative uses deterministic code and saved state for supported commands, intake, personal/business scope, settings, budgets, provider setup, routing, status checks, and other known workflows. AI is only called when code cannot fully fulfill the request. When AI is needed, owned/local capacity stays first, strict-free routes can follow when eligible, and paid AI is only eligible when the profile is funded and the request stays inside the approved spend cap.",
      routeReason:
        "A deterministic platform-policy handler fully answered how CoOperative decides whether AI is needed.",
      aiNeeded: false,
    };
  }

  if (asksAiBalance(value)) {
    const available = Number.isFinite(input.availableAiBalanceUsd)
      ? Math.max(0, input.availableAiBalanceUsd)
      : 0;
    return {
      handled: true,
      handler: "code-first-ai-balance",
      text: input.paidAiFunded
        ? `Your available CoOperative AI balance is $${available.toFixed(2)}. Paid AI can be considered when a request actually needs it, subject to the per-prompt cap and routing rules.`
        : `Your available CoOperative AI balance is $${available.toFixed(2)}. Paid AI is not currently eligible, so requests stay on code, owned/local, or eligible free routes.`,
      routeReason:
        "A deterministic balance handler answered from the already-loaded profile balance without invoking AI.",
      aiNeeded: false,
    };
  }

  if (asksBusinessScope(value)) {
    return {
      handled: true,
      handler: "code-first-business-scope",
      text: input.businessId
        ? `This request is currently scoped to ${input.businessName || "the selected business"}.`
        : "This request is currently scoped as Personal / no business.",
      routeReason:
        "A deterministic scope handler answered from the resolved personal/business request state.",
      aiNeeded: false,
    };
  }

  if (asksExecutionPreference(value)) {
    const profileLabel = input.profile === "quality" ? "Local Quality" : "Local Fast";
    const nodeLabel =
      input.nodeRouting === "require-node"
        ? "a required authorized Unison node"
        : input.nodeRouting === "prefer-owned"
          ? "owned/authorized Unison capacity first"
          : "normal local-first routing";
    return {
      handled: true,
      handler: "code-first-execution-preference",
      text: `If AI is needed, this chat is currently set to ${profileLabel} with ${nodeLabel}. Code still gets the first chance to answer before any model job is created.`,
      routeReason:
        "A deterministic routing-status handler answered from the current request settings.",
      aiNeeded: false,
    };
  }

  if (asksOnboardingStatus(value)) {
    const status = input.onboardingStatus || "not_started";
    const mode = input.onboardingMode ? ` ${input.onboardingMode}` : "";
    const phase = input.onboardingPhase ? ` (${input.onboardingPhase})` : "";
    return {
      handled: true,
      handler: "code-first-onboarding-status",
      text:
        status === "completed"
          ? `Your${mode} intake is completed${phase}.`
          : status === "in_progress"
            ? `Your${mode} intake is still in progress${phase}. You can continue it whenever you want.`
            : status === "dismissed"
              ? `Your${mode} intake is currently dismissed${phase}. You can restart it later.`
              : "Your get-to-know-you intake has not been completed yet. You can start Personal or Business intake whenever you want.",
      routeReason:
        "A deterministic onboarding-status handler answered from the saved intake state.",
      aiNeeded: false,
    };
  }

  if (asksCapabilities(value)) {
    return {
      handled: true,
      handler: "code-first-capabilities",
      text:
        "CoOperative can handle personal and business intake, durable profile/business context, budget and Model Mixer controls, service connections, local and Unison routing, media generation workflows, governed project work, and general chat. Supported state and workflow questions are answered directly from code when possible; open-ended reasoning, writing, analysis, or interpretation escalates to AI only when needed.",
      routeReason:
        "A deterministic capabilities handler fully answered the platform capability question.",
      aiNeeded: false,
    };
  }

  if (asksIdentity(value)) {
    return {
      handled: true,
      handler: "code-first-identity",
      text:
        "I’m CoOperative, the conversational layer for your personal and business workflows. I try deterministic code and saved state first, then use AI only for the parts that actually need model reasoning or generation.",
      routeReason:
        "A deterministic identity handler fully answered the platform identity question.",
      aiNeeded: false,
    };
  }

  if (exactGreeting(value)) {
    return {
      handled: true,
      handler: "code-first-greeting",
      text: "Hey! What would you like to work on?",
      routeReason:
        "A simple greeting was fully answered by deterministic code, so no model job was needed.",
      aiNeeded: false,
    };
  }

  if (exactAcknowledgement(value)) {
    return {
      handled: true,
      handler: "code-first-acknowledgement",
      text: "Got it.",
      routeReason:
        "A simple acknowledgement was fully answered by deterministic code, so no model job was needed.",
      aiNeeded: false,
    };
  }

  return {
    handled: false,
    handler: "code-first-escalation",
    routeReason:
      "No deterministic code handler can fully satisfy this request without guessing or reducing answer quality, so CoOperative may now escalate the unresolved work to AI under the existing routing and spend rules.",
    aiNeeded: true,
  };
}
