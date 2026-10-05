import "server-only";

export type MediaRouteFailureStage =
  | "transport-uncertain"
  | "provider-response"
  | "post-provider";

export type MediaRouteOutcome =
  | { kind: "provider-policy"; safeToReroute: false }
  | { kind: "executor-policy"; safeToReroute: true }
  | { kind: "capability-refusal"; safeToReroute: true }
  | { kind: "retryable-technical"; safeToReroute: true }
  | { kind: "uncertain"; safeToReroute: false }
  | { kind: "fatal-configuration"; safeToReroute: false }
  | { kind: "technical-unknown"; safeToReroute: false };

export function classifyMediaRouteOutcome(input: {
  detail: string;
  status: number;
  failureStage: MediaRouteFailureStage;
}): MediaRouteOutcome {
  const detail = input.detail.toLowerCase();

  if (
    /content moderation|content policy|safety policy|safety filter|policy violation|request (?:was )?blocked|blocked (?:this |the )?request|unsafe content/.test(
      detail,
    )
  ) {
    return { kind: "provider-policy", safeToReroute: false };
  }

  if (
    /0 tool calls?|no tool call|not calling (?:the )?(?:image )?tool|won't call (?:the )?(?:image )?tool|orchestrator.+refus/.test(
      detail,
    )
  ) {
    return { kind: "executor-policy", safeToReroute: true };
  }

  if (
    /does not support|doesn't support|unsupported (?:input|modality|image|reference|operation)|image references? (?:are )?not supported|input_references?.+not supported|tool unavailable|model unavailable for this (?:input|operation)|invalid modality/.test(
      detail,
    )
  ) {
    return { kind: "capability-refusal", safeToReroute: true };
  }

  if (
    input.failureStage === "transport-uncertain" ||
    input.failureStage === "post-provider"
  ) {
    return { kind: "uncertain", safeToReroute: false };
  }

  if (
    input.status === 401 ||
    input.status === 403 ||
    /invalid (?:api )?key|authentication|unauthorized|forbidden|billing configuration|credential/.test(
      detail,
    )
  ) {
    return { kind: "fatal-configuration", safeToReroute: false };
  }

  if (
    [408, 409, 424, 429, 500, 502, 503, 504].includes(input.status) ||
    /rate limit|temporarily unavailable|service unavailable|gateway|overloaded|internal server error|upstream error/.test(
      detail,
    )
  ) {
    return { kind: "retryable-technical", safeToReroute: true };
  }

  return { kind: "technical-unknown", safeToReroute: false };
}
