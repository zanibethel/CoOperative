"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type JobSnapshot = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  profile: "fast" | "quality";
  messages?: Array<{ role?: string; content?: string }> | null;
  text?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  error?: string | null;
};

function normalizeMessages(value: JobSnapshot["messages"]): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message) => {
    if (
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string"
    ) {
      return [{ role: message.role, content: message.content }];
    }
    return [];
  });
}

export default function LocalAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<"fast" | "quality">("fast");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"queued" | "running" | "">("");
  const [error, setError] = useState("");
  const [lastMeta, setLastMeta] = useState<{
    model?: string | null;
    latencyMs?: number | null;
    promptTokens?: number | null;
    outputTokens?: number | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resumeActiveJob() {
      try {
        const response = await fetch("/api/local-ai/chat", { cache: "no-store" });
        if (response.status === 204 || cancelled) return;
        if (!response.ok) return;

        const payload = (await response.json()) as JobSnapshot;
        if (cancelled) return;

        const restored = normalizeMessages(payload.messages);
        if (restored.length) setMessages(restored);
        setProfile(payload.profile);
        setJobStatus(payload.status === "running" ? "running" : "queued");
        setActiveJobId(payload.jobId);
      } catch {
        // A resume check should not block a new local chat.
      }
    }

    void resumeActiveJob();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(
          `/api/local-ai/chat?jobId=${encodeURIComponent(activeJobId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as JobSnapshot & { detail?: string };

        if (!response.ok) {
          throw new Error(payload.detail || payload.error || "Could not read local AI job.");
        }
        if (cancelled) return;

        if (payload.status === "completed") {
          if (payload.text) {
            const assistantMessage: ChatMessage = {
              role: "assistant",
              content: payload.text,
            };
            setMessages((current) => [...current, assistantMessage]);
          }
          setLastMeta({
            model: payload.model,
            latencyMs: payload.latencyMs,
            promptTokens: payload.promptTokens,
            outputTokens: payload.outputTokens,
          });
          setActiveJobId(null);
          setJobStatus("");
          return;
        }

        if (payload.status === "failed" || payload.status === "cancelled") {
          setError(payload.error || `Local AI job ${payload.status}.`);
          setActiveJobId(null);
          setJobStatus("");
          return;
        }

        setJobStatus(payload.status === "running" ? "running" : "queued");
        timer = setTimeout(poll, 2500);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not check local AI job.");
        timer = setTimeout(poll, 5000);
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId]);

  const busy = activeJobId !== null;
  const statusText =
    jobStatus === "running"
      ? "Running on your Mac"
      : busy
        ? "Queued for your Mac"
        : "Ready";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    setError("");
    setLastMeta(null);
    setJobStatus("queued");

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ].slice(-20);

    setMessages(nextMessages);
    setInput("");

    try {
      const response = await fetch("/api/local-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          profile,
          maxTokens: profile === "quality" ? 1200 : 768,
          temperature: 0.2,
        }),
      });

      const payload = (await response.json()) as {
        jobId?: string;
        error?: string;
        detail?: string;
      };

      if (!response.ok || !payload.jobId) {
        throw new Error(payload.detail || payload.error || "Could not queue local AI job.");
      }

      setActiveJobId(payload.jobId);
    } catch (err) {
      setJobStatus("");
      setError(err instanceof Error ? err.message : "Could not queue local AI job.");
    }
  }

  function clearConversation() {
    if (busy) return;
    setMessages([]);
    setLastMeta(null);
    setError("");
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
          {statusText}
        </div>
      </div>

      <div className="local-ai-chat card">
        <div className="local-ai-messages">
          {messages.length === 0 ? (
            <div className="local-ai-empty">
              <strong>CoOperative AI Local</strong>
              <p>
                Ask a planning, coding, debugging, or business-operations question.
                Queued work remains in CoOperative AI even if you leave this page.
              </p>
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
              <div>{statusText}… You can leave this page and come back.</div>
            </div>
          ) : null}
        </div>

        <form className="local-ai-composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask CoOperative AI…"
            disabled={busy}
            maxLength={16000}
          />
          <div className="local-ai-actions">
            <button className="primary" type="submit" disabled={busy || !input.trim()}>
              {busy ? "Working…" : "Send"}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={clearConversation}
              disabled={busy}
            >
              Clear conversation
            </button>
          </div>
        </form>

        {error ? <p className="error">{error}</p> : null}
        {lastMeta ? (
          <p className="local-ai-meta">
            {lastMeta.model || "Local model"}
            {typeof lastMeta.latencyMs === "number"
              ? ` · ${(lastMeta.latencyMs / 1000).toFixed(1)}s`
              : ""}
            {typeof lastMeta.promptTokens === "number" &&
            typeof lastMeta.outputTokens === "number"
              ? ` · ${lastMeta.promptTokens} in / ${lastMeta.outputTokens} out`
              : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}
