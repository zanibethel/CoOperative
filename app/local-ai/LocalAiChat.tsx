"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

type Profile = "fast" | "quality";

type ImageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl: string;
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
  jobId?: string | null;
  createdAt?: string;
};

type ConversationSummary = {
  id: string;
  title: string;
  profile: Profile;
  createdAt?: string;
  updatedAt?: string;
};

type ConversationResult = {
  conversation?: ConversationSummary;
  conversations?: ConversationSummary[];
  messages?: ChatMessage[];
  error?: string;
  detail?: string;
};

type AttachmentResult = {
  attachment?: ImageAttachment;
  error?: string;
  detail?: string;
};

type JobResult = {
  jobId?: string;
  status?: string;
  profile?: Profile;
  capability?: "text" | "vision";
  conversationId?: string | null;
  conversationTitle?: string | null;
  messages?: unknown;
  partialText?: string | null;
  text?: string | null;
  model?: string | null;
  firstTokenMs?: number | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
  detail?: string | null;
};

const ACTIVE_JOB_KEY = "cooperative.local-ai.active-job";
const MAX_ATTACHMENTS = 4;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1800;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.filter((message): message is ChatMessage => {
    if (!message || typeof message !== "object") return false;
    const candidate = message as { role?: unknown; content?: unknown };
    return (
      (candidate.role === "user" || candidate.role === "assistant") &&
      typeof candidate.content === "string"
    );
  });
}

function resultMeta(result: JobResult) {
  const details = [
    result.capability === "vision" ? "Local Vision" : null,
    result.model,
    typeof result.firstTokenMs === "number"
      ? `${(result.firstTokenMs / 1000).toFixed(1)}s first token`
      : null,
    typeof result.latencyMs === "number"
      ? `${(result.latencyMs / 1000).toFixed(1)}s`
      : null,
    typeof result.promptTokens === "number" && typeof result.outputTokens === "number"
      ? `${result.promptTokens} in / ${result.outputTokens} out`
      : null,
  ].filter(Boolean);

  return details.join(" · ");
}

function loadBrowserImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image format could not be read on this device."));
    };
    image.src = url;
  });
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not prepare image for upload."));
      },
      mimeType,
      quality,
    );
  });
}

async function prepareImage(file: File) {
  const directlySupported = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (directlySupported.has(file.type) && file.size <= MAX_UPLOAD_BYTES) {
    return file;
  }

  const image = await loadBrowserImage(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare image for upload.");

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.9;
  let blob = await canvasBlob(canvas, "image/jpeg", quality);
  while (blob.size > MAX_UPLOAD_BYTES && quality > 0.5) {
    quality -= 0.1;
    blob = await canvasBlob(canvas, "image/jpeg", quality);
  }

  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is still too large after compression.");
  }

  const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
}

