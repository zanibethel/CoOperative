"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

type RecoveryEvent = {
  id: string | number;
  kind: string;
  message: string;
  created_at?: string;
};

type RecoveryIncident = {
  id: string;
  status:
    | "diagnosing"
    | "repairing"
    | "waiting_user"
    | "retrying"
    | "completed"
    | "failed"
    | "cancelled";
  current_message: string;
  continuation_prompt?: string | null;
  resolution_summary?: string | null;
};

type RecoveryExecutor = {
  agent?: string | null;
  taskStatus?: string | null;
  workerId?: string | null;
  deviceName?: string | null;
  requestedProfile?: string | null;
  provider?: string | null;
  model?: string | null;
  waitingForWorker?: boolean;
};

type RecoveryResult = {
  incident?: RecoveryIncident;
  executor?: RecoveryExecutor;
  events?: RecoveryEvent[];
  error?: string;
  detail?: string;
};

function recoveryDirective(content: string) {
  const match = content.match(
    /RECOVERY_STATUS:([0-9a-f]{8}-[0-9a-f-]{27,})/i,
  );
  if (!match) return null;

  return {
    incidentId: match[1],
    text: content.replace(match[0], "").trim(),
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function PersonalRecoveryCard({
  incidentId,
  onChanged,
}: {
  incidentId: string;
  onChanged: () => Promise<void> | void;
}) {
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [cardError, setCardError] = useState("");
  const lastStatusRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function refresh() {
      try {
        const response = await fetch(
          `/api/personal-ai/recovery?incidentId=${encodeURIComponent(incidentId)}`,
          { cache: "no-store" },
        );
        const payload = (await response.json()) as RecoveryResult;
        if (!response.ok || !payload.incident) {
          throw new Error(
            payload.detail || payload.error || "Could not read recovery status.",
          );
        }
        if (cancelled) return;

        const previous = lastStatusRef.current;
        lastStatusRef.current = payload.incident.status;
        setResult(payload);
        setCardError("");

        if (
          previous &&
          previous !== payload.incident.status &&
          ["completed", "failed", "waiting_user"].includes(
            payload.incident.status,
          )
        ) {
          await onChanged();
        }

        if (
          ["diagnosing", "repairing", "retrying"].includes(
            payload.incident.status,
          )
        ) {
          timer = window.setTimeout(refresh, 2400);
        }
      } catch (err) {
        if (!cancelled) {
          setCardError(
            err instanceof Error ? err.message : "Could not read recovery status.",
          );
          timer = window.setTimeout(refresh, 5000);
        }
      }
    }

    void refresh();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [incidentId, onChanged]);

  const incident = result?.incident;
  const active = Boolean(
    incident &&
      ["diagnosing", "repairing", "retrying"].includes(incident.status),
  );

  return (
    <div className="personal-recovery-card">
      <div className="personal-recovery-current">
        <span
          className={
            active
              ? "personal-recovery-dot active"
              : incident?.status === "completed"
                ? "personal-recovery-dot complete"
                : "personal-recovery-dot"
          }
        />
        <div>
          <strong>Recovery Agent</strong>
          <span>
            {incident?.current_message ||
              (cardError
                ? "Recovery status is temporarily unavailable."
                : "Checking recovery…")}
          </span>
        </div>
      </div>

      {incident?.continuation_prompt && active ? (
        <p>{incident.continuation_prompt}</p>
      ) : null}

      {result?.executor ? (
        <div className="personal-recovery-executor">
          <span>
            <strong>Device</strong>{" "}
            {result.executor.waitingForWorker
              ? "waiting for local worker"
              : result.executor.taskStatus === "cancelled" &&
                  !result.executor.workerId
                ? "not used"
                : result.executor.deviceName ||
                  result.executor.workerId ||
                  "local/owned"}
          </span>
          <span>
            <strong>Model</strong>{" "}
            {result.executor.model ||
              (result.executor.waitingForWorker
                ? "not selected yet"
                : result.executor.taskStatus === "cancelled" &&
                    !result.executor.workerId
                  ? "not used"
                  : result.executor.requestedProfile
                    ? result.executor.requestedProfile + " profile"
                    : "pending")}
          </span>
        </div>
      ) : null}

      <details>
        <summary>Recovery details</summary>
        <div className="personal-recovery-events">
          <small>
            Activity summaries only — private model reasoning is not exposed.
          </small>
          {(result?.events || []).map((event) => (
            <div key={String(event.id)}>
              <span>{event.message}</span>
              {event.created_at ? (
                <time>
                  {new Date(event.created_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </time>
              ) : null}
            </div>
          ))}
          {incident?.resolution_summary ? (
            <div className="personal-recovery-resolution">
              <strong>Resolution</strong>
              <span>{incident.resolution_summary}</span>
            </div>
          ) : null}
        </div>
      </details>

      {cardError ? <div className="personal-chat-error">{cardError}</div> : null}
    </div>
  );
}

export default function PersonalAiMobile() {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("auto");
  const [nodeId, setNodeId] = useState("");
  const [status, setStatus] = useState("Connecting…");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const personalNodes = useMemo(
    () => nodes.filter((node) => node.availableForPersonalAi),
    [nodes],
  );

  const selectedNode =
    nodes.find((node) => node.id === nodeId) ||
    personalNodes[0] ||
    nodes[0] ||
    null;

  const activeConversation =
    conversations.find((conversation) => conversation.id === conversationId) || null;

  const refreshNodes = useCallback(async () => {
    const response = await fetch("/api/local-ai/nodes", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.detail || result.error || "Could not load your PCs.");
    }
    const next = (result.nodes || []) as NodeSummary[];
    setNodes(next);
    return next;
  }, []);

  const refreshSettings = useCallback(async () => {
    const response = await fetch("/api/personal-ai/settings", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.detail || result.error || "Could not load CoOperativeLocalAI settings.",
      );
    }
    const next = result.settings as Settings;
    setSettings(next);
    return next;
  }, []);

  const refreshConversations = useCallback(async () => {
    const response = await fetch("/api/personal-ai/conversations", {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.detail || result.error || "Could not load CoOperativeLocalAI history.",
      );
    }
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
    if (!response.ok) {
      throw new Error(
        result.detail || result.error || "Could not load conversation.",
      );
    }
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

        const readyNodes = nextNodes.filter(
          (node) => node.availableForPersonalAi,
        );
        const preferred =
          readyNodes.find(
            (node) => node.id === nextSettings.preferredNodeId,
          )?.id ||
          readyNodes[0]?.id ||
          "";
        setNodeId(preferred);

        if (nextConversations[0]) {
          await loadConversation(nextConversations[0].id);
        }
        setStatus(preferred ? "Connected" : "PC offline");
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load CoOperativeLocalAI.",
          );
          setStatus("Unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    loadConversation,
    refreshConversations,
    refreshNodes,
    refreshSettings,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, status]);

  async function updateSettings(patch: Partial<Settings>) {
    const response = await fetch("/api/personal-ai/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.detail || result.error || "Could not update settings.",
      );
    }
    setSettings(result.settings);
  }

  async function newChat() {
    if (busy) return;
    setConversationId("");
    setMessages([]);
    setInput("");
    setMeta("");
    setError("");
    setShowHistory(false);
  }

  async function chooseConversation(id: string) {
    if (busy) return;
    setShowHistory(false);
    try {
      await loadConversation(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load conversation.",
      );
    }
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
        throw new Error(
          result.detail || result.error || "Could not read CoOperativeLocalAI response.",
        );
      }

      if (result.status === "queued") {
        setStatus("Waiting for your PC…");
        continue;
      }
      if (result.status === "running") {
        setStatus("Thinking on your PC…");
        continue;
      }
      if (result.status === "completed") {
        await loadConversation(id);
        await refreshConversations();
        setMeta(
          [
            result.model,
            result.provider,
            typeof result.latencyMs === "number"
              ? `${(result.latencyMs / 1000).toFixed(1)}s`
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        );
        setStatus("Connected");
        return;
      }

      if (result.status === "failed") {
        setStatus("Recovery running in background…");
        const recoveryResponse = await fetch("/api/personal-ai/recovery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceJobId: jobId }),
        });
        const recovery = (await recoveryResponse.json()) as {
          incident?: RecoveryIncident;
          error?: string;
          detail?: string;
        };
        if (!recoveryResponse.ok || !recovery.incident) {
          throw new Error(
            recovery.detail ||
              recovery.error ||
              result.error ||
              "Local AI failed and Recovery Agent could not start.",
          );
        }

        await loadConversation(id);
        await refreshConversations();
        setStatus(
          selectedNode?.availableForPersonalAi ? "Connected" : "PC offline",
        );
        return;
      }

      throw new Error(
        result.error ||
          `CoOperativeLocalAI ended with status ${result.status || "unknown"}.`,
      );
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
        throw new Error(
          result.detail ||
            result.error ||
            "Could not send to your CoOperativeLocalAI PC.",
        );
      }

      setConversationId(result.conversationId);
      setStatus(`Using ${result.node?.displayName || "your PC"}…`);
      await pollJob(result.jobId, result.conversationId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "CoOperativeLocalAI request failed.",
      );
      setStatus(
        selectedNode?.availableForPersonalAi ? "Connected" : "PC offline",
      );

      if (conversationId) {
        await loadConversation(conversationId).catch(() => {});
      } else {
        setMessages((current) =>
          current.filter((message) => message.id !== optimistic.id),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setStatus("Copied");
      window.setTimeout(
        () =>
          setStatus(
            selectedNode?.availableForPersonalAi ? "Connected" : "PC offline",
          ),
        900,
      );
    } catch {
      setError("Could not copy this message.");
    }
  }

  const online = Boolean(selectedNode?.availableForPersonalAi);

  return (
    <section className="personal-chat-app">
      <header className="personal-chat-header">
        <button
          type="button"
          className="personal-chat-icon-button"
          onClick={() => setShowHistory((current) => !current)}
          aria-label="Open conversation history"
          aria-expanded={showHistory}
        >
          ☰
        </button>

        <button
          type="button"
          className="personal-chat-title-button"
          onClick={() => setShowHistory((current) => !current)}
          aria-expanded={showHistory}
        >
          <strong>{activeConversation?.title || "CoOperativeLocalAI"}</strong>
          <span>
            <i className={online ? "personal-chat-online-dot online" : "personal-chat-online-dot"} />
            {selectedNode?.displayName || "No PC"} · {status}
          </span>
        </button>

        <button
          type="button"
          className="personal-chat-icon-button"
          onClick={() => setShowControls((current) => !current)}
          aria-label="CoOperativeLocalAI settings"
          aria-expanded={showControls}
        >
          ⚙
        </button>
      </header>

      {showHistory ? (
        <div className="personal-chat-popover personal-chat-history">
          <div className="personal-chat-popover-head">
            <strong>Chats</strong>
            <button
              type="button"
              className="personal-chat-new"
              onClick={() => void newChat()}
              disabled={busy}
            >
              ＋ New chat
            </button>
          </div>
          <div className="personal-chat-history-list">
            {conversations.length === 0 ? (
              <p>No saved conversations yet.</p>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={
                    conversation.id === conversationId
                      ? "personal-chat-history-item active"
                      : "personal-chat-history-item"
                  }
                  onClick={() => void chooseConversation(conversation.id)}
                  disabled={busy}
                >
                  <strong>{conversation.title}</strong>
                  <small>
                    {conversation.updatedAt
                      ? new Date(conversation.updatedAt).toLocaleString()
                      : "Saved chat"}
                  </small>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {showControls ? (
        <div className="personal-chat-popover personal-chat-controls">
          <div className="personal-chat-popover-head">
            <div>
              <strong>CoOperativeLocalAI</strong>
              <small>Inference stays on your selected PC.</small>
            </div>
            <button
              type="button"
              className="personal-chat-close"
              onClick={() => setShowControls(false)}
              aria-label="Close settings"
            >
              ×
            </button>
          </div>

          <label className="field">
            <span>PC</span>
            <select
              value={nodeId}
              onChange={(event) => {
                const id = event.target.value;
                setNodeId(id);
                void updateSettings({ preferredNodeId: id || null }).catch(
                  (err) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Could not save preferred PC.",
                    ),
                );
              }}
              disabled={busy || conversationId !== ""}
            >
              {personalNodes.length === 0 ? (
                <option value="">No CoOperativeLocalAI PC online</option>
              ) : null}
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
              onChange={(event) =>
                setModelMode(event.target.value as ModelMode)
              }
              disabled={busy}
            >
              <option value="auto">Auto — choose for me</option>
              <option value="fast">Fast</option>
              <option value="quality">Quality</option>
              <option value="heavy">Heavy</option>
            </select>
          </label>

          <label className="personal-chat-setting-row">
            <input
              type="checkbox"
              checked={Boolean(settings?.improvementOptIn)}
              onChange={(event) => {
                const checked = event.target.checked;
                setSettings((current) =>
                  current
                    ? { ...current, improvementOptIn: checked }
                    : current,
                );
                void updateSettings({ improvementOptIn: checked }).catch(
                  (err) =>
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Could not update learning preference.",
                    ),
                );
              }}
            />
            <span>
              <strong>Help improve CoOperative</strong>
              <small>
                Allow authorized improvement systems to learn from this
                encrypted CoOperativeLocalAI history.
              </small>
            </span>
          </label>

          <a className="secondary-button personal-chat-balance-link" href="/balance">
            AI balance & paid usage
          </a>

          <p className="personal-chat-privacy-note">
            Personal AI still stays on your selected PC. Your funded balance is
            available to other CoOperative workflows only when a paid route is
            explicitly eligible; it is never used to silently replace an offline PC.
          </p>
        </div>
      ) : null}

      <main className="personal-chat-thread">
        {messages.length === 0 ? (
          <div className="personal-chat-empty">
            <div className="personal-chat-mark">C</div>
            <h1>What can I help with?</h1>
            <p>
              Your CoOperativeLocalAI runs on{" "}
              {selectedNode?.displayName || "your linked PC"}.
            </p>
            {!online ? (
              <div className="personal-chat-offline">
                <strong>No CoOperativeLocalAI PC online</strong>
                <span>
                  Once the current machine-wide Unison build is installed on
                  the PC, it will appear here automatically.
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="personal-chat-message-list">
            {messages.map((message) => (
              <article
                className={
                  message.role === "user"
                    ? "personal-chat-message user"
                    : "personal-chat-message assistant"
                }
                key={message.id}
              >
                {message.role === "assistant" ? (
                  <div className="personal-chat-avatar">C</div>
                ) : null}
                <div className="personal-chat-message-body">
                  <div className="personal-chat-message-text">
                    {(() => {
                      const recovery = recoveryDirective(message.content);
                      if (!recovery) return message.content;

                      return (
                        <>
                          {recovery.text ? <div>{recovery.text}</div> : null}
                          <PersonalRecoveryCard
                            incidentId={recovery.incidentId}
                            onChanged={async () => {
                              if (conversationId) {
                                await loadConversation(conversationId);
                                await refreshConversations();
                              }
                            }}
                          />
                        </>
                      );
                    })()}
                  </div>
                  {message.role === "assistant" ? (
                    <div className="personal-chat-message-actions">
                      <button
                        type="button"
                        onClick={() => void copyMessage(message.content)}
                      >
                        Copy
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}

            {busy ? (
              <article className="personal-chat-message assistant pending">
                <div className="personal-chat-avatar">C</div>
                <div className="personal-chat-message-body">
                  <div className="personal-chat-thinking">
                    <span className="personal-chat-thinking-dot" />
                    <span>{status}</span>
                  </div>
                </div>
              </article>
            ) : null}
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {error ? (
        <div className="personal-chat-error" role="alert">
          {error}
        </div>
      ) : null}

      <footer className="personal-chat-composer-shell">
        <div className="personal-chat-composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              online
                ? "Message CoOperativeLocalAI"
                : "Your CoOperativeLocalAI PC is offline"
            }
            disabled={busy || !online}
            maxLength={16000}
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            className="personal-chat-send"
            type="button"
            onClick={() => void send()}
            disabled={busy || !online || !input.trim()}
            aria-label="Send message"
          >
            ↑
          </button>
        </div>

        <div className="personal-chat-composer-meta">
          <span>
            {selectedNode?.displayName || "No PC"} ·{" "}
            {modelMode === "auto" ? "Auto model" : modelMode}
          </span>
          {meta ? <span>{meta}</span> : null}
        </div>
      </footer>
    </section>
  );
}
