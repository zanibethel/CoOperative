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

const CREATE_VERBS = /\b(create|generate|make|render|produce|design|animate)\b/i;
const IMAGE_NOUNS = /\b(image|picture|photo|portrait|illustration|graphic|poster|thumbnail)\b/i;
const VIDEO_NOUNS = /\b(video|clip|reel|animation|movie|film)\b|\b(?:youtube|instagram|tiktok)\s+short\b/i;
const AMBIGUOUS_MEDIA_NOUNS = /\b(ad|advertisement|commercial)\b/i;

function durationFrom(message: string) {
  const match = message.match(/\b(\d{1,2})\s*(?:seconds?|secs?|s)\b/i);
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
  const text = message.trim();
  if (!text || !CREATE_VERBS.test(text)) return null;

  const kind = mediaKindFrom(text);
  if (!kind) return null;

  const durationSeconds = kind === "video" ? durationFrom(text) : null;
  const aspectRatio = aspectFrom(text);
  const resolution = kind === "video" ? resolutionFrom(text) : null;
  const audio = kind === "video" ? audioFrom(text) : null;

  if (kind === "video") {
    const missing: string[] = [];
    if (!durationSeconds) missing.push("duration");
    if (!aspectRatio) missing.push("format");

    if (missing.length > 0) {
      const details: string[] = [];
      if (missing.includes("duration")) {
        details.push("how long it should be (for example 5 or 8 seconds)");
      }
      if (missing.includes("format")) {
        details.push("vertical 9:16, landscape 16:9, or square 1:1");
      }
      return {
        kind,
        durationSeconds,
        aspectRatio,
        resolution,
        audio,
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
