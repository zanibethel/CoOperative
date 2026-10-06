export type MediaRequestKind = "image" | "video";
export type VideoResolution = "360p" | "480p" | "540p" | "720p" | "1080p" | "4k";

export type MediaRequestPlan = {
  kind: MediaRequestKind;
  clarification: string | null;
  durationSeconds: number | null;
  aspectRatio: "16:9" | "9:16" | "1:1" | null;
  resolution: VideoResolution | null;
  audio: boolean | null;
};

const CREATE_VERBS = /\b(create|generate|make|render|produce|design|animate|provide)\b/i;
const DIRECT_MEDIA_REQUEST = /\b(i(?:'d| would) like|i want|give me)\b/i;

function normalizeMediaIntentText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-");
}
const IMAGE_NOUNS = /\b(image|picture|photo|portrait|illustration|graphic|poster|thumbnail)\b/i;
const VIDEO_NOUNS = /\b(video|clip|reel|animation|movie|film)\b|\b(?:youtube|instagram|tiktok)\s+short\b/i;
const AMBIGUOUS_MEDIA_NOUNS = /\b(ad|advertisement|commercial)\b/i;
const DESCRIPTIVE_MEDIA_PROMPT_LEAD =
  /^\s*(?:photorealistic|cinematic|editorial|studio|professional|realistic|stylized|illustrated|anime|watercolor|oil[- ]painting|3d|close[- ]?up|wide[- ]angle|macro|portrait|landscape)\b/i;
const DESCRIPTIVE_VISUAL_CUES =
  /\b(?:lighting|depth of field|camera|lens|composition|framing|background|foreground|skin texture|high detail|ultra[- ]?detailed|photorealistic|realistic|cinematic|editorial|portrait|illustration|render|no text)\b/i;

function descriptiveMediaPrompt(message: string) {
  const words = message.trim().split(/\s+/).filter(Boolean);
  if (words.length < 8) return false;

  const kind = mediaKindFrom(message);
  if (!kind) return false;

  return (
    DESCRIPTIVE_MEDIA_PROMPT_LEAD.test(message) ||
    DESCRIPTIVE_VISUAL_CUES.test(message)
  );
}
export type MediaAdultContentClass =
  | "sfw"
  | "adult_non_explicit"
  | "adult_explicit";

const ADULT_OUTPUT =
  /\b(nsfw|nudes?|nudity|naked|porn(?:ographic|ography)?|sexually explicit|explicit sexual|erotic|full[- ]?frontal|adult (?:content|image|photo|scene))\b/i;
const SEXUALLY_EXPLICIT_OUTPUT =
  /\b(porn(?:ographic|ography)?|sexually explicit|explicit sexual|sexual (?:activity|intercourse|act)|sex scene|graphic sexual)\b|\b(?:expose|exposes|exposed|show|shows|showing|display|displays)\b(?:\s+[a-z][a-z'-]*){0,5}\s+(?:breasts?|nipples?|genitals?|penis|vagina|vulva|anus)\b|\b(?:bare|exposed|visible|uncovered)\b(?:\s+[a-z][a-z'-]*){0,4}\s+(?:breasts?|nipples?|genitals?|penis|vagina|vulva|anus)\b/i;
const SFW_OUTPUT_CONSTRAINT =
  /\b(sfw|safe for work|no nudity|without nudity|not nsfw)\b/i;
const NON_EXPLICIT_CONSTRAINT =
  /\b(no explicit content|non[- ]?explicit|not sexually explicit|without explicit sexual content)\b/i;

export function adultMediaContentClass(
  message: string,
): MediaAdultContentClass {
  if (SFW_OUTPUT_CONSTRAINT.test(message)) return "sfw";

  if (SEXUALLY_EXPLICIT_OUTPUT.test(message)) {
    if (NON_EXPLICIT_CONSTRAINT.test(message)) {
      return ADULT_OUTPUT.test(message) ? "adult_non_explicit" : "sfw";
    }
    return "adult_explicit";
  }

  return ADULT_OUTPUT.test(message) ? "adult_non_explicit" : "sfw";
}

export function adultMediaOutputRequested(message: string) {
  return adultMediaContentClass(message) !== "sfw";
}

function durationFrom(message: string) {
  const match = message.match(/\b(\d{1,2})\s*(?:-\s*)?(?:seconds?|secs?|s)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 30 ? value : null;
}

function aspectFrom(message: string): MediaRequestPlan["aspectRatio"] {
  if (/\b(9:16|vertical|portrait|reel|tiktok|shorts?)\b/i.test(message)) return "9:16";
  if (/\b(16:9|landscape|widescreen|youtube)\b/i.test(message)) return "16:9";
  if (/\b(1:1|square)\b/i.test(message)) return "1:1";
  return null;
}

function resolutionFrom(message: string): VideoResolution | null {
  const match = message.match(/\b(360p|480p|540p|720p|1080p|4k)\b/i);
  return match ? (match[1].toLowerCase() as VideoResolution) : null;
}

function audioFrom(message: string): boolean | null {
  if (/\b(no audio|without audio|silent|mute|muted)\b/i.test(message)) return false;
  if (/\b(with audio|generate audio|include audio|sound|voice|dialogue|music)\b/i.test(message)) return true;
  return null;
}

function mediaKindFrom(message: string): MediaRequestKind | null {
  const hasImage = IMAGE_NOUNS.test(message);
  const hasVideo = VIDEO_NOUNS.test(message);

  // Explicit video language wins when the request clearly asks for motion, even
  // if it also mentions a source/reference image ("make a video from this image").
  if (hasVideo) return "video";
  if (hasImage) return "image";

  // "ad" and "commercial" describe purpose/style as often as they describe a
  // video. Do not silently turn them into video generation without a medium.
  if (AMBIGUOUS_MEDIA_NOUNS.test(message)) return null;

  return null;
}

export function planMediaRequest(message: string): MediaRequestPlan | null {
  const text = normalizeMediaIntentText(message).trim();
  if (!text) return null;

  const hasExplicitCreationIntent =
    CREATE_VERBS.test(text) || DIRECT_MEDIA_REQUEST.test(text);
  const hasDescriptivePromptIntent = descriptiveMediaPrompt(text);

  if (!hasExplicitCreationIntent && !hasDescriptivePromptIntent) {
    return null;
  }

  const kind = mediaKindFrom(text);
  if (!kind) return null;

  const durationSeconds = kind === "video" ? durationFrom(text) : null;
  const explicitAspectRatio = aspectFrom(text);
  const aspectRatio =
    kind === "video" ? explicitAspectRatio ?? "16:9" : explicitAspectRatio;
  const resolution = kind === "video" ? resolutionFrom(text) : null;
  const audio = kind === "video" ? audioFrom(text) : null;

  if (kind === "video" && !durationSeconds) {
    return {
      kind,
      durationSeconds,
      aspectRatio,
      resolution,
      audio,
      clarification:
        "Before I spend any video-generation credits, tell me how long it should be (for example 5 or 8 seconds). I’ll use the cheaper planning step first, then make one generation call. If you do not specify a format, I’ll use landscape 16:9.",
    };
  }

  return {
    kind,
    durationSeconds,
    aspectRatio,
    resolution,
    audio,
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
    if (plan.resolution) lines.push(`Resolution: ${plan.resolution}.`);
    if (plan.audio !== null) lines.push(`Generated audio: ${plan.audio ? "on" : "off"}.`);
  } else if (plan.aspectRatio) {
    lines.push(`Preferred aspect ratio: ${plan.aspectRatio}.`);
  }

  return lines.join("\n");
}
