import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import { DeepSeekRealTransport } from "../conversation/transports/deepseekTransport.js";
import { resolveDeepSeekRuntimeConfig } from "../conversation/deepseekRuntime.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Input / Output types ─────────────────────────────────────────────

export type CopywriterInput = {
  sellerId: string;
  brand: string;
  model: string;
  specs: string;
  category: string;
  competitorPrices: Array<{ source: string; price: number }>;
};

export type CopywriterOutput = {
  title: string;
  description: string;
  accountTone: string;
};

// ── ML listing limits ─────────────────────────────────────────────────

const ML_TITLE_MAX_CHARS = 60;
const ML_DESCRIPTION_MAX_CHARS = 6000;

// ── Account tone mapping ──────────────────────────────────────────────

type AccountTone = "mid-market/value" | "premium/professional";

function getAccountTone(sellerId: string): AccountTone {
  const sourceId = (
    typeof process !== "undefined" ? process.env.MERCADOLIBRE_SOURCE_SELLER_ID : undefined
  )?.trim();
  const targetId = (
    typeof process !== "undefined" ? process.env.MERCADOLIBRE_TARGET_SELLER_ID : undefined
  )?.trim();
  if (targetId && sellerId === targetId) return "premium/professional";
  if (sourceId && sellerId === sourceId) return "mid-market/value";
  const normalized = sellerId.toLowerCase();
  if (normalized === "maustian") return "premium/professional";
  return "mid-market/value";
}

function getAccountToneLabel(tone: AccountTone): string {
  if (tone === "premium/professional") return "Premium/Professional";
  return "Mid-Market/Value";
}

// ── DeepSeek-based copywriting ────────────────────────────────────────

function buildSellerSpecificPrefix(sellerId: string): string {
  const tone = getAccountTone(sellerId);
  const toneLabel = getAccountToneLabel(tone);

  return `You are the Copywriter for MSL. Generate account-aware listing copy for MercadoLibre Chile (MLC).

Account tone: ${toneLabel}
${
  tone === "premium/professional"
    ? "- Maustian: emphasize quality, exclusivity, premium positioning. Use sophisticated Spanish. Focus on craftsmanship, materials, and buyer trust."
    : "- Plasticov: emphasize value, accessibility, volume. Use warm, approachable Spanish. Focus on price competitiveness, fast shipping, and broad appeal."
}

Rules:
- Title: max ${ML_TITLE_MAX_CHARS} characters. Start with brand, then key features. No all-caps, no excessive punctuation.
- Description: max ${ML_DESCRIPTION_MAX_CHARS} characters. Professional marketplace copy.
- Always respond in Spanish (the target market is Chile).
- Return ONLY a valid JSON object with fields: title, description, accountTone`;
}

function buildCopyPrompt(input: CopywriterInput): string {
  const prices =
    input.competitorPrices.length > 0
      ? input.competitorPrices
          .map((p) => `${p.source}: $${p.price.toLocaleString("es-CL")} CLP`)
          .join(", ")
      : "No competitor data available";

  return `Generate listing copy for:

Brand: ${input.brand}
Model: ${input.model}
Category: ${input.category}
Specifications: ${input.specs}
Competitor Prices: ${prices}`;
}

// ── Stub mode ────────────────────────────────────────────────────────

function stubCopywrite(input: CopywriterInput): CopywriterOutput {
  const tone = getAccountTone(input.sellerId);

  console.warn("[copywriter] DEEPSEEK_API_KEY not set — returning stub copy");

  const brand = input.brand;
  const model = input.model;

  if (tone === "premium/professional") {
    return {
      title: truncateTitle(`${brand} ${model} — Premium Edition | Calidad Superior`),
      description: `${brand} ${model} — Producto de alta gama con acabados premium. Diseñado para quienes buscan excelencia, durabilidad y rendimiento superior. Incluye garantía y soporte personalizado. Envío express a todo Chile con seguimiento en tiempo real.`,
      accountTone: "premium/professional",
    };
  }

  return {
    title: truncateTitle(`${brand} ${model} | Mejor Precio Garantizado`),
    description: `${brand} ${model} — ¡El mejor precio del mercado! Producto nuevo, original, con garantía. Envío rápido a todo Chile. Aprovecha nuestra oferta por tiempo limitado. Consulta por precios al por mayor y descuentos por volumen.`,
    accountTone: "mid-market/value",
  };
}

function truncateTitle(title: string): string {
  if (title.length <= ML_TITLE_MAX_CHARS) return title;
  return title.slice(0, ML_TITLE_MAX_CHARS - 3).trimEnd() + "...";
}

