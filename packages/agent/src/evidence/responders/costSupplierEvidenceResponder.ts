import type {
  ConfidenceLevel,
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";
import type { EvidenceResponder } from "../evidenceResponseRouter.js";

// ── Fake transport contract ───────────────────────────────────────────

/** Minimal fake transport slice used by the cost-supplier responder. */
export type CostSupplierTransport = {
  /** Check if supplier cost data is known for a given supplier item. */
  isCostKnown(supplierItemId: string): boolean;
  /** Estimated supplier cost (or null if unknown). */
  getEstimatedCost(supplierItemId: string): number | null;
  /** Suggested sell price based on cost + target margin (or null). */
  getSuggestedPrice(supplierItemId: string): number | null;
  /** Current margin percentage (0.0–1.0) or null. */
  getMarginPct(supplierItemId: string): number | null;
  /** Check if stock information is known. */
  isStockKnown(supplierItemId: string): boolean;
  /** Available stock quantity or null. */
  getStockAvailable(supplierItemId: string): number | null;
  /** Freshness metadata (ISO date or descriptor). */
  getSupplierFreshness(supplierItemId: string): string | null;
};

// ── Responder ─────────────────────────────────────────────────────────

/**
 * Answers evidence requests of kind `cost-margin` by querying fake
 * cost-supplier transport. Returns structured cost/margin evidence
 * or `insufficient_evidence` when data is missing.
 */
export class CostSupplierEvidenceResponder implements EvidenceResponder {
  readonly agentId: EvidenceTargetAgentId = "cost-supplier";

  private readonly transport: CostSupplierTransport;

  constructor(transport: CostSupplierTransport) {
    this.transport = transport;
  }

  canHandle(request: EvidenceRequestPayload): boolean {
    return request.kind === "cost-margin";
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload> {
    const supplierItemId = request.supplierItemId;
    const supplierId = request.supplierId;

    if (!supplierItemId && !supplierId) {
      return this.insufficient("No supplier or supplier item reference on request.");
    }

    // Default to supplierItemId; fallback to supplierId if items are scoped by supplier
    const lookupKey = supplierItemId ?? supplierId!;

    const costKnown = this.transport.isCostKnown(lookupKey);
    const estimatedCost = this.transport.getEstimatedCost(lookupKey);
    const suggestedPrice = this.transport.getSuggestedPrice(lookupKey);
    const marginPct = this.transport.getMarginPct(lookupKey);
    const stockKnown = this.transport.isStockKnown(lookupKey);
    const stockAvailable = this.transport.getStockAvailable(lookupKey);
    const supplierFreshness = this.transport.getSupplierFreshness(lookupKey);

    if (!costKnown && estimatedCost === null && marginPct === null) {
      return this.insufficient("No cost or margin data available for the requested item.");
    }

    const confidence = this.computeConfidence({ costKnown, stockKnown, supplierFreshness });

    const structuredEvidence: Readonly<Record<string, unknown>> = {
      costKnown,
      ...(estimatedCost !== null ? { estimatedCost } : {}),
      ...(suggestedPrice !== null ? { suggestedPrice } : {}),
      ...(marginPct !== null ? { marginPct } : {}),
      stockKnown,
      ...(stockAvailable !== null ? { stockAvailable } : {}),
      ...(supplierFreshness !== null ? { supplierFreshness } : {}),
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
      status: confidence === "low" ? "answered" : "answered",
      answer: costKnown
        ? `Cost data available. Estimated cost: ${estimatedCost ?? "N/A"}, margin: ${marginPct !== null ? `${(marginPct * 100).toFixed(1)}%` : "N/A"}.`
        : "Partial cost data — some fields missing.",
      structuredEvidence,
      evidenceIds: [`ev-cost-${request.requestId}`],
      confidence,
      blockers:
        costKnown && marginPct !== null ? [] : ["Supplier cost data incomplete or missing margin."],
      warnings:
        supplierFreshness !== null && supplierFreshness.startsWith("stale")
          ? ["Supplier cost data may be stale — consider refreshing."]
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
    costKnown: boolean;
    stockKnown: boolean;
    supplierFreshness: string | null;
  }): ConfidenceLevel {
    if (input.costKnown && input.stockKnown && input.supplierFreshness === "fresh") {
      return "high";
    }
    if (input.costKnown || input.stockKnown) {
      return "medium";
    }
    return "low";
  }
}
