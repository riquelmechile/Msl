import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import {
  createAgentLoop,
  createSimulateActorTool,
  buildSystemPrompt,
  createAutonomyEngine,
  createSessionStore,
  createStrategyStore,
  AutonomyLevel,
  type ConversationState,
  type Strategy,
  type StrategyStore,
  type AutonomyEngine,
  type ParsedRule,
} from "@msl/agent";
import { getSupplierMirrorRuntimeFromEnv } from "@msl/memory";
import { validateAuth } from "./auth";

// ── API Key Auth ─────────────────────────────────────────────────────

// ── In-memory strategy store for the demo ──────────────────────────

function createDemoStrategyStore(): StrategyStore {
  const strategies: Strategy[] = [
    {
      id: 1,
      ruleType: "margin",
      ruleText: "margen mínimo 35% para todas las categorías",
      parsedRule: {
        ruleType: "margin",
        target: "margen",
        operator: ">=",
        value: "35%",
        priority: 9,
        originalText: "margen mínimo 35% para todas las categorías",
      },
      confidence: 0.95,
      status: "active",
      createdAt: "2026-06-20T10:00:00.000Z",
      updatedAt: "2026-06-20T10:00:00.000Z",
    },
    {
      id: 2,
      ruleType: "pricing",
      ruleText: "no competir por precio, priorizar margen antes que volumen",
      parsedRule: {
        ruleType: "pricing",
        target: "precio",
        operator: "priorizar",
        value: "margen sobre volumen",
        priority: 8,
        originalText: "no competir por precio, priorizar margen antes que volumen",
      },
      confidence: 0.9,
      status: "active",
      createdAt: "2026-06-20T10:05:00.000Z",
      updatedAt: "2026-06-20T10:05:00.000Z",
    },
    {
      id: 3,
      ruleType: "customer",
      ruleText: "responder reclamos en menos de 24 horas",
      parsedRule: {
        ruleType: "customer",
        target: "reclamo",
        operator: "responder",
        value: "< 24h",
        priority: 10,
        originalText: "responder reclamos en menos de 24 horas",
      },
      confidence: 1.0,
      status: "active",
      createdAt: "2026-06-20T10:10:00.000Z",
      updatedAt: "2026-06-20T10:10:00.000Z",
    },
  ];

  let nextId = strategies.length + 1;

  return {
    listActive(sellerId?: string): Strategy[] {
      return strategies.filter(
        (s) => s.status === "active" && (!sellerId || !s.sellerId || s.sellerId === sellerId),
      );
    },
    listActiveBySeller(sellerId: string): Strategy[] {
      return strategies.filter((s) => s.status === "active" && s.sellerId === sellerId);
    },
    insertStrategy(ruleText: string, parsedRule: ParsedRule, confidence: number): Strategy {
      const s: Strategy = {
        id: nextId++,
        ruleType: parsedRule.ruleType,
        ruleText,
        parsedRule,
        confidence,
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      strategies.push(s);
      return s;
    },
    archiveStrategy(id: number): void {
      const s = strategies.find((x) => x.id === id);
      if (s) s.status = "archived";
    },
    supersedeStrategy(oldId: number, newId: number): void {
      void newId;
      const old = strategies.find((x) => x.id === oldId);
      if (old) old.status = "superseded";
    },
  };
}

// ── In-memory autonomy engine for the demo ─────────────────────────

function createDemoAutonomyEngine(): AutonomyEngine {
  let level = AutonomyLevel.SUGIERE;

  return {
    getCurrentLevel: () => level,
    setLevel: (
      _sellerId: string,
      l: AutonomyLevel,

      _reason: string,
    ) => {
      level = l;
    },
    recordKpi: () => {
      /* no-op for demo */
    },
    getKpiHistory: () => [],
    getDegradationEvents: () => [],
    evaluateDegradation: () => null,
    evaluatePromotion: () => ({ recommend: false, to: level }),
    canAutoApprove: (_sellerId: string, riskLevel: string) => riskLevel === "low",
  };
}

// ── Rate Limiter ────────────────────────────────────────────────────

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20; // requests
const RATE_LIMIT_WINDOW = 60_000; // per minute (ms)

type ChatRequestBody = {
  message: string;
  history?: ConversationState["messages"];
  sessionId?: string;
};

const CLIENT_SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SELLER_ID_LENGTH = 128;
const PRE_NAMESPACE_DURABLE_STATE_TABLES = ["ceo_strategies", "autonomy_state"] as const;

type DurableChatState = {
  sqlitePath: string;
  sellerId: string;
  db: Database.Database;
  store: ReturnType<typeof createStrategyStore>;
  sessionStore: ReturnType<typeof createSessionStore>;
  autonomyEngine: ReturnType<typeof createAutonomyEngine>;
};

let durableState: DurableChatState | null = null;

function requireDurableSellerId(): string {
  const sellerId = process.env.MSL_CHAT_SELLER_ID?.trim();
  if (!sellerId || sellerId === "seller-mlc-demo" || sellerId.length > MAX_SELLER_ID_LENGTH) {
    throw new Error(
      "MSL_CHAT_SELLER_ID must be explicitly set to a non-demo seller id for durable chat.",
    );
  }
  return sellerId;
}

function assertDurableSellerNamespace(db: Database.Database, sellerId: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_seller_namespace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seller_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const existing = db.prepare("SELECT seller_id FROM chat_seller_namespace WHERE id = 1").get() as
    { seller_id: string } | undefined;

  if (!existing) {
    assertNoPreNamespaceDurableState(db);
    db.prepare("INSERT INTO chat_seller_namespace (id, seller_id) VALUES (1, ?)").run(sellerId);
    return;
  }

  if (existing.seller_id !== sellerId) {
    throw new Error("MSL_CHAT_SQLITE_PATH is already bound to a different seller id.");
  }
}

function tableHasRows(db: Database.Database, tableName: string): boolean {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  if (!table) return false;

  const row = db.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).get();
  return Boolean(row);
}

