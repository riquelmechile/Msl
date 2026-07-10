import type { CandidateProvenance, EvidenceId } from "@msl/domain";
import type { GraphEngine, SpreadingOptions } from "@msl/memory";

// ── Public types ─────────────────────────────────────────────────────

/** Context assembled from Cortex queries for a supplier product. */
export type SupplierCortexContext = {
  /** Supplier product nodes found via metadata query. */
  supplierItemNodes: Array<{
    id: number;
    label: string;
    metadata: Record<string, unknown>;
  }>;
  /** Nodes activated by spreading activation from the supplier item seeds. */
  activatedNodes: Array<{
    id: number;
    label: string;
    activation: number;
    depth: number;
  }>;
  supplierId: string;
  supplierItemId: string;
  /** Optional seller scope used during the query. */
  sellerId?: string;
};

// ── Cortex reasoner ──────────────────────────────────────────────────

/**
 * Thin Cortex wrapper for owned-ecommerce intelligence operations.
 *
 * All methods are synchronous (GraphEngine operations are in-process SQLite)
 * and accept a `GraphEngine` directly — the caller decides availability.
 * Seller isolation is enforced via `SpreadingOptions.sellerId` wherever
 * supported so that Plasticov and Maustian evidence never mix.
 */
export class OwnedEcommerceCortexReasoner {
  /**
   * Locate supplier-product nodes in Cortex and spread activation from them
   * to collect contextual evidence.
   *
   * Uses `queryByMetadata` to find nodes tagged with `type: "supplier_item"`
   * and the given `supplierItemId`, then calls `spreadActivation` from each.
   *
   * @param cortex — Active GraphEngine instance.
   * @param sellerId — When provided, scopes metadata queries and spread CTE
   *   to the seller's evidence (and global nodes).
   */
  findSupplierProductContext(
    cortex: GraphEngine,
    supplierId: string,
    supplierItemId: string,
    sellerId?: string,
  ): SupplierCortexContext {
    const supplierItemNodes = cortex.queryByMetadata({
      type: "supplier_item",
      itemId: supplierItemId,
      ...(sellerId ? { sellerId } : {}),
      limit: 10,
    });

    const allActivatedNodes: SupplierCortexContext["activatedNodes"] = [];

    for (const node of supplierItemNodes) {
      const spreadOptions: SpreadingOptions = {
        maxDepth: 3,
        activationThreshold: 0.01,
        decayFactor: 0.5,
        ...(sellerId ? { sellerId } : {}),
      };
      const spread = cortex.spreadActivation([node.id], spreadOptions);
      allActivatedNodes.push(...spread.activatedNodes);
    }

    // Deduplicate by node ID — keep highest activation
    const nodeMap = new Map<number, SupplierCortexContext["activatedNodes"][0]>();
    for (const node of allActivatedNodes) {
      const existing = nodeMap.get(node.id);
      if (!existing || node.activation > existing.activation) {
        nodeMap.set(node.id, node);
      }
    }

    const result: SupplierCortexContext = {
      supplierItemNodes,
      activatedNodes: [...nodeMap.values()],
      supplierId,
      supplierItemId,
    };
    if (sellerId !== undefined) {
      result.sellerId = sellerId;
    }
    return result;
  }

  /**
   * Spread activation from a single known supplier-item node.
   *
   * Useful when the caller already resolved the node ID (e.g. from a prior
   * context query) and wants to re-expand without re-running metadata search.
   */
  spreadFromSupplierItem(
    cortex: GraphEngine,
    supplierItemNodeId: number,
    sellerId?: string,
  ): {
    activatedNodes: Array<{ id: number; label: string; activation: number; depth: number }>;
  } {
    const spreadOptions: SpreadingOptions = {
      maxDepth: 3,
      activationThreshold: 0.01,
      decayFactor: 0.5,
      ...(sellerId ? { sellerId } : {}),
    };
    return cortex.spreadActivation([supplierItemNodeId], spreadOptions);
  }

  /**
   * Assemble `CandidateProvenance` from a {@link SupplierCortexContext}.
   *
   * Populates `supplierId`, `supplierItemId`, `cortexNodeIds`, and `evidenceIds`
   * from the active Cortex subgraph.  The source is always `"supplier-web-signal"`.
   */
  buildCandidateProvenance(context: SupplierCortexContext): CandidateProvenance {
    const cortexNodeIds: string[] = [
      ...new Set([
        ...context.supplierItemNodes.map((n) => String(n.id)),
        ...context.activatedNodes.map((n) => String(n.id)),
      ]),
    ];

    const evidenceIds: EvidenceId[] = [
      ...new Set([
        ...context.supplierItemNodes.map((n) => `cortex-node:${n.id}`),
        ...context.activatedNodes.map((n) => `cortex-evidence:${n.id}`),
      ]),
    ];

    return {
      source: "supplier-web-signal",
      sourceId: `supplier-web-signal:${context.supplierId}:${context.supplierItemId}`,
      supplierId: context.supplierId,
      snapshotIds: [],
      cortexNodeIds,
      evidenceIds,
    };
  }
}
