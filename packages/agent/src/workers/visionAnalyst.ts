import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import { enqueueProductLaunchResult, parseProductLaunchEnvelope } from "./productLaunchEnvelope.js";
import { LAUNCH_COST_ESTIMATES } from "../economics/launchCostTracker.js";

// ── Environment helpers ─────────────────────────────────────────────

function env(name: string, fallback = ""): string {
  return (globalThis as Record<string, unknown>).process
    ? ((globalThis as typeof globalThis & { process: { env: Record<string, string | undefined> } })
        .process.env[name] ?? fallback)
    : fallback;
}

// ── Input / Output types ─────────────────────────────────────────────

export type VisionAnalystInput = {
  imageUrl: string;
  caption?: string;
};

export type VisionAnalystOutput = {
  brand: string;
  model: string;
  color?: string;
  category?: string;
  confidence: number;
  searchTerms: string[];
  sourceUrls: string[];
  productTitle: string;
};

// ── SerpApi Google Lens search ───────────────────────────────────────

const SERPAPI_BASE_URL = "https://serpapi.com/search";

async function searchGoogleLens(imageUrl: string, caption?: string): Promise<VisionAnalystOutput> {
  const apiKey = env("SERPAPI_API_KEY");
  if (!apiKey) throw new Error("SERPAPI_API_KEY not set");

  const params = new URLSearchParams({
    engine: "google_lens",
    url: imageUrl,
    api_key: apiKey,
  });
  if (caption) params.set("q", caption);

  const response = await fetch(`${SERPAPI_BASE_URL}?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`SerpApi request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  return parseSerpApiResponse(data, imageUrl);
}

function parseSerpApiResponse(
  data: Record<string, unknown>,
  imageUrl: string,
): VisionAnalystOutput {
  const visualMatches = Array.isArray(data.visual_matches) ? data.visual_matches : [];
  const knowledgeGraph = (data.knowledge_graph ?? {}) as Record<string, unknown>;
  const _searchInformation = (data.search_information ?? {}) as Record<string, unknown>;

  // Extract brand and model from knowledge graph or visual matches
  let brand = "";
  let model = "";
  let productTitle = "";
  let category: string | undefined;
  let color: string | undefined;
  const searchTerms: string[] = [];
  const sourceUrls: string[] = [];

  // Knowledge graph extraction
  if (typeof knowledgeGraph.title === "string") {
    productTitle = knowledgeGraph.title;
  }
  if (typeof knowledgeGraph.brand === "string") {
    brand = knowledgeGraph.brand;
  }

  // Visual matches extraction
  for (const match of visualMatches as Array<Record<string, unknown>>) {
    if (typeof match.title === "string" && !productTitle) {
      productTitle = match.title;
    }
    if (typeof match.link === "string") sourceUrls.push(match.link);
    if (typeof match.source === "string") sourceUrls.push(match.source);
  }

  // Derive search terms from title
  const titleParts = productTitle.split(/\s+/).filter(Boolean);
  searchTerms.push(...titleParts.slice(0, 5));

  // Parse brand/model from title if not already found
  if (!brand && productTitle) {
    const words = productTitle.split(/\s+/).filter(Boolean);
    if (words.length > 0) brand = words[0]!;
    if (words.length > 1) model = words.slice(1).join(" ");
  }
  if (!model && brand && productTitle.startsWith(brand)) {
    model = productTitle.slice(brand.length).trim();
  }

  // Category from knowledge graph
  const kgType = Array.isArray(knowledgeGraph.type) ? String(knowledgeGraph.type[0] ?? "") : "";
  if (kgType) category = kgType;

  // Color extraction
  const kgColor =
    knowledgeGraph.color ?? knowledgeGraph.main_color ?? knowledgeGraph.dominant_color;
  if (typeof kgColor === "string") color = kgColor;

  // Confidence based on result quality
  const resultCount = visualMatches.length;
  const hasKg = Object.keys(knowledgeGraph).length > 1;
  let confidence: number;
  if (hasKg && resultCount >= 3) confidence = 0.85;
  else if (hasKg || resultCount >= 2) confidence = 0.65;
  else if (resultCount >= 1) confidence = 0.4;
  else confidence = 0.15;

  const result: VisionAnalystOutput = {
    brand,
    model,
    confidence,
    searchTerms: searchTerms.slice(0, 10),
    sourceUrls: [...new Set(sourceUrls)].slice(0, 5),
    productTitle: productTitle || `Product from ${imageUrl}`,
  };
  if (color) result.color = color;
  if (category) result.category = category;
  return result;
}

// ── Stub mode ────────────────────────────────────────────────────────

function stubRecognition(input: VisionAnalystInput): VisionAnalystOutput {
  console.warn("[vision-analyst] SERPAPI_API_KEY not set — returning stub data");

  const stubTitle = input.caption
    ? `Product: ${input.caption}`
    : "Sample Product from image recognition";

  return {
    brand: "GenericBrand",
    model: "Pro2024",
    color: "black",
    category: "electronics",
    confidence: 0.72,
    searchTerms: ["GenericBrand", "Pro2024", "bluetooth", "wireless", "electronics"],
    sourceUrls: ["https://example.com/product/pro2024"],
    productTitle: stubTitle,
  };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Vision Analyst daemon handler.
 *
 * Processes product-recognition messages from the agent bus.
 * Claims messages with `receiverAgentId: "product-recognition"`.
 *
 * 1. Parse the claimed message payload as VisionAnalystInput
 * 2. Call SerpApi Google Lens API to recognize the product from image
 * 3. If confidence < 0.5, enqueue a CEO proposal requesting more photos
 * 4. Return findings with recognition result
 */
export const visionAnalyst: DaemonHandler = async ({ claim, bus, launchCostTracker }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: VisionAnalystInput;
  try {
    input = JSON.parse(claim.payloadJson) as VisionAnalystInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Vision Analyst: invalid payload — could not parse VisionAnalystInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }
  const parsedLaunchEnvelope = parseProductLaunchEnvelope(claim);
  if (parsedLaunchEnvelope) {
    input.imageUrl = parsedLaunchEnvelope.imageUrls[0] ?? "";
    if (parsedLaunchEnvelope.caption) input.caption = parsedLaunchEnvelope.caption;
  }

  const usesExternalApi = !!env("SERPAPI_API_KEY");
  if (usesExternalApi && parsedLaunchEnvelope && launchCostTracker) {
    const budget = launchCostTracker.canAfford(
      parsedLaunchEnvelope.launchId,
      parsedLaunchEnvelope.sellerId,
      LAUNCH_COST_ESTIMATES.googleLensCall,
    );
    if (!budget.allowed) {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Vision Analyst: ${budget.reason}`,
        evidenceIds: [claim.messageId],
      });
      return { findings, proposalEnqueued: false, messageIds };
    }
  }

  if (!input.imageUrl) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Vision Analyst: missing imageUrl in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  // ── 2. Recognize ──────────────────────────────────────────────
  let output: VisionAnalystOutput;
  try {
    output = await searchGoogleLens(input.imageUrl, input.caption);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("SERPAPI_API_KEY not set")) {
      // Stub mode
      output = stubRecognition(input);
    } else {
      console.error(`[vision-analyst] SerpApi call failed: ${errorMessage}`);
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Vision Analyst: recognition failed — ${errorMessage}`,
        evidenceIds: [claim.messageId],
      });
      return { findings, proposalEnqueued: false, messageIds };
    }
  }

  if (usesExternalApi && parsedLaunchEnvelope && launchCostTracker) {
    launchCostTracker.record({
      eventKey: `launch-cost:${parsedLaunchEnvelope.launchId}:vision-analyst`,
      launchId: parsedLaunchEnvelope.launchId,
      sellerId: parsedLaunchEnvelope.sellerId,
      source: "google_lens",
      operation: "vision-recognition",
      estimatedCostUsd: LAUNCH_COST_ESTIMATES.googleLensCall,
    });
  }

  // ── 3. Low confidence → ask for more photos ────────────────────
  if (output.confidence < 0.5) {
    const askPayload: Record<string, unknown> = {
      type: "proposal",
      summary: `Vision Analyst: low confidence (${(output.confidence * 100).toFixed(0)}%) for product recognition. Please send more photos or a product link.`,
      partialResult: output,
      confidence: output.confidence,
      missingInputs: ["additional-photos", "product-link"],
      nextAction: "request_more_photos",
      noMutationExecuted: true,
      capturedAt: new Date().toISOString(),
    };

    const message = bus.enqueue({
      senderAgentId: "product-recognition",
      receiverAgentId: "ceo",
      messageType: "proposal",
      payloadJson: JSON.stringify(askPayload),
      dedupeKey: `vision-analyst-low-confidence-${claim.messageId}`,
    });
    messageIds.push(message.messageId);

    findings.push({
      kind: "alert",
      severity: "warning",
      summary: `Vision Analyst: low confidence (${(output.confidence * 100).toFixed(0)}%) — enqueued request for more photos`,
      evidenceIds: [claim.messageId, message.messageId],
    });

    return { findings, proposalEnqueued: true, messageIds };
  }

  // ── 4. Success — enqueue findings to CEO ───────────────────────
  const launchEnvelope = parsedLaunchEnvelope;
  if (launchEnvelope) {
    const message = enqueueProductLaunchResult(bus, claim, launchEnvelope, {
      brand: output.brand,
      model: output.model,
      ...(output.color ? { color: output.color } : {}),
      ...(output.category ? { category: output.category } : {}),
      searchTerms: output.searchTerms,
    });
    messageIds.push(message.messageId);
    findings.push({
      kind: "opportunity",
      severity: "info",
      summary: `Vision Analyst: recognized ${output.brand} ${output.model}`,
      evidenceIds: [claim.messageId, message.messageId],
    });
    return { findings, proposalEnqueued: true, messageIds };
  }

  const successPayload: Record<string, unknown> = {
    type: "finding",
    summary: `Vision Analyst: recognized ${output.brand} ${output.model} (confidence: ${(output.confidence * 100).toFixed(0)}%)`,
    recognition: output,
    nextAction: "research_product",
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const successMsg = bus.enqueue({
    senderAgentId: "product-recognition",
    receiverAgentId: "product-research",
    messageType: "finding",
    payloadJson: JSON.stringify(successPayload),
    dedupeKey: `vision-analyst-${claim.messageId}`,
  });
  messageIds.push(successMsg.messageId);

  findings.push({
    kind: "opportunity",
    severity: "info",
    summary: `Vision Analyst: ${output.brand} ${output.model} — ${output.productTitle} (${(output.confidence * 100).toFixed(0)}%)`,
    evidenceIds: [claim.messageId, successMsg.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
};
