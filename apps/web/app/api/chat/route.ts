import { NextRequest } from "next/server";
import {
  createAgentLoop,
  createSimulateActorTool,
  buildSystemPrompt,
  AutonomyLevel,
  type ConversationState,
  type Strategy,
  type StrategyStore,
  type AutonomyEngine,
  type ParsedRule,
} from "@msl/agent";

// ── API Key Auth ─────────────────────────────────────────────────────

const API_KEY = process.env.MSL_API_KEY;

/**
 * Validates the request's Authorization header against the configured API key.
 *
 * When `MSL_API_KEY` is not set, all requests are allowed (open mode).
 * Otherwise the caller must provide `Authorization: Bearer <key>`.
 */
function validateAuth(request: Request): { authorized: boolean; error?: string } {
  if (!API_KEY) return { authorized: true }; // no auth configured → open
  const auth = request.headers.get("authorization");
  if (!auth) return { authorized: false, error: "Missing Authorization header" };
  if (auth !== `Bearer ${API_KEY}`) return { authorized: false, error: "Invalid API key" };
  return { authorized: true };
}

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
    listActive(): Strategy[] {
      return strategies.filter((s) => s.status === "active");
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
    setLevel: (l: AutonomyLevel) => {
      level = l;
    },
    recordKpi: () => {
      /* no-op for demo */
    },
    evaluateDegradation: () => null,
    evaluatePromotion: () => ({ recommend: false, to: level }),
    canAutoApprove: (riskLevel: string) => riskLevel === "low",
  };
}

// ── Rate Limiter ────────────────────────────────────────────────────

const rateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 20; // requests
const RATE_LIMIT_WINDOW = 60_000; // per minute (ms)

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
 * Accepts a user message and conversation history, runs it through the
 * full agent loop (Cortex, strategies, actors, autonomy engine), and
 * streams the response back as Server-Sent Events.
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

  const body = (await req.json()) as { message: string; history?: ConversationState["messages"] };
  const message = body.message?.trim() ?? "";
  const history = body.history ?? [];

  if (!message) {
    return Response.json({ error: "El mensaje no puede estar vacío." }, { status: 400 });
  }

  const store = createDemoStrategyStore();
  const autonomyEngine = createDemoAutonomyEngine();

  const loop = createAgentLoop({
    systemPrompt: buildSystemPrompt("Plasticov"),
    mockClient: true,
    tools: [createSimulateActorTool()],
    store,
    autonomyEngine,
  });

  const state: ConversationState = {
    messages: history,
    contextWindowLimit: 50,
    sessionMetadata: {
      sellerId: "seller-mlc-demo",
      startedAt: new Date(),
      lastActivityAt: new Date(),
    },
  };

  const result = await loop.converse(message, state);

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
        autonomyLevel: AutonomyLevel[autonomyEngine.getCurrentLevel()],
        autonomyLevelNumber: autonomyEngine.getCurrentLevel(),
        hasProposal: !!result.proposal,
        strategiesActive: store.listActive().length,
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

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`),
      );

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
