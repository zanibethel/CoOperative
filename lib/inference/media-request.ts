export type MediaRequestKind = "image" | "video";

export type MediaRequestPlan = {
  kind: MediaRequestKind;
  clarification: string | null;
  durationSeconds: number | null;
  aspectRatio: "16:9" | "9:16" | "1:1" | null;
};

const CREATE_VERBS = /(create|generate|make|render|produce|design|animate)/i;
const IMAGE_NOUNS = /(image|picture|photo|portrait|illustration|graphic|poster|thumbnail)/i;
const VIDEO_NOUNS = /(video|clip|reel|short|animation|movie|commercial|ad)/i;

function durationFrom(message: string) {
  const match = message.match(/(d{1,2})s*(?:seconds?|secs?|s)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 30 ? value : null;
}

function aspectFrom(message: string): MediaRequestPlan["aspectRatio"] {
  if (/(9:16|vertical|portrait|reel|tiktok|shorts?)/i.test(message)) return "9:16";
  if (/(16:9|landscape|widescreen|youtube)/i.test(message)) return "16:9";
  if (/(1:1|square)/i.test(message)) return "1:1";
  return null;
}

export function planMediaRequest(message: string): MediaRequestPlan | null {
  const text = message.trim();
  if (!text || !CREATE_VERBS.test(text)) return null;

  const kind: MediaRequestKind | null = VIDEO_NOUNS.test(text)
    ? "video"
    : IMAGE_NOUNS.test(text)
      ? "image"
      : null;
  if (!kind) return null;

  const durationSeconds = kind === "video" ? durationFrom(text) : null;
  const aspectRatio = aspectFrom(text);

  if (kind === "video") {
    const missing: string[] = [];
    if (!durationSeconds) missing.push("duration");
    if (!aspectRatio) missing.push("format");

    if (missing.length > 0) {
      const details = [];
      if (missing.includes("duration")) details.push("how long it should be (for example 5 or 8 seconds)");
      if (missing.includes("format")) details.push("vertical 9:16, landscape 16:9, or square 1:1");
      return {
        kind,
        durationSeconds,
        aspectRatio,
        clarification:
          "Before I spend any video-generation credits, tell me " +
          details.join(" and ") +
          ". I’ll use the cheaper planning step first, then make one generation call.",
      };
    }
  }

  return {
    kind,
    durationSeconds,
    aspectRatio,
    clarification: null,
  };
}

export function mediaPromptWithResolvedControls(
  message: string,
  plan: MediaRequestPlan,
) {
  const lines = [message.trim()];

  if (plan.kind === "video") {
    if (plan.durationSeconds) lines.push(`Duration: ${plan.durationSeconds} seconds.`);
    if (plan.aspectRatio) lines.push(`Aspect ratio: ${plan.aspectRatio}.`);
  } else if (plan.aspectRatio) {
    lines.push(`Preferred aspect ratio: ${plan.aspectRatio}.`);
  }

  return lines.join("\n");
}
