import type {
  ConfidenceLevel,
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";
import type { EvidenceResponder } from "../evidenceResponseRouter.js";

// ── Fake transport contract ───────────────────────────────────────────

/** Minimal fake transport slice used by the supplier-manager responder. */
export type SupplierManagerTransport = {
  /** Last-seen timestamp for a supplier or supplier item (ISO string or null). */
  getLastSeenAt(supplierId: string, supplierItemId?: string): string | null;
  /** Price freshness status: "fresh", "stale", or null. */
  getPriceFreshness(supplierId: string, supplierItemId?: string): string | null;
  /** Stock freshness status: "fresh", "stale", or null. */
  getStockFreshness(supplierId: string, supplierItemId?: string): string | null;
  /** Reliability score (0.0–1.0) or null. */
  getReliability(supplierId: string): number | null;
};

// ── Responder ─────────────────────────────────────────────────────────

/**
 * Answers evidence requests of kind `supplier-stock` and `supplier-freshness`
 * by querying a fake supplier mirror transport. Returns stock levels,
 * freshness, and supplier reliability.
 */
export class SupplierManagerEvidenceResponder implements EvidenceResponder {
  readonly agentId: EvidenceTargetAgentId = "supplier-manager";

  private readonly transport: SupplierManagerTransport;

  constructor(transport: SupplierManagerTransport) {
    this.transport = transport;
  }

  canHandle(request: EvidenceRequestPayload): boolean {
    return request.kind === "supplier-stock" || request.kind === "supplier-freshness";
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload> {
    const supplierId = request.supplierId;
    const supplierItemId = request.supplierItemId;

    if (!supplierId) {
      return this.insufficient("No supplier ID provided for supplier evidence lookup.");
    }

    const lastSeenAt = this.transport.getLastSeenAt(supplierId, supplierItemId);
    const priceFreshness = this.transport.getPriceFreshness(supplierId, supplierItemId);
    const stockFreshness = this.transport.getStockFreshness(supplierId, supplierItemId);
    const reliability = this.transport.getReliability(supplierId);

    const hasAnyData =
      lastSeenAt !== null ||
      priceFreshness !== null ||
      stockFreshness !== null ||
      reliability !== null;

    if (!hasAnyData) {
      return this.insufficient(`No supplier data available for supplier ${supplierId}.`);
    }

    const confidence = this.computeConfidence({
      priceFreshness,
      stockFreshness,
      reliability,
    });

    const structuredEvidence: Readonly<Record<string, unknown>> = {
      supplierId,
      ...(supplierItemId !== undefined ? { supplierItemId } : {}),
      ...(lastSeenAt !== null ? { lastSeenAt } : {}),
      ...(priceFreshness !== null ? { priceFreshness } : {}),
      ...(stockFreshness !== null ? { stockFreshness } : {}),
      ...(reliability !== null ? { reliability } : {}),
    };

    const warnings: string[] = [];
    if (priceFreshness === "stale") {
      warnings.push("Supplier price data is stale — consider refreshing.");
    }
    if (stockFreshness === "stale") {
      warnings.push("Supplier stock data is stale — consider refreshing.");
    }
    if (reliability !== null && reliability < 0.5) {
      warnings.push("Supplier reliability is low — verify data before relying on it.");
    }

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
      answer:
        request.kind === "supplier-stock"
          ? `Stock freshness: ${stockFreshness ?? "unknown"}. Last seen: ${lastSeenAt ?? "never"}.`
          : `Supplier freshness: ${priceFreshness ?? "unknown"} / stock ${stockFreshness ?? "unknown"}.`,
      structuredEvidence,
      evidenceIds: [`ev-supplier-${request.requestId}`],
      confidence,
      blockers: [],
      warnings,
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
    priceFreshness: string | null;
    stockFreshness: string | null;
    reliability: number | null;
  }): ConfidenceLevel {
    const freshnessScore =
      (input.priceFreshness === "fresh" ? 2 : input.priceFreshness === "stale" ? 1 : 0) +
      (input.stockFreshness === "fresh" ? 2 : input.stockFreshness === "stale" ? 1 : 0);
    const reliabilityBonus =
      input.reliability !== null && input.reliability >= 0.7 ? 1 : 0;

    const total = freshnessScore + reliabilityBonus;
    if (total >= 4) return "high";
    if (total >= 2) return "medium";
    return "low";
  }
}
