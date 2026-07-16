import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import { DeepSeekRealTransport } from "../conversation/transports/deepseekTransport.js";
import { resolveDeepSeekRuntimeConfig } from "../conversation/deepseekRuntime.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Environment helpers ─────────────────────────────────────────────

function env(name: string, fallback = ""): string {
  return (globalThis as Record<string, unknown>).process
    ? ((globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } })
        .process.env[name] ?? fallback)
    : fallback;
}

// ── Input / Output types ─────────────────────────────────────────────

export type MarketResearcherInput = {
  brand: string;
  model: string;
  searchTerms: string[];
  sellerId?: string;
};

export type CompetitorPrice = {
  source: string;
  price: number;
  currency: string;
};

export type MarketResearcherOutput = {
  specs: string;
  competitorPrices: CompetitorPrice[];
  suggestedPrice: number;
  description: string;
};

// ── DeepSeek-based research ─────────────────────────────────────────

const STABLE_PREFIX = `You are the Market Researcher for MSL. Your role is to research product specifications, market prices, and competitive positioning.
When given a product (brand + model), return a structured JSON with:
- specs: detailed technical specifications
- competitorPrices: array of known market prices with source name, amount, and currency (CLP for Chile)
- suggestedPrice: a recommended listing price in the same currency
- description: a compelling marketplace description in Spanish

Be realistic with prices for the Chilean market. If you don't know exact specs, provide reasonable industry-standard specs.
Always respond with valid JSON matching this schema.`;

function buildResearchPrompt(input: MarketResearcherInput): string {
  const searchTerms = input.searchTerms.length > 0
    ? input.searchTerms.join(", ")
    : `${input.brand} ${input.model}`;

  return `Research this product and provide market intelligence:

Brand: ${input.brand}
Model: ${input.model}
Search Terms: ${searchTerms}

Respond ONLY with a JSON object containing: specs, competitorPrices (array with source, price, currency), suggestedPrice (number), description (string in Spanish).`;
}

// ── Stub mode ────────────────────────────────────────────────────────

function stubMarketResearch(input: MarketResearcherInput): MarketResearcherOutput {
  console.warn("[market-researcher] DEEPSEEK_API_KEY not set — returning stub data");

  return {
    specs: `Standard specifications for ${input.brand} ${input.model} — dimensions, weight, connectivity, and power specs as commonly available in the market.`,
    competitorPrices: [
      { source: "MercadoLibre", price: 99990, currency: "CLP" },
      { source: "Falabella", price: 109990, currency: "CLP" },
      { source: "Paris", price: 104990, currency: "CLP" },
    ],
    suggestedPrice: 89990,
    description: `${input.brand} ${input.model} — Producto nuevo, original, con garantía. Envío rápido a todo Chile. ¡Consulta por disponibilidad y precio al por mayor!`,
  };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Market Researcher daemon handler.
 *
 * Processes product-research messages from the agent bus.
 * Claims messages with `receiverAgentId: "product-research"`.
 *
 * 1. Parse the claimed message payload as MarketResearcherInput
 * 2. Use DeepSeek to research product specs, competition, pricing
 * 3. Return findings with market intelligence
 *
 * Cache-optimized: uses the stable prefix from LANE_CONTRACTS for
 * prompt caching via DeepSeekReasoningGateway.
 */
export const marketResearcher: DaemonHandler = async ({
  claim,
  bus,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: MarketResearcherInput;
  try {
    input = JSON.parse(claim.payloadJson) as MarketResearcherInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Market Researcher: invalid payload — could not parse MarketResearcherInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (!input.brand || !input.model) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Market Researcher: missing brand or model in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2. Check DeepSeek availability ───────────────────────────
  const resolved = resolveDeepSeekRuntimeConfig();
  if (!resolved.apiKey) {
    // Stub mode
    const stubOutput = stubMarketResearch(input);
    return buildSuccessResult(stubOutput, input, claim, bus, findings, messageIds, true);
  }

  // ── 3. Research via DeepSeek ──────────────────────────────────
  const transport = new DeepSeekRealTransport(resolved.apiKey, resolved.baseURL);
  const gateway = new DeepSeekReasoningGateway(transport);

  let output: MarketResearcherOutput;
  try {
    const reasonCall: Parameters<typeof gateway.reason>[0] = {
      laneId: "product-research",
      level: ReasoningLevel.Recommendation,
      stablePrefix: STABLE_PREFIX,
      volatileInput: buildResearchPrompt(input),
      departmentId: "market-researcher",
      agentId: "market-researcher",
    };
    if (input.sellerId) {
      reasonCall.sellerId = input.sellerId;
    }

    const result = await gateway.reason(reasonCall);

    if (result.status === "success" && result.rawResponse) {
      try {
        const parsed = JSON.parse(result.rawResponse) as Record<string, unknown>;
        output = {
          specs: typeof parsed.specs === "string" ? parsed.specs : "No specs available",
          competitorPrices: Array.isArray(parsed.competitorPrices)
            ? parsed.competitorPrices.map((p: Record<string, unknown>) => ({
                source: String(p.source ?? "Unknown"),
                price: Number(p.price) || 0,
                currency: String(p.currency ?? "CLP"),
              }))
            : [],
          suggestedPrice: Number(parsed.suggestedPrice) || 0,
          description: typeof parsed.description === "string"
            ? parsed.description
            : `Producto ${input.brand} ${input.model}`,
        };
      } catch {
        console.error("[market-researcher] Failed to parse DeepSeek response as JSON");
        output = stubMarketResearch(input);
      }
    } else {
      console.warn(
        `[market-researcher] DeepSeek reasoning returned ${result.status} — using stub`,
      );
      output = stubMarketResearch(input);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[market-researcher] DeepSeek call failed: ${errorMessage}`);
    output = stubMarketResearch(input);
  }

  return buildSuccessResult(output, input, claim, bus, findings, messageIds, false);
};

// ── Helper: build success result ─────────────────────────────────────

function buildSuccessResult(
  output: MarketResearcherOutput,
  input: MarketResearcherInput,
  claim: Parameters<DaemonHandler>[0]["claim"],
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  isStub: boolean,
) {
  const summary = isStub
    ? `Market Researcher (stub): ${input.brand} ${input.model} — suggested ${output.suggestedPrice} CLP`
    : `Market Researcher: ${input.brand} ${input.model} — suggested ${output.suggestedPrice} CLP, ${output.competitorPrices.length} competitors analyzed`;

  const payload: Record<string, unknown> = {
    type: "finding",
    summary,
    marketResearch: output,
    input: { brand: input.brand, model: input.model, searchTerms: input.searchTerms },
    nextAction: "prepare_product_launch",
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "product-research",
    receiverAgentId: "ceo",
    messageType: "market-research",
    payloadJson: JSON.stringify(payload),
    dedupeKey: `market-researcher-${claim.messageId}`,
  });
  messageIds.push(message.messageId);

  findings.push({
    kind: "opportunity",
    severity: "info",
    summary,
    evidenceIds: [claim.messageId, message.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
}