function truncateDescription(description: string): string {
  if (description.length <= ML_DESCRIPTION_MAX_CHARS) return description;
  return description.slice(0, ML_DESCRIPTION_MAX_CHARS - 3).trimEnd() + "...";
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Copywriter daemon handler.
 *
 * Claims messages with `receiverAgentId: "listing-composition"`.
 *
 * 1. Parse the claimed message payload as CopywriterInput
 * 2. Generate account-aware title + description via DeepSeek
 * 3. Enforce ML listing length limits
 * 4. Return findings with listing copy
 *
 * Cache-optimized: uses a stable lane prefix with seller-specific system prompt
 * for DeepSeek prompt caching via DeepSeekReasoningGateway.
 */
export const copywriter: DaemonHandler = async ({ claim, bus }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: CopywriterInput;
  try {
    input = JSON.parse(claim.payloadJson) as CopywriterInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Copywriter: invalid payload — could not parse CopywriterInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (!input.brand || !input.model || !input.sellerId) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Copywriter: missing brand, model, or sellerId in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  const accountTone = getAccountTone(input.sellerId);

  // ── 2. Check DeepSeek availability ───────────────────────────
  const resolved = resolveDeepSeekRuntimeConfig();
  if (!resolved.apiKey) {
    const stubOutput = stubCopywrite(input);
    return buildSuccessResult(stubOutput, input, claim, bus, findings, messageIds, true);
  }

  // ── 3. Generate copy via DeepSeek ────────────────────────────
  const transport = new DeepSeekRealTransport(resolved.apiKey, resolved.baseURL);
  const gateway = new DeepSeekReasoningGateway(transport);

  let output: CopywriterOutput;
  try {
    const reasonCall: Parameters<typeof gateway.reason>[0] = {
      laneId: "listing-composition",
      level: ReasoningLevel.Recommendation,
      stablePrefix: buildSellerSpecificPrefix(input.sellerId),
      volatileInput: buildCopyPrompt(input),
      departmentId: "copywriter",
      agentId: "copywriter",
      sellerId: input.sellerId,
    };

    const result = await gateway.reason(reasonCall);

    if (result.status === "success" && result.rawResponse) {
      try {
        const parsed = JSON.parse(result.rawResponse) as Record<string, unknown>;
        const rawTitle = typeof parsed.title === "string" ? parsed.title : "";
        const rawDescription = typeof parsed.description === "string" ? parsed.description : "";
        const rawAccountTone =
          typeof parsed.accountTone === "string" ? parsed.accountTone : accountTone;

        output = {
          title: truncateTitle(rawTitle) || `${input.brand} ${input.model}`,
          description:
            truncateDescription(rawDescription) ||
            `${input.brand} ${input.model} — Producto nuevo, original, con garantía. Envío rápido a todo Chile.`,
          accountTone: rawAccountTone || accountTone,
        };
      } catch {
        console.error("[copywriter] Failed to parse DeepSeek response as JSON");
        output = stubCopywrite(input);
      }
    } else {
      console.warn(`[copywriter] DeepSeek reasoning returned ${result.status} — using stub`);
      output = stubCopywrite(input);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[copywriter] DeepSeek call failed: ${errorMessage}`);
    output = stubCopywrite(input);
  }

  return buildSuccessResult(output, input, claim, bus, findings, messageIds, false);
};

// ── Helper: build success result ─────────────────────────────────────

function buildSuccessResult(
  output: CopywriterOutput,
  input: CopywriterInput,
  claim: Parameters<DaemonHandler>[0]["claim"],
  bus: Parameters<DaemonHandler>[0]["bus"],
  findings: DaemonFinding[],
  messageIds: string[],
  isStub: boolean,
) {
  const toneLabel = getAccountToneLabel(output.accountTone as AccountTone);
  const summary = isStub
    ? `Copywriter (stub): ${input.brand} ${input.model} — ${toneLabel} tone`
    : `Copywriter: ${input.brand} ${input.model} — ${toneLabel} tone, title: "${output.title.slice(0, 40)}..."`;

  const payload: Record<string, unknown> = {
    type: "finding",
    summary,
    listingCopy: output,
    input: {
      brand: input.brand,
      model: input.model,
      category: input.category,
      sellerId: input.sellerId,
    },
    nextAction: "validate_attributes",
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "listing-composition",
    receiverAgentId: "listing-composition",
    messageType: "copywriting-result",
    payloadJson: JSON.stringify(payload),
    dedupeKey: `copywriter-${claim.messageId}`,
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
