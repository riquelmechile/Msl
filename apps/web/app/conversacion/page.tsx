"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { KeyboardEvent } from "react";
import type { ConversationMessage } from "@msl/agent";

// ── Types ──────────────────────────────────────────────────────────

type UIMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  consultedActor?: "comprador" | "proveedor" | "competidor";
  autonomyLevel?: string;
  strategiesApplied?: number;
  proposal?: {
    id: string;
    summary: string;
    riskLevel: string;
    kind: string;
  };
};

type ChatMetadata = {
  type: "metadata";
  autonomyLevel: string;
  autonomyLevelNumber: number;
  hasProposal: boolean;
  strategiesActive: number;
  consultedActor?: string;
  sessionId?: string;
  proposal?: {
    id: string;
    summary: string;
    riskLevel: string;
    kind: string;
  };
};

// ── Autonomy emoji lookup ─────────────────────────────────────────

const AUTONOMY_EMOJI: Record<string, string> = {
  CONSULTA: "🔒",
  SUGIERE: "💡",
  PREPARA: "📋",
  BAJO_RIESGO: "🟢",
  MEDIO_RIESGO: "🟡",
  FULL: "🔵",
};

type AccessLoginErrorBody = {
  reason?: string;
};

function getAccessLoginErrorMessage(status: number, body: AccessLoginErrorBody): string {
  if (status === 429 || body.reason === "too_many_attempts") {
    return "⏳ Demasiados intentos inválidos. Esperá un minuto e intentá de nuevo.";
  }

  if (body.reason === "invalid_token") {
    return "🔐 Clave de acceso inválida.";
  }

  return "⛔ El acceso a la conversación no está disponible. Revisá la configuración e intentá más tarde.";
}

// ── Component ──────────────────────────────────────────────────────

