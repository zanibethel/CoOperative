"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type JobSnapshot = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  profile: "fast" | "quality";
  text?: string | null;
  model?: string | null;
  provider?: string | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  error?: string | null;
};

const STORAGE_KEY = "cooperative-local-ai-active-job";

export default function LocalAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<"fast" | "quality">("fast");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [lastMeta, setLastMeta] = useState<{
    model?: string | null;
    latencyMs?: number | null;
    promptTokens?: number | null;
    outputTokens?: number | null;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        jobId?: string;
        profile?: "fast" | "quality";
        messages?: ChatMessage[];
      };
      if (saved.jobId) setActiveJobId(saved.jobId);
      if (saved.profile) setProfile(saved.profile);
      if (Array.isArray(saved.messages)) setMessages(saved.messages);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/local-ai/chat?jobId=${encodeURIComponent(activeJobId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as JobSnapshot & {
          error?: string;
          detail?: string;
        };

        if (!response.ok) {
          throw new Error(payload.detail || payload.error || "Could not read local AI job.");
        }
        if (cancelled) return;

        setJobStatus(payload.status);

        if (payload.status === "completed") {
          if (payload.text) {
            setMessages((current) => [
              ...current,
              { role: "assistant", content: payload.text || "" },
            ]);
          }
          setLastMeta({
            model: payload.model,
            latencyMs: payload.latencyMs,
            promptTokens: payload.promptTokens,
            outputTokens: payload.outputTokens,
          });
          setActiveJobId(null);
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }

        if (payload.status === "failed" || payload.status === "cancelled") {
          setError(payload.error || `Local AI job ${payload.status}.`);
          setActiveJobId(null);
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }

        timer = setTimeout(poll, 2500);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not check local AI job.");
        timer = setTimeout(poll, 5000);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId]);

  const busy = Boolean(activeJobId);
  const statusText = useMemo(() => {
    if (!busy) return "Ready";
    if (jobStatus === "running") return "Running on your Mac";
    return "Queued for your Mac";
  }, [busy, jobStatus]);

  async function submit(event: FormEvent) {
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
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ jobId: payload.jobId, profile, messages: nextMessages }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue local AI job.");
    }
  }

  function clearConversation() {
    if (busy) return;
    setMessages([]);
    setLastMeta(null);
    setError("");
    window.localStorage.removeItem(STORAGE_KEY);
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
                The request stays in CoOperative's persistent queue until your Mac claims it.
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
            <button className="text-button" type="button" onClick={clearConversation} disabled={busy}>
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
