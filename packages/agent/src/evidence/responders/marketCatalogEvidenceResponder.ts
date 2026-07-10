import type {
  ConfidenceLevel,
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";
import type { EvidenceResponder } from "../evidenceResponseRouter.js";

// ── Fake transport contract ───────────────────────────────────────────

/** Minimal fake transport slice used by the market-catalog responder. */
export type MarketCatalogTransport = {
  /** Demand signal score (0–100 or null if unknown). */
  getDemandSignal(category: string): number | null;
  /** Number of active competitors in the category (or null). */
  getCompetitorCount(category: string): number | null;
  /** Average observed selling price in the category (or null). */
  getAverageObservedPrice(category: string): number | null;
  /** Price range { min, max } in the category (or null). */
  getPriceRange(category: string): { min: number; max: number } | null;
  /** Listing performance metrics for a given item (or null). */
  getListingPerformance(itemId: string): {
    views: number;
    conversionRate: number;
    salesVelocity: number;
  } | null;
};

// ── Responder ─────────────────────────────────────────────────────────

/**
 * Answers evidence requests of kind `market-demand`, `market-competition`,
 * and `listing-performance` by querying a fake OperationalReadModel transport.
 */
export class MarketCatalogEvidenceResponder implements EvidenceResponder {
  readonly agentId: EvidenceTargetAgentId = "market-catalog";

  private readonly transport: MarketCatalogTransport;

  constructor(transport: MarketCatalogTransport) {
    this.transport = transport;
  }

  canHandle(request: EvidenceRequestPayload): boolean {
    return (
      request.kind === "market-demand" ||
      request.kind === "market-competition" ||
      request.kind === "listing-performance"
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload> {
    const category = request.category;

    if (!category && request.kind !== "listing-performance") {
      return this.insufficient("No category provided for market evidence lookup.");
    }

    const demandSignal = category ? this.transport.getDemandSignal(category) : null;
    const competitorCount = category ? this.transport.getCompetitorCount(category) : null;
    const averageObservedPrice = category
      ? this.transport.getAverageObservedPrice(category)
      : null;
    const priceRange = category ? this.transport.getPriceRange(category) : null;
    const listingPerformance = request.candidateId
      ? this.transport.getListingPerformance(request.candidateId)
      : null;

    const hasAnyData =
      demandSignal !== null ||
      competitorCount !== null ||
      averageObservedPrice !== null ||
      listingPerformance !== null;

    if (!hasAnyData) {
      return this.insufficient("No market data available for the requested category or item.");
    }

    const confidence = this.computeConfidence({
      demandSignal,
      competitorCount,
      listingPerformance,
    });

    const structuredEvidence: Readonly<Record<string, unknown>> = {
      ...(demandSignal !== null ? { demandSignal } : {}),
      ...(competitorCount !== null ? { competitorCount } : {}),
      ...(averageObservedPrice !== null ? { averageObservedPrice } : {}),
      ...(priceRange !== null
        ? { priceRange: { min: priceRange.min, max: priceRange.max } }
        : {}),
      ...(listingPerformance !== null ? { listingPerformance } : {}),
    };

    return {
      type: "evidence-response",
      responseId: `er-${request.requestId}-${Date.now()}`,
      requestId: request.requestId,
      correlationId: request.correlationId,
      sourceAgentId: this.agentId,
      targetAgentId: request.sourceAgentId,
      ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
      ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
      status: "answered",
      answer: demandSignal !== null
        ? `Market demand signal: ${demandSignal}/100. ${competitorCount !== null ? `${competitorCount} competitors.` : ""}`
        : "Market data available — see structured evidence.",
      structuredEvidence,
      evidenceIds: [`ev-market-${request.requestId}`],
      confidence,
      blockers:
        demandSignal === null
          ? ["No demand signal available."]
          : demandSignal < 25
            ? ["Low demand signal — category may be weak."]
            : [],
      warnings:
        averageObservedPrice === null
          ? ["No observed price data — margin analysis may be incomplete."]
          : [],
      createdAt: new Date().toISOString(),
      noMutationExecuted: true,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private insufficient(reason: string): EvidenceResponsePayload {
    return {
      type: "evidence-response",
      responseId: `er-insufficient-${Date.now()}`,
      requestId: "unknown",
      correlationId: "unknown",
      sourceAgentId: this.agentId,
      targetAgentId: "unknown",
      status: "answered",
      answer: reason,
      structuredEvidence: {},
      evidenceIds: [],
      confidence: "low",
      blockers: [reason],
      warnings: [],
      createdAt: new Date().toISOString(),
      noMutationExecuted: true,
    };
  }

  private computeConfidence(input: {
    demandSignal: number | null;
    competitorCount: number | null;
    listingPerformance: ReturnType<MarketCatalogTransport["getListingPerformance"]>;
  }): ConfidenceLevel {
    const metrics: number[] = [];
    if (input.demandSignal !== null) metrics.push(input.demandSignal >= 50 ? 2 : 1);
    if (input.competitorCount !== null) metrics.push(input.competitorCount > 0 ? 2 : 1);
    if (input.listingPerformance !== null) metrics.push(2);

    if (metrics.length === 0) return "low";
    const avg = metrics.reduce((a, b) => a + b, 0) / metrics.length;
    if (avg >= 1.7) return "high";
    if (avg >= 1.0) return "medium";
    return "low";
  }
}