function assertNoPreNamespaceDurableState(db: Database.Database): void {
  const hasPreNamespaceDurableState = PRE_NAMESPACE_DURABLE_STATE_TABLES.some((tableName) =>
    tableHasRows(db, tableName),
  );

  if (hasPreNamespaceDurableState) {
    throw new Error(
      "MSL_CHAT_SQLITE_PATH contains durable state without a seller namespace; refusing to adopt it automatically.",
    );
  }
}

function getDurableChatState(sellerId: string): DurableChatState | null {
  const sqlitePath = process.env.MSL_CHAT_SQLITE_PATH?.trim();
  if (!sqlitePath) return null;
  if (durableState?.sqlitePath === sqlitePath) {
    if (durableState.sellerId !== sellerId) {
      throw new Error("MSL_CHAT_SQLITE_PATH is already bound to a different seller id.");
    }
    return durableState;
  }
  durableState?.db.close();
  durableState = null;

  const db = new Database(sqlitePath);
  try {
    assertDurableSellerNamespace(db, sellerId);
  } catch (error) {
    db.close();
    throw error;
  }
  durableState = {
    sqlitePath,
    sellerId,
    db,
    store: createStrategyStore(db),
    sessionStore: createSessionStore(db),
    autonomyEngine: createAutonomyEngine(db),
  };
  return durableState;
}

function parseClientSessionId(sessionId: string | undefined): string | null {
  const value = sessionId?.trim();
  if (!value) return crypto.randomUUID();
  return CLIENT_SESSION_ID_PATTERN.test(value) ? value : null;
}

function createDurableSessionKey(sellerId: string, clientSessionId: string): string {
  const normalizedSellerId = sellerId.trim();
  if (!normalizedSellerId || normalizedSellerId.length > MAX_SELLER_ID_LENGTH) {
    throw new Error("MSL_CHAT_SELLER_ID must be set and at most 128 characters.");
  }
  return `${normalizedSellerId}:${clientSessionId}`;
}

function createInitialState(
  history: ConversationState["messages"],
  sellerId: string,
): ConversationState {
  const now = new Date();
  return {
    messages: history,
    contextWindowLimit: 50,
    sessionMetadata: {
      sellerId,
      startedAt: now,
      lastActivityAt: now,
    },
  };
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  entry.count++;
  return { allowed: true };
}

