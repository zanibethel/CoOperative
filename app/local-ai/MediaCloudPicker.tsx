"use client";

import { useEffect, useState } from "react";

export type CloudMediaItem = {
  id: string;
  kind: "image" | "video";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  provider: string | null;
  model: string | null;
  prompt: string | null;
  createdAt: string;
  sourceJobId: string | null;
  previewUrl: string;
};

type Attachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
};

type Props = {
  open: boolean;
  disabled?: boolean;
  onClose: () => void;
  onAttached: (attachment: Attachment) => void;
};

export default function MediaCloudPicker({
  open,
  disabled,
  onClose,
  onAttached,
}: Props) {
  const [items, setItems] = useState<CloudMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setMessage("");

    void fetch("/api/local-ai/media-library", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          items?: CloudMediaItem[];
          error?: string;
          detail?: string;
        };
        if (!response.ok) {
          throw new Error(
            payload.detail || payload.error || "Could not load CoOperative Cloud.",
          );
        }
        if (!cancelled) setItems(payload.items || []);
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error ? error.message : "Could not load saved media.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  async function attach(item: CloudMediaItem) {
    if (disabled || workingId || item.kind !== "image") return;
    setWorkingId(item.id);
    setMessage("");
    try {
      const response = await fetch("/api/local-ai/media-library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "attach",
          mediaId: item.id,
        }),
      });
      const payload = (await response.json()) as {
        attachment?: Attachment;
        error?: string;
        detail?: string;
      };
      if (!response.ok || !payload.attachment) {
        throw new Error(
          payload.detail || payload.error || "Could not attach saved media.",
        );
      }
      onAttached(payload.attachment);
      onClose();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not attach saved media.",
      );
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <div
      className="cloud-media-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="CoOperative Cloud media"
      onClick={onClose}
    >
      <div
        className="cloud-media-picker"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cloud-media-picker-head">
          <div>
            <strong>CoOperative Cloud</strong>
            <small>Saved media stays available across conversations.</small>
          </div>
          <button type="button" onClick={onClose} aria-label="Close saved media">
            ×
          </button>
        </div>

        {loading ? <p>Loading saved media…</p> : null}
        {message ? <p className="error">{message}</p> : null}

        {!loading && !items.length ? (
          <div className="cloud-media-empty">
            Save generated media to CoOp Cloud and it will appear here.
          </div>
        ) : null}

        <div className="cloud-media-grid">
          {items.map((item) => (
            <article className="cloud-media-card" key={item.id}>
              <div className="cloud-media-preview">
                {item.kind === "image" ? (
                  <img
                    src={item.previewUrl}
                    alt={item.prompt || item.fileName}
                    loading="lazy"
                  />
                ) : (
                  <video
                    src={item.previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                  />
                )}
              </div>
              <div className="cloud-media-card-meta">
                <strong>{item.model || item.fileName}</strong>
                <small>
                  {new Date(item.createdAt).toLocaleString()}
                </small>
              </div>
              {item.kind === "image" ? (
                <button
                  type="button"
                  onClick={() => void attach(item)}
                  disabled={Boolean(disabled || workingId)}
                >
                  {workingId === item.id ? "Attaching…" : "Use in chat"}
                </button>
              ) : (
                <small className="cloud-media-video-note">
                  Saved video can be viewed here; chat attachment currently supports images.
                </small>
              )}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
