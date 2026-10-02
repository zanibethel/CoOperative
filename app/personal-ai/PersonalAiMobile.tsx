"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ModelMode = "auto" | "fast" | "quality" | "heavy";

type NodeSummary = {
  id: string;
  displayName: string;
  state: string;
  fresh: boolean;
  personalAiCapable?: boolean;
  availableForPersonalAi?: boolean;
};

type Conversation = {
  id: string;
  nodeId?: string | null;
  title: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceJobId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
};

type Settings = {
  hostedHistoryEnabled: boolean;
  improvementOptIn: boolean;
  remoteEnabled: boolean;
  preferredNodeId?: string | null;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function PersonalAiMobile() {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("auto");
  const [nodeId, setNodeId] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");

  const personalNodes = useMemo(
    () => nodes.filter((node) => node.availableForPersonalAi),
    [nodes],
  );

  const selectedNode =
    nodes.find((node) => node.id === nodeId) ||
    personalNodes[0] ||
    nodes[0] ||
    null;

  const refreshNodes = useCallback(async () => {
    const response = await fetch("/api/local-ai/nodes", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || "Could not load your PCs.");
    const next = (result.nodes || []) as NodeSummary[];
    setNodes(next);
    return next;
  }, []);

  const refreshSettings = useCallback(async () => {
    const response = await fetch("/api/personal-ai/settings", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || "Could not load Personal AI settings.");
    const next = result.settings as Settings;
    setSettings(next);
    return next;
  }, []);

  const refreshConversations = useCallback(async () => {
    const response = await fetch("/api/personal-ai/conversations", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || "Could not load Personal AI history.");
    const next = (result.conversations || []) as Conversation[];
    setConversations(next);
    return next;
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const response = await fetch(
      `/api/personal-ai/conversations?id=${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || "Could not load conversation.");
    setConversationId(id);
    setMessages((result.messages || []) as Message[]);
    if (result.conversation?.nodeId) setNodeId(result.conversation.nodeId);
    setMeta("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextNodes, nextSettings, nextConversations] = await Promise.all([
          refreshNodes(),
          refreshSettings(),
          refreshConversations(),
        ]);
        if (cancelled) return;

        const readyNodes = nextNodes.filter((node) => node.availableForPersonalAi);
        const preferred =
          readyNodes.find((node) => node.id === nextSettings.preferredNodeId)?.id ||
          readyNodes[0]?.id ||
          "";
        setNodeId(preferred);

        if (nextConversations[0]) {
          await loadConversation(nextConversations[0].id);
        }
        setStatus(preferred ? "PC connected" : "Personal AI PC offline");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load Personal AI.");
          setStatus("Unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadConversation, refreshConversations, refreshNodes, refreshSettings]);

  async function updateSettings(patch: Partial<Settings>) {
    const response = await fetch("/api/personal-ai/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || result.error || "Could not update settings.");
    setSettings(result.settings);
  }

  async function newChat() {
    if (busy) return;
    setConversationId("");
    setMessages([]);
    setInput("");
    setMeta("");
    setError("");
  }

  async function pollJob(jobId: string, id: string) {
    for (;;) {
      await wait(750);
      const response = await fetch(
        `/api/personal-ai/chat?jobId=${encodeURIComponent(jobId)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || result.error || "Could not read Personal AI response.");
      }

      if (result.status === "queued") {
        setStatus("Waiting for your PC…");
        continue;
      }
      if (result.status === "running") {
        setStatus("Your PC is thinking…");
        continue;
      }
      if (result.status === "completed") {
        await loadConversation(id);
        await refreshConversations();
        setMeta(
          [
            result.model,
            result.provider,
            result.nodeId ? `PC ${result.nodeId}` : null,
            typeof result.latencyMs === "number"
              ? `${(result.latencyMs / 1000).toFixed(1)}s`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        setStatus("PC connected");
        return;
      }

      throw new Error(result.error || `Personal AI ended with status ${result.status || "unknown"}.`);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setBusy(true);
    setError("");
    setMeta("");
    setStatus("Sending to your PC…");
    const optimistic: Message = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((current) => [...current, optimistic]);
    setInput("");

    try {
      const response = await fetch("/api/personal-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          message: text,
          modelMode,
          nodeId: conversationId ? undefined : nodeId || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.jobId || !result.conversationId) {
        throw new Error(result.detail || result.error || "Could not send to your Personal AI PC.");
      }

      setConversationId(result.conversationId);
      setStatus(`Using ${result.node?.displayName || "your PC"}…`);
      await pollJob(result.jobId, result.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Personal AI request failed.");
      setStatus(selectedNode?.availableForPersonalAi ? "PC connected" : "Personal AI PC offline");
      if (conversationId) {
        await loadConversation(conversationId).catch(() => {});
      } else {
        setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      }
    } finally {
      setBusy(false);
    }
  }

  const online = Boolean(selectedNode?.availableForPersonalAi);

  return (
    <section className="personal-ai-mobile">
      <div className="card personal-ai-mobile-head">
        <div>
          <div className="eyebrow">Your PC · Your AI</div>
          <h1>Personal AI</h1>
          <p>
            Use your own PC&apos;s AI from this phone. Your PC performs the inference;
            CoOperative securely syncs your encrypted history and delivers the response.
          </p>
        </div>
        <div className={online ? "personal-ai-pc-state online" : "personal-ai-pc-state"}>
          <span className={online ? "status-dot active" : "status-dot"} />
          <strong>{selectedNode?.displayName || "No Personal AI PC"}</strong>
          <small>{online ? "Online · personal use has priority" : "Offline"}</small>
        </div>
      </div>

      <div className="card personal-ai-mobile-controls">
        <label className="field">
          <span>Personal AI PC</span>
          <select
            value={nodeId}
            onChange={(event) => {
              const id = event.target.value;
              setNodeId(id);
              void updateSettings({ preferredNodeId: id || null }).catch((err) =>
                setError(err instanceof Error ? err.message : "Could not save preferred PC."),
              );
            }}
            disabled={busy || conversationId !== ""}
          >
            {personalNodes.length === 0 ? <option value="">No Personal AI PC online</option> : null}
            {personalNodes.map((node) => (
              <option value={node.id} key={node.id}>
                {node.displayName} · {node.state}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Model</span>
          <select
            value={modelMode}
            onChange={(event) => setModelMode(event.target.value as ModelMode)}
            disabled={busy}
          >
            <option value="auto">Auto — choose for me</option>
            <option value="fast">Fast</option>
            <option value="quality">Quality</option>
            <option value="heavy">Heavy</option>
          </select>
        </label>

        <label className="personal-ai-toggle">
          <input
            type="checkbox"
            checked={Boolean(settings?.improvementOptIn)}
            onChange={(event) => {
              const checked = event.target.checked;
              setSettings((current) => current ? { ...current, improvementOptIn: checked } : current);
              void updateSettings({ improvementOptIn: checked }).catch((err) =>
                setError(err instanceof Error ? err.message : "Could not update learning preference."),
              );
            }}
          />
          <span>
            <strong>Help improve CoOperative</strong>
            <small>
              Allow authorized improvement systems to learn from this encrypted Personal AI history.
            </small>
          </span>
        </label>
      </div>

      <div className="card local-ai-threadbar">
        <label className="field local-ai-thread-select">
          <span>History</span>
          <select
            value={conversationId}
            onChange={(event) => {
              const id = event.target.value;
              if (!id) void newChat();
              else void loadConversation(id).catch((err) =>
                setError(err instanceof Error ? err.message : "Could not load conversation."),
              );
            }}
            disabled={busy}
          >
            <option value="">New conversation</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" type="button" onClick={() => void newChat()} disabled={busy}>
          New chat
        </button>
      </div>

      <div className="card local-ai-chat personal-ai-chat-card">
        <div className="local-ai-messages">
          {messages.length === 0 ? (
            <div className="local-ai-empty">
              <strong>Personal AI on your PC</strong>
              <p>
                Send a message from your phone. It will run on {selectedNode?.displayName || "your linked PC"},
                even while that PC is being used.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
                key={message.id}
              >
                <div className="chat-bubble-head">
                  <span>{message.role === "user" ? "You" : "Personal AI"}</span>
                </div>
                <div>{message.content}</div>
              </div>
            ))
          )}

          {busy ? (
            <div className="chat-bubble assistant pending">
              <div className="chat-bubble-head"><span>Personal AI</span></div>
              <div className="execution-trace">
                <span className="execution-trace-dot" />
                <span>{status}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="local-ai-composer personal-ai-mobile-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={online ? "Message your Personal AI…" : "Your Personal AI PC is offline"}
            disabled={busy || !online}
            maxLength={16000}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="local-ai-actions">
            <button
              className="primary"
              type="button"
              onClick={() => void send()}
              disabled={busy || !online || !input.trim()}
            >
              {busy ? "Working…" : "Send to my PC"}
            </button>
            <span className="personal-ai-mobile-status">{status}</span>
          </div>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {meta ? <p className="local-ai-meta">{meta}</p> : null}
      </div>

      <p className="personal-ai-mobile-note">
        No cloud AI fallback is used here. If your PC is offline, Personal AI waits for your PC
        instead of spending money elsewhere.
      </p>
    </section>
  );
}