// ── POST /api/chat ─────────────────────────────────────────────────

/**
 * Conversational agent chat endpoint.
 *
 * Accepts a user message and optional client session id, runs it through the
 * agent loop, then streams the response back as Server-Sent Events. By default
 * it stays local/demo with in-memory stores and mock LLM output. When durable
 * chat is configured, it persists state in seller-bound SQLite storage and can
 * use real DeepSeek if the API key is present.
 */
export async function POST(req: NextRequest) {
  // Auth check (before rate limit — unauthorised clients shouldn't burn quota)
  const auth = validateAuth(req);
  if (!auth.authorized) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate-limit check
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "127.0.0.1";
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(limit.retryAfter),
      },
    });
  }

  const body = (await req.json()) as ChatRequestBody;
  const message = body.message?.trim() ?? "";
  const history = body.history ?? [];
  const sessionId = parseClientSessionId(body.sessionId);

  if (!message) {
    return Response.json({ error: "El mensaje no puede estar vacío." }, { status: 400 });
  }

  if (!sessionId) {
    return Response.json({ error: "Invalid sessionId." }, { status: 400 });
  }

  const durableConfigured = Boolean(process.env.MSL_CHAT_SQLITE_PATH?.trim());
  let sellerId: string;
  let durable: DurableChatState | null;
  try {
    sellerId = durableConfigured
      ? requireDurableSellerId()
      : process.env.MSL_CHAT_SELLER_ID?.trim() || "seller-mlc-demo";
    durable = getDurableChatState(sellerId);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid durable chat configuration." },
      { status: 500 },
    );
  }
  const store = durable?.store ?? createDemoStrategyStore();
  const autonomyEngine = durable?.autonomyEngine ?? createDemoAutonomyEngine();
  const sellerName = process.env.MSL_CHAT_SELLER_NAME?.trim() || "Plasticov";
  const durableSessionKey = durable ? createDurableSessionKey(sellerId, sessionId) : sessionId;
  const useRealDeepSeek = Boolean(durable && process.env.DEEPSEEK_API_KEY);

  const supplierMirrorRuntime = getSupplierMirrorRuntimeFromEnv(process.env);

  const loop = createAgentLoop({
    systemPrompt: buildSystemPrompt(sellerName),
    mockClient: !useRealDeepSeek,
    sellerId,
    laneId: "ceo",
    tools: [createSimulateActorTool()],
    store,
    autonomyEngine,
    ...(supplierMirrorRuntime ? { supplierMirrorStore: supplierMirrorRuntime.store } : {}),
  });

  const state =
    durable?.sessionStore.load(durableSessionKey) ?? createInitialState(history, sellerId);

  const result = await loop.converse(message, state);
  durable?.sessionStore.save(durableSessionKey, result.updatedState);

  // Stream the response via SSE with a simulated typing effect.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const responseText = result.response;

      // Stream the response text in word-sized chunks for a natural feel.
      const words = responseText.split(/(?<=\s)/);
      for (const word of words) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "delta", content: word })}\n\n`),
        );
        // Small delay for typing effect — skip in production with real LLM.
        await new Promise((r) => setTimeout(r, 8));
      }

      // Send metadata after the text.
      const metadata: Record<string, unknown> = {
        type: "metadata",
        autonomyLevel: AutonomyLevel[autonomyEngine.getCurrentLevel(sellerId)],
        autonomyLevelNumber: autonomyEngine.getCurrentLevel(sellerId),
        hasProposal: !!result.proposal,
        strategiesActive: store.listActive().length,
        sessionId,
      };

      if (result.proposal) {
        metadata.proposal = {
          id: result.proposal.action.id,
          summary: result.proposal.naturalSummary,
          riskLevel: result.proposal.riskLevel,
          kind: result.proposal.action.kind,
        };
      }

      // Detect if an actor was consulted from the response text.
      if (/\bcomprador\b/i.test(responseText)) {
        metadata.consultedActor = "comprador";
      } else if (/\bcompetidor\b/i.test(responseText)) {
        metadata.consultedActor = "competidor";
      } else if (/\bproveedor\b/i.test(responseText)) {
        metadata.consultedActor = "proveedor";
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`));

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
