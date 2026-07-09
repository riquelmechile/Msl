import type {
  CandidateEvidenceState,
  StorefrontCandidate,
  SupplierStockObservation,
} from "@msl/domain";
import { getCortexNodeIdsForSupplierCandidate, type SupplierMirrorStore } from "@msl/memory";
import type { GraphEngine } from "@msl/memory";
import type { StockAuthority } from "@msl/domain";
import crypto from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────

export type SupplierEcommerceCandidateInput = {
  supplierId: string;
  /** Minimum stock status to include. Items at or above this level qualify.
   *  Defaults to "in-stock". */
  minStockStatus?: "in-stock" | "low-stock" | "out-of-stock" | "unknown";
  /** Optional Cortex engine to populate cortexNodeIds. When omitted,
   *  cortexNodeIds will be empty. */
  cortex?: GraphEngine;
};

const STOCK_STATUS_RANK: Record<string, number> = {
  "in-stock": 4,
  "low-stock": 3,
  "out-of-stock": 2,
  unknown: 1,
};

function meetsMinStockStatus(
  status: SupplierStockObservation["status"],
  minStatus: SupplierStockObservation["status"],
): boolean {
  return (STOCK_STATUS_RANK[status] ?? 0) >= (STOCK_STATUS_RANK[minStatus] ?? 0);
}

function newestObservation(
  observations: readonly SupplierStockObservation[],
): SupplierStockObservation | undefined {
  return observations.length === 0
    ? undefined
    : [...observations].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildStockField(
  obs: SupplierStockObservation,
  evidenceId: string,
): StorefrontCandidate["stock"] {
  const authority: StockAuthority =
    obs.authority === "stock-authoritative"
      ? "stock-authoritative"
      : obs.authority === "fallback-evidence"
        ? "unknown"
        : "supplier-reported";

  const base: StorefrontCandidate["stock"] = {
    status: obs.status,
    authority,
    evidenceId,
  };

  if (obs.quantity !== null && obs.quantity !== undefined) {
    return { ...base, quantity: obs.quantity };
  }

  return base;
}

// ── Candidate builder ────────────────────────────────────────────────

/**
 * Builds `StorefrontCandidate[]` from Supplier Mirror data for a given
 * supplier. Each approved item mapping with sufficient stock becomes a
 * candidate with full provenance tracking.
 *
 * The agent uses these candidates to reason about owned ecommerce
 * opportunities — the bridge does NOT pre-filter or rank candidates.
 */
export async function buildEcommerceCandidatesFromSupplierMirror(
  store: SupplierMirrorStore,
  input: SupplierEcommerceCandidateInput,
): Promise<StorefrontCandidate[]> {
  const { supplierId, cortex } = input;
  const minStatus = input.minStockStatus ?? "in-stock";

  const supplier = await store.getSupplier(supplierId);
  if (!supplier) return [];

  const mappings = await store.listApprovedItemMappings(supplierId);
  if (mappings.length === 0) return [];

  const items = await store.listSupplierItemSnapshots(supplierId);
  const itemMap = new Map(items.map((i) => [i.supplierItemId, i]));

  const candidates: StorefrontCandidate[] = [];

  for (const mapping of mappings) {
    const item = itemMap.get(mapping.supplierItemId);
    if (!item) continue;

    // Get latest stock observation
    const observations = await store.listStockObservations(supplierId, mapping.supplierItemId);
    const latestStock = newestObservation(observations);

    // Filter by minimum stock status
    if (!latestStock || !meetsMinStockStatus(latestStock.status, minStatus)) continue;

    // Collect evidence IDs
    const snapshotEvidenceId = item.evidenceId;
    const stockEvidenceId = latestStock.evidenceId;
    const mappingEvidenceIds = [...mapping.evidenceIds];

    const allEvidenceIds = [snapshotEvidenceId, stockEvidenceId, ...mappingEvidenceIds].filter(
      Boolean,
    );

    // Build evidence state
    const evidenceState: CandidateEvidenceState = {
      stockFreshness:
        latestStock.confidence === "high"
          ? "fresh"
          : latestStock.confidence === "medium"
            ? "fresh"
            : "stale",
      marginFreshness: "unknown",
      supplierFreshness: item.confidence === "high" ? "fresh" : "stale",
      completeness: allEvidenceIds.length > 0 ? "complete" : "partial",
      evidenceIds: allEvidenceIds,
    };

    // Get Cortex node IDs (defensive — returns [] when cortex is undefined)
    const cortexNodeIds = getCortexNodeIdsForSupplierCandidate(
      cortex,
      supplierId,
      mapping.supplierItemId,
    );

    const candidate: StorefrontCandidate = {
      id: crypto.randomUUID(),
      itemRef: mapping.targetItemId,
      title: item.title,
      provenance: {
        source: "supplier-mirror",
        sourceId: `supplier-mirror:${supplierId}:${mapping.supplierItemId}`,
        supplierId: supplier.id,
        snapshotIds: [snapshotEvidenceId],
        cortexNodeIds: cortexNodeIds.map(String),
        evidenceIds: allEvidenceIds,
      },
      evidenceIds: allEvidenceIds,
      evidenceState,
      stock: buildStockField(latestStock, stockEvidenceId),
      blockedReasons: [],
      redactedReasons: [],
      createdAt: new Date().toISOString(),
    };

    candidates.push(candidate);
  }

  return candidates;
}
