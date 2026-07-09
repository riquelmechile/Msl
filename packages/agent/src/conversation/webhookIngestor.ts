import { createServer, type Server } from "node:http";
import type { AgentMessageBusStore } from "./agentMessageBusStore.js";

// ── Types ────────────────────────────────────────────────────────────

export type WebhookEvent = {
  topic: string;
  resource: string;
  user_id: number;
  received: string;
};

export type WebhookIngestor = {
  /** Handle an incoming webhook POST request body. Returns HTTP status and optional Retry-After. */
  handle(body: unknown, _headers?: Record<string, string>): WebhookResponse;
  /** Start an HTTP server on the configured port. */
  start(port: number): void;
  /** Stop the HTTP server. */
  stop(): void;
};

export type WebhookResponse = {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_TOPIC_MAP: Record<string, string> = {
  orders: "operations-manager",
  questions: "unanswered-questions",
  claims: "operations-manager",
  items: "market-catalog",
  shipments: "operations-manager",
};

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEDUPE_WINDOW_MINUTES = 5;

// ── Rate limiter ────────────────────────────────────────────────────

type RateEntry = { count: number; windowStart: number };

function createRateLimiter(max: number, windowMs: number) {
  const entries = new Map<string, RateEntry>();

  const check = (key: string): boolean => {
    const now = Date.now();
    const entry = entries.get(key);

    if (!entry || now - entry.windowStart > windowMs) {
      entries.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= max) {
      return false;
    }

    entry.count++;
    return true;
  };

  return { check };
}

// ── Factory ──────────────────────────────────────────────────────────

export function createWebhookIngestor(
  bus: AgentMessageBusStore,
  topicMap?: Record<string, string>,
): WebhookIngestor {
  const mergedMap = { ...DEFAULT_TOPIC_MAP, ...topicMap };
  const rateLimiter = createRateLimiter(RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);

  let server: Server | null = null;

  // ── Handle a parsed body ─────────────────────────────────
  const handle = (body: unknown, _headers?: Record<string, string>): WebhookResponse => {
    // Validate JSON body is an object
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return {
        status: 400,
        body: { error: "Invalid payload: expected JSON object" },
      };
    }

    const event = body as Record<string, unknown>;

    if (typeof event.topic !== "string" || !event.topic) {
      return {
        status: 400,
        body: { error: "Invalid payload: missing or invalid 'topic'" },
      };
    }

    if (typeof event.resource !== "string" || !event.resource) {
      return {
        status: 400,
        body: { error: "Invalid payload: missing or invalid 'resource'" },
      };
    }

    // Rate limiting by topic
    if (!rateLimiter.check(event.topic)) {
      return {
        status: 429,
        body: { error: "Too many requests" },
        headers: { "Retry-After": "60" },
      };
    }

    // Build dedupe key: topic + resource
    const dedupeKey = `ml-webhook:${event.topic}:${event.resource}`;

    // Check recent dedupe window
    // Use SQLite-compatible datetime format (YYYY-MM-DD HH:MM:SS) to match
    // the bus's created_at column format (SQLite datetime('now'))
    const sinceDate = new Date(Date.now() - DEDUPE_WINDOW_MINUTES * 60 * 1000);
    const since = sinceDate
      .toISOString()
      .replace("T", " ")
      .replace(/\.\d{3}Z$/, "");
    const recent = bus.lookupRecentByDedupePrefix(dedupeKey, since);
    if (recent.length > 0) {
      // Duplicate within window — return 200, don't enqueue
      return {
        status: 200,
        body: { status: "duplicate", messageId: recent[0]!.messageId },
      };
    }

    // Determine receiver lane
    const receiverAgentId = mergedMap[event.topic] ?? "ceo";

    // Derive message type
    const messageType = `ml-webhook:${event.topic}`;

    // Enqueue
    const message = bus.enqueue({
      senderAgentId: "webhook",
      receiverAgentId,
      messageType,
      payloadJson: JSON.stringify(event),
      dedupeKey,
    });

    return {
      status: 202,
      body: { status: "accepted", messageId: message.messageId },
    };
  };

  // ── Start HTTP server ─────────────────────────────────────
  const start = (port: number): void => {
    if (server) {
      console.warn("[webhook-ingestor] Server already running");
      return;
    }

    server = createServer((req, res) => {
      // Only accept POST /webhooks/mercadolibre
      if (req.method !== "POST" || req.url !== "/webhooks/mercadolibre") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      let rawBody = "";
      req.on("data", (chunk: Buffer) => {
        rawBody += chunk.toString("utf-8");
      });

      req.on("end", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(rawBody);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }

        const response = handle(parsed);

        const respHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          ...response.headers,
        };
        res.writeHead(response.status, respHeaders);
        res.end(JSON.stringify(response.body));
      });
    });

    server.listen(port, () => {
      console.log(`[webhook-ingestor] Listening on port ${port}`);
    });
  };

  // ── Stop server ───────────────────────────────────────────
  const stop = (): void => {
    if (server) {
      server.close();
      server = null;
      console.log("[webhook-ingestor] Stopped");
    }
  };

  return { handle, start, stop };
}
