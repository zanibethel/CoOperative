export type RecoveryStrategy =
  | "retry-route"
  | "repair-code"
  | "wait-user"
  | "observe";

export type RecoveryClassification = {
  errorClass: string;
  strategy: RecoveryStrategy;
  currentMessage: string;
  continuationPrompt: string;
  requiresUserAction: boolean;
  automaticRetry: boolean;
  publicDetail: string;
};

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

export function classifyRecoveryFailure(
  rawError: string,
  sourceKind: "text" | "media" | "connector" | "runtime",
): RecoveryClassification {
  const value = rawError.toLowerCase();

  if (
    includesAny(value, [
      "spend cap",
      "insufficient balance",
      "funded balance",
      "payment required",
      "billing",
    ])
  ) {
    return {
      errorClass: "spend_boundary",
      strategy: "wait-user",
      currentMessage:
        "Recovery Agent found a spending boundary and stopped before making a more expensive call.",
      continuationPrompt:
        "You can keep moving on the next part of the task while deciding whether to raise the budget.",
      requiresUserAction: true,
      automaticRetry: false,
      publicDetail:
        "The failure is controlled by a user-approved spending limit, so CoOperative will not work around it automatically.",
    };
  }

  if (
    includesAny(value, [
      "unauthorized",
      "forbidden",
      "oauth",
      "access token",
      "refresh token",
      "api key",
      "credential",
      "sign in",
      "reconnect",
      "permission",
      "scope",
    ])
  ) {
    return {
      errorClass: "authorization",
      strategy: "wait-user",
      currentMessage:
        "Recovery Agent traced this to an authorization or permission problem.",
      continuationPrompt:
        "While I keep the rest of the flow ready, you can tell me what you want to do immediately after this connection succeeds.",
      requiresUserAction: true,
      automaticRetry: false,
      publicDetail:
        "CoOperative can refresh stored credentials automatically when possible, but it will not bypass sign-in, consent, scopes, or permissions.",
    };
  }

  if (
    includesAny(value, [
      "429",
      "rate limit",
      "too many requests",
      "overloaded",
      "temporarily unavailable",
      "service unavailable",
    ])
  ) {
    return {
      errorClass: "provider_capacity",
      strategy: "retry-route",
      currentMessage:
        "Recovery Agent found a temporary provider-capacity issue and is looking for an equivalent free or already-approved route.",
      continuationPrompt:
        "You can keep chatting while that route recovers. If this step is part of a larger workflow, tell me what should happen after it succeeds.",
      requiresUserAction: false,
      automaticRetry: true,
      publicDetail:
        "This looks transient, so CoOperative can retry through an eligible route without changing permissions or spending limits.",
    };
  }

  if (
    includesAny(value, [
      "timeout",
      "timed out",
      "deadline",
      "lease expired",
      "worker unavailable",
      "worker failed",
      "capacity",
      "offline",
      "no fresh owned",
      "connection reset",
      "network error",
      "fetch failed",
    ])
  ) {
    return {
      errorClass: "transient_execution",
      strategy: "retry-route",
      currentMessage:
        "Recovery Agent found a transient execution failure and is retrying through the next eligible route.",
      continuationPrompt:
        "You do not need to wait here. Keep going with the next part of the task and I’ll report back when this route finishes recovering.",
      requiresUserAction: false,
      automaticRetry: true,
      publicDetail:
        "The failure appears temporary and does not require a code or permission change.",
    };
  }

  if (
    includesAny(value, [
      "model not found",
      "unsupported model",
      "model unavailable",
      "does not support",
      "unsupported parameter",
      "invalid model",
    ])
  ) {
    return {
      errorClass: "model_route",
      strategy: "retry-route",
      currentMessage:
        "Recovery Agent found an incompatible model route and is selecting another capable model within the same limits.",
      continuationPrompt:
        "You can continue with the next step while CoOperative repairs the model route in the background.",
      requiresUserAction: false,
      automaticRetry: true,
      publicDetail:
        "CoOperative can switch to another eligible model without broadening permissions or exceeding the selected spending ceiling.",
    };
  }

  if (
    includesAny(value, [
      "sandbox",
      "configuration",
      "config",
      "invariant",
      "schema",
      "unexpected",
      "internal server",
      "500",
      "502",
      "503",
      "could not start",
      "could not complete",
    ])
  ) {
    return {
      errorClass: "runtime_route",
      strategy: "repair-code",
      currentMessage:
        "Recovery Agent is tracing the failed runtime route in the background.",
      continuationPrompt:
        "You can keep the conversation moving. Tell me what you want to do immediately after this step succeeds, and I’ll pick this back up when the repair is ready.",
      requiresUserAction: false,
      automaticRetry: false,
      publicDetail:
        "This may require a bounded code or configuration repair, so CoOperative is escalating it to the debugger and verifier path.",
    };
  }

  return {
    errorClass: sourceKind === "connector" ? "connector_unknown" : "runtime_unknown",
    strategy: "repair-code",
    currentMessage:
      "Recovery Agent is diagnosing the failed route in the background.",
    continuationPrompt:
      "You can keep chatting instead of waiting. If there is a next step in the workflow, give it to me and I’ll continue around the blocked part where possible.",
    requiresUserAction: false,
    automaticRetry: false,
    publicDetail:
      "The failure is not yet recognized as a safe automatic retry, so CoOperative is collecting evidence before changing anything.",
  };
}
