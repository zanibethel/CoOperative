"use client";

import { useState } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type JobResult = {
  jobId?: string;
  status?: string;
  text?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  outputTokens?: number | null;
  error?: string | null;
  detail?: string | null;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function LocalAiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [profile, setProfile] = useState<"fast" | "quality">("fast");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const requestMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ].slice(-20);

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

      for (;;) {
        await wait(2500);

        const response = await fetch(
          `/api/local-ai/chat?jobId=${encodeURIComponent(queued.jobId)}`,
          { cache: "no-store" },
        );
        const result = (await response.json()) as JobResult;

        if (!response.ok) {
          throw new Error(result.detail || result.error || "Could not read local AI job.");
        }

        if (result.status === "queued") {
          setStatus("Queued for your Mac");
          continue;
        }

        if (result.status === "running") {
          setStatus("Running on your Mac");
          continue;
        }

        if (result.status === "completed") {
          if (result.text) {
            setMessages((current) => [
              ...current,
              { role: "assistant", content: result.text as string },
            ]);
          }

          const details = [
            result.model,
            typeof result.latencyMs === "number"
              ? `${(result.latencyMs / 1000).toFixed(1)}s`
              : null,
            typeof result.promptTokens === "number" && typeof result.outputTokens === "number"
              ? `${result.promptTokens} in / ${result.outputTokens} out`
              : null,
          ].filter(Boolean);

          setMeta(details.join(" · "));
          setStatus("Ready");
          break;
        }

        throw new Error(result.error || `Local AI job ended with status ${result.status || "unknown"}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Local AI request failed.");
      setStatus("Ready");
    } finally {
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
