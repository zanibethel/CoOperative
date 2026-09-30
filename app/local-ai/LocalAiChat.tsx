"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type JobResult = {
  jobId?: string;
  status?: string;
  profile?: "fast" | "quality";
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
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<"fast" | "quality">("fast");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");
  const activePollRef = useRef<string | null>(null);

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

          const persistedMessages = readMessages(result.messages);
          if (persistedMessages.length > 0) {
            setMessages(persistedMessages);
          } else if (fallbackMessages.length > 0) {
            setMessages(fallbackMessages);
          }

          if (result.status === "queued") {
            setStatus("Queued for your Mac");
            await wait(2500);
            continue;
          }

          if (result.status === "running") {
            setStatus("Running on your Mac");
            await wait(2500);
            continue;
          }

          if (result.status === "completed") {
            const baseMessages =
              persistedMessages.length > 0 ? persistedMessages : fallbackMessages;

            if (result.text) {
              setMessages([
                ...baseMessages,
                { role: "assistant", content: result.text },
              ]);
            } else {
              setMessages(baseMessages);
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
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function resume() {
      const savedJobId = window.localStorage.getItem(ACTIVE_JOB_KEY);
      if (savedJobId) {
        await pollJob(savedJobId);
        return;
      }

      try {
        const response = await fetch("/api/local-ai/chat", { cache: "no-store" });
        if (cancelled || response.status === 204) return;

        const active = (await response.json()) as JobResult;
        if (!response.ok || !active.jobId) return;

        const persistedMessages = readMessages(active.messages);
        if (persistedMessages.length > 0) {
          setMessages(persistedMessages);
        }
        if (active.profile === "fast" || active.profile === "quality") {
          setProfile(active.profile);
        }

        window.localStorage.setItem(ACTIVE_JOB_KEY, active.jobId);
        await pollJob(active.jobId, persistedMessages);
      } catch {
        if (!cancelled) {
          setStatus("Ready");
        }
      }
    }

    void resume();

    return () => {
      cancelled = true;
      activePollRef.current = null;
    };
  }, [pollJob]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const userMessage: ChatMessage = { role: "user", content: text };
    const requestMessages: ChatMessage[] = [...messages, userMessage].slice(-20);

    setMessages(requestMessages);
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
          messages: requestMessages,
          profile,
          maxTokens: profile === "quality" ? 1200 : 768,
          temperature: 0.2,
        }),
      });

      const queued = (await queuedResponse.json()) as JobResult;
      if (!queuedResponse.ok || !queued.jobId) {
        throw new Error(queued.detail || queued.error || "Could not queue local AI job.");
      }

      window.localStorage.setItem(ACTIVE_JOB_KEY, queued.jobId);
      await pollJob(queued.jobId, requestMessages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Local AI request failed.");
      setStatus("Ready");
      setBusy(false);
    }
  }

  return (
    <section className="local-ai-layout">
      <div className="local-ai-toolbar card">
        <div>
          <strong>Local model</strong>
          <p>Runs on the connected Mac. No paid model fallback from this screen.</p>
        </div>
        <label className="field">
          <span>Profile</span>
          <select
            value={profile}
            onChange={(event) => setProfile(event.target.value as "fast" | "quality")}
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
              <p>Ask a planning, coding, debugging, or business-operations question.</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
                key={`${message.role}-${index}`}
              >
                <span>{message.role === "user" ? "You" : "CoOperative AI"}</span>
                <div>{message.content}</div>
              </div>
            ))
          )}

          {busy ? (
            <div className="chat-bubble assistant pending">
              <span>CoOperative AI</span>
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
            <button
              className="text-button"
              type="button"
              onClick={() => {
                if (!busy) {
                  window.localStorage.removeItem(ACTIVE_JOB_KEY);
                  setMessages([]);
                  setMeta("");
                  setError("");
                }
              }}
              disabled={busy}
            >
              Clear conversation
            </button>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {meta ? <p className="local-ai-meta">{meta}</p> : null}
      </div>
    </section>
  );
}