export default function ConversationPage() {
  const [messages, setMessages] = useState<UIMessage[]>([
    {
      role: "assistant",
      content:
        "¡Hola! Soy MSL AI, tu asistente de negocio para MercadoLibre Chile. " +
        "Preguntame sobre ventas, márgenes, reclamos, reputación, o cualquier cosa de tu tienda. " +
        "También puedo consultar actores del mercado (compradores, proveedores, competidores) " +
        "y aplicar las estrategias del CEO. ¿En qué te ayudo?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessRequired, setAccessRequired] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [currentAutonomy, setCurrentAutonomy] = useState("SUGIERE");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;

      const userMsg: UIMessage = {
        role: "user",
        content: text.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);

      try {
        // Convert UI messages to ConversationMessage history.
        const history: ConversationMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));

        const res = await fetch("/api/conversation-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim(), history, sessionId }),
        });

        if (!res.ok || !res.body) {
          if (res.status === 401) {
            setAccessRequired(true);
          }
          setMessages((prev) => [
            ...prev,
            {
              role: "system",
              content:
                res.status === 401
                  ? "🔐 Ingresá la clave de acceso para usar la conversación."
                  : "⛔ Error al conectar con el agente. Intentá de nuevo.",
              timestamp: new Date(),
            },
          ]);
          setLoading(false);
          return;
        }

        // Read SSE stream.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantContent = "";
        let metadata: ChatMetadata | null = null;

        const assistantPlaceholder: UIMessage = {
          role: "assistant",
          content: "",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantPlaceholder]);

        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE events from the buffer.
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const dataStr = line.slice(6);

            try {
              const data = JSON.parse(dataStr) as { type: string } & Record<string, unknown>;

              if (data.type === "delta" && typeof data.content === "string") {
                assistantContent += data.content;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === "assistant") {
                    last.content = assistantContent;
                  }
                  return updated;
                });
              } else if (data.type === "metadata") {
                metadata = data as unknown as ChatMetadata;
              }
            } catch {
              // Skip malformed lines.
            }
          }
        }

        // Finalize the assistant message with metadata.
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") {
            last.content = assistantContent;
            if (metadata) {
              const actor = metadata.consultedActor as string | undefined;
              if (actor === "comprador" || actor === "proveedor" || actor === "competidor") {
                last.consultedActor = actor;
              }
              last.autonomyLevel = metadata.autonomyLevel;
              last.strategiesApplied = metadata.strategiesActive;
              if (metadata.proposal) {
                last.proposal = metadata.proposal;
              }
              if (metadata.sessionId) {
                setSessionId(metadata.sessionId);
              }
              // Update global autonomy level.
              setCurrentAutonomy(metadata.autonomyLevel);
            }
          }
          return updated;
        });
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "⛔ Error de red. Revisá tu conexión e intentá de nuevo.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [messages, loading, sessionId],
  );

  const handleAccessLogin = useCallback(async () => {
    if (!accessToken.trim() || loginLoading) return;

    setLoginLoading(true);
    try {
      const res = await fetch("/api/conversation-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: accessToken.trim() }),
      });

      if (!res.ok) {
        const errorBody = (await res.json().catch(() => ({}))) as AccessLoginErrorBody;
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: getAccessLoginErrorMessage(res.status, errorBody),
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setAccessToken("");
      setAccessRequired(false);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "✅ Acceso habilitado. Ya podés conversar con el agente.",
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "⛔ Error al validar la clave de acceso. Intentá de nuevo.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoginLoading(false);
      inputRef.current?.focus();
    }
  }, [accessToken, loginLoading]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const actorLabel = (actor: string): string => {
    switch (actor) {
      case "comprador":
        return "Comprador";
      case "proveedor":
        return "Proveedor";
      case "competidor":
        return "Competidor";
      default:
        return "";
    }
  };

  const actorEmoji = (actor: string): string => {
    switch (actor) {
      case "comprador":
        return "🛒";
      case "proveedor":
        return "📦";
      case "competidor":
        return "🏪";
      default:
        return "";
    }
  };

  return (
    <div className="chat-shell">
      {/* Header */}
      <header className="chat-header">
        <div className="chat-header-left">
          <div className="chat-avatar">M</div>
          <div>
            <h1 className="chat-title">MSL AI</h1>
            <p className="chat-subtitle">Asistente de Negocios · MercadoLibre Chile</p>
          </div>
        </div>
        <div className="chat-header-right">
          <span className="autonomy-badge" title={`Nivel de autonomía actual: ${currentAutonomy}`}>
            {AUTONOMY_EMOJI[currentAutonomy] ?? "💡"} {currentAutonomy}
          </span>
        </div>
      </header>

      {/* Messages */}
      <main className="chat-messages" role="log" aria-label="Conversación del agente">
        {messages.map((msg, i) => (
          <div
            key={`${msg.role}-${i}`}
            className={`message-row ${msg.role === "user" ? "message-out" : "message-in"}`}
          >
            {msg.role === "system" ? (
              <div className="message-system">{msg.content}</div>
            ) : (
              <div
                className={`message-bubble ${msg.role === "user" ? "bubble-user" : "bubble-agent"}`}
              >
                <p className="message-text">{msg.content}</p>

                {/* Actor consultation badge */}
                {msg.consultedActor && (
                  <div className="message-badge actor-badge">
                    {actorEmoji(msg.consultedActor)} Actor consultado:{" "}
                    {actorLabel(msg.consultedActor)}
                  </div>
                )}

                {/* Strategies applied badge */}
                {msg.strategiesApplied && msg.strategiesApplied > 0 && (
                  <div className="message-badge strategies-badge">
                    📐 {msg.strategiesApplied} estrategia{msg.strategiesApplied !== 1 ? "s" : ""}{" "}
                    del CEO aplicada{msg.strategiesApplied !== 1 ? "s" : ""}
                  </div>
                )}

                {/* Proposal badge */}
                {msg.proposal && (
                  <div className="message-badge proposal-badge">
                    ⚡ Propuesta: {msg.proposal.summary} (
                    {msg.proposal.riskLevel === "low"
                      ? "bajo riesgo"
                      : msg.proposal.riskLevel === "medium"
                        ? "riesgo medio"
                        : "alto riesgo"}
                    )
                    <br />
                    <small>Respondé &ldquo;dale&rdquo; para confirmar.</small>
                  </div>
                )}

                {/* Timestamp */}
                <time className="message-time">
                  {msg.timestamp.toLocaleTimeString("es-CL", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="message-row message-in">
            <div className="message-bubble bubble-agent">
              <span className="typing-indicator">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {accessRequired && (
        <section className="chat-access-bar" aria-label="Acceso a la conversación">
          <input
            type="password"
            className="chat-input"
            placeholder="Clave de acceso"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAccessLogin();
              }
            }}
            disabled={loginLoading}
            aria-label="Clave de acceso a la conversación"
          />
          <button
            type="button"
            className="chat-access-btn"
            onClick={() => void handleAccessLogin()}
            disabled={loginLoading || !accessToken.trim()}
          >
            Entrar
          </button>
        </section>
      )}

      {/* Input */}
      <footer className="chat-input-bar">
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder="Escribí tu mensaje..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          aria-label="Mensaje para el agente"
        />
        <button
          type="button"
          className="chat-send-btn"
          onClick={() => void sendMessage(input)}
          disabled={loading || !input.trim()}
          aria-label="Enviar mensaje"
        >
          ↑
        </button>
      </footer>
    </div>
  );
}