export default function LocalAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState("New chat");
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<Profile>("fast");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const activePollRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshConversations = useCallback(async () => {
    const response = await fetch("/api/local-ai/conversations", { cache: "no-store" });
    const result = (await response.json()) as ConversationResult;
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load conversations.");
    }

    const items = result.conversations || [];
    setConversations(items);
    return items;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const response = await fetch(
      `/api/local-ai/conversations?id=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    const result = (await response.json()) as ConversationResult;

    if (!response.ok || !result.conversation) {
      throw new Error(result.detail || result.error || "Could not load conversation.");
    }

    setConversationId(result.conversation.id);
    setConversationTitle(result.conversation.title);
    setProfile(result.conversation.profile);
    setMessages(result.messages || []);
    setAttachments([]);
    setMeta("");
    setError("");
  }, []);

  const pollJob = useCallback(
    async (jobId: string, fallbackMessages: ChatMessage[] = []) => {
      if (activePollRef.current === jobId) return;

      activePollRef.current = jobId;
      setActiveJobId(jobId);
      setStreamingText("");
      setBusy(true);
      setError("");

      try {
        for (;;) {
          const response = await fetch(
            `/api/local-ai/chat?jobId=${encodeURIComponent(jobId)}`,
            { cache: "no-store" },
          );
          const result = (await response.json()) as JobResult;

          if (activePollRef.current !== jobId) return;

          if (!response.ok) {
            throw new Error(result.detail || result.error || "Could not read local AI job.");
          }

          if (result.profile === "fast" || result.profile === "quality") {
            setProfile(result.profile);
          }

          if (result.conversationId) {
            setConversationId(result.conversationId);
          }
          if (typeof result.partialText === "string") {
            setStreamingText(result.partialText);
          }

          const runningLabel =
            result.capability === "vision" ? "Running Vision on your Mac" : "Running on your Mac";

          if (result.status === "queued") {
            setStatus(
              result.capability === "vision"
                ? "Queued for Local Vision"
                : "Queued for your Mac",
            );
            await wait(1500);
            continue;
          }

          if (result.status === "running") {
            setStatus(runningLabel);
            await wait(1500);
            continue;
          }

          if (result.status === "cancelled") {
            setStreamingText("");
            setStatus("Ready");
            window.localStorage.removeItem(ACTIVE_JOB_KEY);
            if (result.conversationId) {
              await loadConversation(result.conversationId);
              await refreshConversations();
            }
            break;
          }

          if (result.status === "completed") {
            if (result.conversationId) {
              await loadConversation(result.conversationId);
              await refreshConversations();
            } else {
              const persistedMessages = readMessages(result.messages);
              const baseMessages =
                persistedMessages.length > 0 ? persistedMessages : fallbackMessages;
              setMessages(
                result.text
                  ? [...baseMessages, { role: "assistant", content: result.text }]
                  : baseMessages,
              );
            }

            setStreamingText("");
            setMeta(resultMeta(result));
            setStatus("Ready");
            window.localStorage.removeItem(ACTIVE_JOB_KEY);
            break;
          }

          throw new Error(
            result.error ||
              `Local AI job ended with status ${result.status || "unknown"}.`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Local AI request failed.");
        setStatus("Ready");
      } finally {
        if (activePollRef.current === jobId) {
          activePollRef.current = null;
          setActiveJobId(null);
          setBusy(false);
        }
      }
    },
    [loadConversation, refreshConversations],
  );

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const threads = await refreshConversations();
        const savedJobId = window.localStorage.getItem(ACTIVE_JOB_KEY);

        if (savedJobId) {
          const activeResponse = await fetch(
            `/api/local-ai/chat?jobId=${encodeURIComponent(savedJobId)}`,
            { cache: "no-store" },
          );
          const active = (await activeResponse.json()) as JobResult;

          if (activeResponse.ok && active.jobId) {
            if (active.conversationId) {
              await loadConversation(active.conversationId);
            } else {
              const persistedMessages = readMessages(active.messages);
              if (persistedMessages.length > 0) setMessages(persistedMessages);
            }
            if (active.profile === "fast" || active.profile === "quality") {
              setProfile(active.profile);
            }
            await pollJob(active.jobId, readMessages(active.messages));
            return;
          }

          window.localStorage.removeItem(ACTIVE_JOB_KEY);
        }

        const activeResponse = await fetch("/api/local-ai/chat", { cache: "no-store" });
        if (!cancelled && activeResponse.status !== 204) {
          const active = (await activeResponse.json()) as JobResult;
          if (activeResponse.ok && active.jobId) {
            if (active.conversationId) {
              await loadConversation(active.conversationId);
            }
            window.localStorage.setItem(ACTIVE_JOB_KEY, active.jobId);
            await pollJob(active.jobId, readMessages(active.messages));
            return;
          }
        }

        if (!cancelled && threads[0]) {
          await loadConversation(threads[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load Local AI.");
          setStatus("Ready");
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
      activePollRef.current = null;
    };
  }, [loadConversation, pollJob, refreshConversations]);

  async function removeAttachment(attachment: ImageAttachment) {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    try {
      await fetch(
        `/api/local-ai/attachments?id=${encodeURIComponent(attachment.id)}`,
        { method: "DELETE" },
      );
    } catch {
      // The server can clean an unattached upload later; keep the UI responsive.
    }
  }

  async function discardPendingAttachments() {
    const pending = [...attachments];
    setAttachments([]);
    await Promise.allSettled(
      pending.map((attachment) =>
        fetch(
          `/api/local-ai/attachments?id=${encodeURIComponent(attachment.id)}`,
          { method: "DELETE" },
        ),
      ),
    );
  }

  async function newChat() {
    if (busy) return;
    await discardPendingAttachments();
    setConversationId(null);
    setConversationTitle("New chat");
    setMessages([]);
    setInput("");
    setMeta("");
    setError("");
    setStatus("Ready");
  }

  async function switchConversation(id: string) {
    if (busy) return;
    await discardPendingAttachments();
    await loadConversation(id);
  }

  async function deleteConversation() {
    if (!conversationId || busy) return;
    if (!window.confirm(`Delete “${conversationTitle}”?`)) return;

    try {
      await discardPendingAttachments();
      const response = await fetch(
        `/api/local-ai/conversations?id=${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
      const result = (await response.json()) as ConversationResult;
      if (!response.ok) {
        throw new Error(result.detail || result.error || "Could not delete conversation.");
      }

      const remaining = await refreshConversations();
      if (remaining[0]) {
        await loadConversation(remaining[0].id);
      } else {
        setConversationId(null);
        setConversationTitle("New chat");
        setMessages([]);
        setMeta("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete conversation.");
    }
  }

  async function cancelJob() {
    if (!activeJobId) return;

    setStatus("Stopping…");
    try {
      const response = await fetch("/api/local-ai/chat/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId }),
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string; detail?: string };
        throw new Error(result.detail || result.error || "Could not stop Local AI.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop Local AI.");
    }
  }

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setStatus("Copied");
      window.setTimeout(() => setStatus("Ready"), 1200);
    } catch {
      setError("Could not copy this message.");
    }
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0 || busy) return;

    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    const selected = files.slice(0, remainingSlots);
    if (selected.length === 0) {
      setError("You can attach up to 4 images to one message.");
      return;
    }

    setUploadingImages(true);
    setError("");

    try {
      for (const file of selected) {
        if (!file.type.startsWith("image/")) {
          throw new Error("Only image files can be attached right now.");
        }

        const prepared = await prepareImage(file);
        const form = new FormData();
        form.append("file", prepared);

        const response = await fetch("/api/local-ai/attachments", {
          method: "POST",
          body: form,
        });
        const result = (await response.json()) as AttachmentResult;

        if (!response.ok || !result.attachment) {
          throw new Error(
            result.detail || result.error || "Could not upload image attachment.",
          );
        }

        setAttachments((current) => [...current, result.attachment!].slice(0, MAX_ATTACHMENTS));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not attach image.");
    } finally {
      setUploadingImages(false);
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy || uploadingImages) return;

    const currentAttachments = [...attachments];
    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      attachments: currentAttachments,
    };
    const fallbackMessages = [...messages, userMessage];

    setMessages(fallbackMessages);
    setInput("");
    setError("");
    setMeta("");
    setStreamingText("");
    setBusy(true);
    setStatus(currentAttachments.length > 0 ? "Queued for Local Vision" : "Queued for your Mac");

    try {
      const queuedResponse = await fetch("/api/local-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: text,
          attachmentIds: currentAttachments.map((attachment) => attachment.id),
          profile,
          maxTokens: profile === "quality" ? 1200 : 768,
          temperature: 0.2,
        }),
      });

      const queued = (await queuedResponse.json()) as JobResult;
      if (!queuedResponse.ok || !queued.jobId) {
        throw new Error(queued.detail || queued.error || "Could not queue local AI job.");
      }

      setAttachments([]);
      if (queued.conversationId) {
        setConversationId(queued.conversationId);
      }
      if (queued.conversationTitle) {
        setConversationTitle(queued.conversationTitle);
      }

      await refreshConversations();
      window.localStorage.setItem(ACTIVE_JOB_KEY, queued.jobId);
      await pollJob(queued.jobId, fallbackMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Local AI request failed.");
      setStatus("Ready");
      setBusy(false);
      setAttachments(currentAttachments);
    }
  }

  return (
    <section className="local-ai-layout">
      <div className="local-ai-threadbar card">
        <label className="field local-ai-thread-select">
          <span>Conversation</span>
          <select
            value={conversationId || ""}
            onChange={(event) => {
              const id = event.target.value;
              if (!id) {
                void newChat();
              } else {
                void switchConversation(id);
              }
            }}
            disabled={busy || uploadingImages}
          >
            <option value="">New chat</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
        </label>
        <div className="local-ai-thread-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void newChat()}
            disabled={busy || uploadingImages}
          >
            New chat
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => void deleteConversation()}
            disabled={busy || !conversationId || uploadingImages}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="local-ai-toolbar card">
        <div>
          <strong>{conversationTitle}</strong>
          <p>
            Runs on the connected Mac. Images automatically switch to Local Vision.
            No paid model fallback from this screen.
          </p>
        </div>
        <label className="field">
          <span>Text profile</span>
          <select
            value={profile}
            onChange={(event) => setProfile(event.target.value as Profile)}
            disabled={busy}
          >
            <option value="fast">Local Fast · Qwen3 4B</option>
            <option value="quality">Local Quality · Qwen2.5 7B</option>
          </select>
        </label>
        <div className="local-ai-status">
          <span className={busy ? "status-dot active" : "status-dot"} />
          {status}
        </div>
      </div>

      <div className="local-ai-chat card">
        <div className="local-ai-messages">
          {messages.length === 0 ? (
            <div className="local-ai-empty">
              <strong>CoOperative AI Local</strong>
              <p>
                Ask anything or attach a screenshot/photo. Conversations and images
                stay tied to your saved thread.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
                key={message.id || `${message.role}-${index}`}
              >
                <div className="chat-bubble-head">
                  <span>{message.role === "user" ? "You" : "CoOperative AI"}</span>
                  {message.content ? (
                    <button
                      className="message-action"
                      type="button"
                      onClick={() => void copyMessage(message.content)}
                      aria-label="Copy message"
                    >
                      Copy
                    </button>
                  ) : null}
                </div>
                {message.attachments && message.attachments.length > 0 ? (
                  <div className="chat-attachments">
                    {message.attachments.map((attachment) => (
                      <img
                        key={attachment.id}
                        src={attachment.previewUrl}
                        alt={attachment.fileName}
                        loading="lazy"
                      />
                    ))}
                  </div>
                ) : null}
                {message.content ? <div>{message.content}</div> : null}
              </div>
            ))
          )}

          {busy ? (
            <div className="chat-bubble assistant pending">
              <div className="chat-bubble-head">
                <span>CoOperative AI</span>
              </div>
              <div className={streamingText ? "streaming-response" : undefined}>
                {streamingText || `${status}…`}
              </div>
            </div>
          ) : null}
        </div>

        <div className="local-ai-composer">
          {attachments.length > 0 ? (
            <div className="pending-attachments">
              {attachments.map((attachment) => (
                <div className="pending-attachment" key={attachment.id}>
                  <img src={attachment.previewUrl} alt={attachment.fileName} />
                  <button
                    type="button"
                    onClick={() => void removeAttachment(attachment)}
                    disabled={busy}
                    aria-label={`Remove ${attachment.fileName}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              attachments.length > 0
                ? "Ask about the attached image…"
                : "Ask CoOperative AI…"
            }
            disabled={busy}
            maxLength={16000}
          />

          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void uploadImages(event)}
            disabled={busy || uploadingImages || attachments.length >= MAX_ATTACHMENTS}
          />

          <div className="local-ai-actions">
            <button
              className="primary"
              type="button"
              onClick={() => void send()}
              disabled={
                busy ||
                uploadingImages ||
                (!input.trim() && attachments.length === 0)
              }
            >
              {busy ? "Working…" : "Send"}
            </button>
            {busy ? (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void cancelJob()}
                disabled={!activeJobId}
              >
                Stop
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploadingImages || attachments.length >= MAX_ATTACHMENTS}
            >
              {uploadingImages ? "Uploading…" : "＋ Image"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => void newChat()}
              disabled={busy || uploadingImages}
            >
              New conversation
            </button>
          </div>
          <small className="local-ai-attachment-note">
            Up to 4 images. Large photos are compressed on your device before upload.
          </small>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {meta ? <p className="local-ai-meta">{meta}</p> : null}
      </div>
    </section>
  );
}
