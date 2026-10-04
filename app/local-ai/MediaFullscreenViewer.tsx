"use client";

import { useEffect, useMemo, useState } from "react";

export type FullscreenMedia = {
  kind: "image" | "video";
  url: string;
  jobId?: string | null;
  label?: string | null;
};

type Props = {
  media: FullscreenMedia | null;
  onClose: () => void;
};

async function exportFile(media: FullscreenMedia) {
  const params = new URLSearchParams();
  if (media.jobId) params.set("jobId", media.jobId);
  else params.set("mediaUrl", media.url);

  const response = await fetch(
    `/api/local-ai/media-export?${params.toString()}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; detail?: string }
      | null;
    throw new Error(
      payload?.detail || payload?.error || "Could not prepare media.",
    );
  }

  const blob = await response.blob();
  const headerName = response.headers.get("X-CoOperative-Filename");
  const extension =
    blob.type === "image/png"
      ? "png"
      : blob.type === "image/webp"
        ? "webp"
        : blob.type === "video/webm"
          ? "webm"
          : blob.type.startsWith("video/")
            ? "mp4"
            : "jpg";
  const fileName =
    headerName ||
    `cooperative-${media.kind}-${Date.now()}.${extension}`;
  return new File([blob], fileName, { type: blob.type || undefined });
}

function canShareFile(file: File) {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

export default function MediaFullscreenViewer({ media, onClose }: Props) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [working, setWorking] = useState("");
  const [message, setMessage] = useState("");
  const [savedCloud, setSavedCloud] = useState(false);

  useEffect(() => {
    if (!media) return;
    setControlsVisible(true);
    setWorking("");
    setMessage("");
    setSavedCloud(false);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [media, onClose]);

  const displayLabel = useMemo(
    () => media?.label || (media?.kind === "video" ? "Generated video" : "Generated image"),
    [media],
  );

  if (!media) return null;
  const activeMedia: FullscreenMedia = media;

  async function shareMedia() {
    if (working) return;
    setWorking("share");
    setMessage("");
    try {
      const file = await exportFile(activeMedia);
      if (canShareFile(file)) {
        await navigator.share({
          files: [file],
          title: displayLabel,
        });
        setMessage("Share sheet opened.");
      } else if (typeof navigator.share === "function") {
        await navigator.share({
          title: displayLabel,
          url: activeMedia.url,
        });
        setMessage("Share sheet opened.");
      } else {
        await navigator.clipboard.writeText(activeMedia.url);
        setMessage("Media link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(error instanceof Error ? error.message : "Could not share media.");
    } finally {
      setWorking("");
    }
  }

  async function saveToPhotos() {
    if (working) return;
    setWorking("photos");
    setMessage("");
    try {
      const file = await exportFile(activeMedia);

      // Mobile web apps cannot silently write to the iOS/Android photo library.
      // The native share sheet is the supported path to Save Image / Save Video.
      if (canShareFile(file)) {
        await navigator.share({
          files: [file],
          title: "Save to Photos",
        });
        setMessage("Choose Save Image or Save Video in the phone menu.");
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      setMessage("Media download started.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage(
        error instanceof Error ? error.message : "Could not save media.",
      );
    } finally {
      setWorking("");
    }
  }

  async function saveToCloud() {
    if (working || savedCloud) return;
    setWorking("cloud");
    setMessage("");
    try {
      const response = await fetch("/api/local-ai/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          jobId: activeMedia.jobId || undefined,
          mediaUrl: activeMedia.jobId ? undefined : activeMedia.url,
        }),
      });
      const payload = (await response.json()) as {
        saved?: boolean;
        alreadySaved?: boolean;
        error?: string;
        detail?: string;
      };
      if (!response.ok || !payload.saved) {
        throw new Error(
          payload.detail || payload.error || "Could not save to CoOperative Cloud.",
        );
      }
      setSavedCloud(true);
      setMessage(
        payload.alreadySaved
          ? "Already saved in CoOperative Cloud."
          : "Saved to CoOperative Cloud.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save to CoOperative Cloud.",
      );
    } finally {
      setWorking("");
    }
  }

  return (
    <div
      className="media-fullscreen-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={displayLabel}
      onClick={() => setControlsVisible((current) => !current)}
    >
      <div className="media-fullscreen-stage">
        {activeMedia.kind === "image" ? (
          <img src={activeMedia.url} alt={displayLabel} draggable={false} />
        ) : (
          <video
            src={activeMedia.url}
            controls={controlsVisible}
            playsInline
            autoPlay
            preload="metadata"
          />
        )}
      </div>

      <div
        className={
          controlsVisible
            ? "media-fullscreen-overlay visible"
            : "media-fullscreen-overlay"
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div className="media-fullscreen-topbar">
          <strong>{displayLabel}</strong>
          <button type="button" onClick={onClose} aria-label="Close media">
            ×
          </button>
        </div>

        <div className="media-fullscreen-actions">
          <button
            type="button"
            onClick={() => void saveToPhotos()}
            disabled={Boolean(working)}
          >
            {working === "photos" ? "Preparing…" : "Save to Photos"}
          </button>
          <button
            type="button"
            onClick={() => void shareMedia()}
            disabled={Boolean(working)}
          >
            {working === "share" ? "Preparing…" : "Share"}
          </button>
          <button
            type="button"
            onClick={() => void saveToCloud()}
            disabled={Boolean(working) || savedCloud}
          >
            {savedCloud
              ? "Saved to CoOp Cloud"
              : working === "cloud"
                ? "Saving…"
                : "Save to CoOp Cloud"}
          </button>
        </div>

        {message ? <div className="media-fullscreen-message">{message}</div> : null}
        <small className="media-fullscreen-hint">
          Tap the media to hide or show controls.
        </small>
      </div>
    </div>
  );
}
