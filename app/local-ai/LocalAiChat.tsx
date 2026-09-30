"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Profile = "fast" | "quality";

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
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

type JobResult = {
  jobId?: string;
  status?: string;
  profile?: Profile;
  conversationId?: string | null;
  conversationTitle?: string | null;
  messages?: unknown;
  text?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
  detail?: string | null;
};

const ACTIVE_JOB_KEY = "cooperative.local-ai.active-job";

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
    result.model,
    typeof result.latencyMs === "number"
      ? `${(result.latencyMs / 1000).toFixed(1)}s`
      : null,
    typeof result.promptTokens === "number" && typeof result.outputTokens === "number"
      ? `${result.promptTokens} in / ${result.outputTokens} out`
      : null,
  ].filter(Boolean);

  return details.join(" · ");
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
  const activePollRef = useRef<string | null>(null);

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
    setMeta("");
    setError("");
  }, []);

  const pollJob = useCallback(
    async (jobId: string, fallbackMessages: ChatMessage[] = []) => {
      if (activePollRef.current === jobId) return;

      activePollRef.current = jobId;
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

          if (result.status === "queued") {
            setStatus("Queued for your Mac");
            await wait(1500);
            continue;
          }

          if (result.status === "running") {
            setStatus("Running on your Mac");
            await wait(1500);
            continue;
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

  function newChat() {
    if (busy) return;
    setConversationId(null);
    setConversationTitle("New chat");
    setMessages([]);
    setInput("");
    setMeta("");
    setError("");
    setStatus("Ready");
  }

  async function deleteConversation() {
    if (!conversationId || busy) return;
    if (!window.confirm(`Delete “${conversationTitle}”?`)) return;

    try {
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
        newChat();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete conversation.");
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

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const fallbackMessages = [...messages, userMessage];

    setMessages(fallbackMessages);
    setInput("");
    setError("");
    setMeta("");
    setBusy(true);
    setStatus("Queued for your Mac");

    try {
      const queuedResponse = await fetch("/api/local-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: text,
          profile,
          maxTokens: profile === "quality" ? 1200 : 768,
          temperature: 0.2,
        }),
      });

      const queued = (await queuedResponse.json()) as JobResult;
      if (!queuedResponse.ok || !queued.jobId) {
        throw new Error(queued.detail || queued.error || "Could not queue local AI job.");
      }

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
                newChat();
              } else {
                void loadConversation(id);
              }
            }}
            disabled={busy}
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
          <button className="secondary-button" type="button" onClick={newChat} disabled={busy}>
            New chat
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => void deleteConversation()}
            disabled={busy || !conversationId}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="local-ai-toolbar card">
        <div>
          <strong>{conversationTitle}</strong>
          <p>Runs on the connected Mac. No paid model fallback from this screen.</p>
        </div>
        <label className="field">
          <span>Profile</span>
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
                Ask anything. This conversation will be saved so you can leave and
                continue later.
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
                  <button
                    className="message-action"
                    type="button"
                    onClick={() => void copyMessage(message.content)}
                    aria-label="Copy message"
                  >
                    Copy
                  </button>
                </div>
                <div>{message.content}</div>
              </div>
            ))
          )}

          {busy ? (
            <div className="chat-bubble assistant pending">
              <div className="chat-bubble-head">
                <span>CoOperative AI</span>
              </div>
              <div>{status}…</div>
            </div>
          ) : null}
        </div>

        <div className="local-ai-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask CoOperative AI…"
            disabled={busy}
            maxLength={16000}
          />
          <div className="local-ai-actions">
            <button
              className="primary"
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
            >
              {busy ? "Working…" : "Send"}
            </button>
            <button className="text-button" type="button" onClick={newChat} disabled={busy}>
              New conversation
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {meta ? <p className="local-ai-meta">{meta}</p> : null}
      </div>
    </section>
  );
}
