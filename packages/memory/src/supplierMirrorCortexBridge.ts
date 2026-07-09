import type { GraphEngine } from "./cortex/engine.js";
import type { SupplierMirrorStore } from "./supplierMirrorStore.js";
import type { SupplierLearnedFallbackPolicy } from "@msl/domain";
import { DuplicateEdgeError } from "./cortex/types.js";

// ── Types ────────────────────────────────────────────────────────────

export type SupplierCortexIngestionResult = {
  supplierNodeId: number;
  itemNodeIds: number[];
  stockNodeIds: number[];
  mappingNodeIds: number[];
  lessonNodeIds: number[];
  edgesCreated: number;
};

// ── Edge weight helpers ──────────────────────────────────────────────

const WEIGHTS = {
  SUPPLIER_TO_ITEM: 0.8,
  ITEM_TO_STOCK: 0.7,
  ITEM_TO_MAPPING: 0.9,
  POLICY_TO_SUPPLIER: 0.7,
  LESSON_TO_SUPPLIER: 0.5,
} as const;

/**
 * Create an edge with a specific weight. Falls back to updating the weight
 * on an existing edge if a duplicate is detected (re-ingestion path).
 */
function createEdgeWithWeight(
  cortex: GraphEngine,
  source: number,
  target: number,
  weight: number,
): boolean {
  try {
    cortex.createEdge(source, target);
    // createEdge defaults weight to 0.5 — override to desired weight
    cortex.db
      .prepare("UPDATE edges SET weight = ? WHERE source = ? AND target = ?")
      .run(weight, source, target);
    return true;
  } catch (err) {
    if (err instanceof DuplicateEdgeError) {
      // Edge exists — update weight in case it changed
      cortex.db
        .prepare("UPDATE edges SET weight = ? WHERE source = ? AND target = ?")
        .run(weight, source, target);
      return false;
    }
    throw err;
  }
}

// ── Node label conventions ───────────────────────────────────────────

function supplierLabel(supplierId: string): string {
  return `supplier_${supplierId}`;
}

function itemLabel(supplierId: string, supplierItemId: string): string {
  return `supplier_item_${supplierId}_${supplierItemId}`;
}

function stockLabel(supplierId: string, supplierItemId: string): string {
  return `supplier_stock_${supplierId}_${supplierItemId}`;
}

function mappingLabel(supplierId: string, supplierItemId: string, targetSellerId: string): string {
  return `supplier_mapping_${supplierId}_${supplierItemId}_${targetSellerId}`;
}

function policyLabel(supplierId: string, scopeType: string, scopeId: string): string {
  return `supplier_policy_${supplierId}_${scopeType}_${scopeId}`;
}

function lessonLabel(supplierId: string, policyId: string): string {
  return `supplier_lesson_${supplierId}_${policyId}`;
}

// ── Ingestion ────────────────────────────────────────────────────────

/**
 * Ingest a single supplier and all its associated data into Cortex.
 *
 * Creates or updates concept nodes for the supplier profile, its items,
 * latest stock observations, approved mappings, target policies, and
 * learned fallback policies. All operations are idempotent.
 */
export async function ingestSupplierToCortex(
  store: SupplierMirrorStore,
  cortex: GraphEngine,
  supplierId: string,
): Promise<SupplierCortexIngestionResult> {
  const supplier = await store.getSupplier(supplierId);
  if (!supplier) {
    return {
      supplierNodeId: 0,
      itemNodeIds: [],
      stockNodeIds: [],
      mappingNodeIds: [],
      lessonNodeIds: [],
      edgesCreated: 0,
    };
  }

  let edgesCreated = 0;

  // ── 1. Supplier profile node ─────────────────────────────────────
  const supplierNode = cortex.getOrCreateNode(supplierLabel(supplier.id), {
    type: "supplier_profile",
    supplierId: supplier.id,
    name: supplier.name,
    primarySource: supplier.primarySource,
    enabled: supplier.enabled,
  });
  const supplierNodeId = supplierNode.id;

  // ── 2. Items ─────────────────────────────────────────────────────
  const items = await store.listSupplierItemSnapshots(supplierId);
  const itemNodeIds: number[] = [];
  const stockNodeIds: number[] = [];
  const mappingNodeIds: number[] = [];

  for (const item of items) {
    const itemNode = cortex.getOrCreateNode(itemLabel(supplierId, item.supplierItemId), {
      type: "supplier_item",
      supplierId,
      supplierItemId: item.supplierItemId,
      categoryId: item.categoryId ?? null,
      mlItemId: item.mlItemId ?? null,
      title: item.title,
      sku: item.sku ?? null,
      price: item.price ?? null,
      currency: item.currency ?? null,
      status: item.freshness,
      confidence: item.confidence,
      capturedAt: item.capturedAt,
    });
    itemNodeIds.push(itemNode.id);

    // Edge: supplier → item
    if (createEdgeWithWeight(cortex, supplierNodeId, itemNode.id, WEIGHTS.SUPPLIER_TO_ITEM)) {
      edgesCreated++;
    }

    // ── 2a. Latest stock observation ───────────────────────────────
    const observations = await store.listStockObservations(supplierId, item.supplierItemId);
    const latestObs =
      observations.length > 0
        ? observations.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]
        : null;

    if (latestObs) {
      const stockNode = cortex.getOrCreateNode(stockLabel(supplierId, item.supplierItemId), {
        type: "supplier_stock",
        supplierId,
        supplierItemId: item.supplierItemId,
        status: latestObs.status,
        quantity: latestObs.quantity,
        authority: latestObs.authority,
        confidence: latestObs.confidence,
        evidenceId: latestObs.evidenceId,
        capturedAt: latestObs.capturedAt,
      });
      stockNodeIds.push(stockNode.id);

      // Edge: item → stock
      if (createEdgeWithWeight(cortex, itemNode.id, stockNode.id, WEIGHTS.ITEM_TO_STOCK)) {
        edgesCreated++;
      }
    }

    // ── 2b. Approved mappings ─────────────────────────────────────
    const mappings = await store.listApprovedItemMappings(supplierId);
    const itemMappings = mappings.filter((m) => m.supplierItemId === item.supplierItemId);

    for (const mapping of itemMappings) {
      const mappingNode = cortex.getOrCreateNode(
        mappingLabel(supplierId, item.supplierItemId, mapping.targetSellerId),
        {
          type: "supplier_mapping",
          supplierId,
          supplierItemId: item.supplierItemId,
          targetSellerId: mapping.targetSellerId,
          targetItemId: mapping.targetItemId,
          state: mapping.state,
          approvedAt: mapping.approvedAt ?? null,
        },
      );
      mappingNodeIds.push(mappingNode.id);

      // Edge: item → mapping
      if (createEdgeWithWeight(cortex, itemNode.id, mappingNode.id, WEIGHTS.ITEM_TO_MAPPING)) {
        edgesCreated++;
      }
    }
  }

  // ── 3. Target policies ──────────────────────────────────────────
  const policies = await store.listTargetPolicies(supplierId);
  const lessonNodeIds: number[] = [];

  for (const policy of policies) {
    const policyNode = cortex.getOrCreateNode(
      policyLabel(supplierId, policy.scopeType, policy.scopeId),
      {
        type: "supplier_policy",
        supplierId,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        lowStockThreshold: policy.lowStockThreshold,
        autoPauseAllowed: policy.autoPauseAllowed,
        pricingPolicy: policy.pricingPolicy ?? null,
      },
    );

    // Edge: policy → supplier
    if (createEdgeWithWeight(cortex, policyNode.id, supplierNodeId, WEIGHTS.POLICY_TO_SUPPLIER)) {
      edgesCreated++;
    }
  }

  // ── 4. Learned fallback policies (lessons) ──────────────────────
  const lessons = await store.listLearnedFallbackPolicies(supplierId);

  for (const lesson of lessons) {
    const lessonNodeId = await ingestFallbackLessonToCortex(cortex, lesson);
    lessonNodeIds.push(lessonNodeId);

    // Edge: lesson → supplier
    if (createEdgeWithWeight(cortex, lessonNodeId, supplierNodeId, WEIGHTS.LESSON_TO_SUPPLIER)) {
      edgesCreated++;
    }
  }

  return {
    supplierNodeId,
    itemNodeIds,
    stockNodeIds,
    mappingNodeIds,
    lessonNodeIds,
    edgesCreated,
  };
}

/**
 * Ingest all enabled suppliers into Cortex.
 *
 * Runs concurrent ingestion for each supplier. Errors for individual
 * suppliers are caught and logged to avoid blocking the entire batch.
 */
export async function ingestAllSuppliersToCortex(
  store: SupplierMirrorStore,
  cortex: GraphEngine,
): Promise<SupplierCortexIngestionResult[]> {
  const suppliers = await store.listEnabledSuppliers();
  const results: SupplierCortexIngestionResult[] = [];

  for (const supplier of suppliers) {
    try {
      const result = await ingestSupplierToCortex(store, cortex, supplier.id);
      results.push(result);
    } catch (err) {
      console.error(`Supplier Mirror → Cortex ingestion failed for ${supplier.id}:`, err);
      results.push({
        supplierNodeId: 0,
        itemNodeIds: [],
        stockNodeIds: [],
        mappingNodeIds: [],
        lessonNodeIds: [],
        edgesCreated: 0,
      });
    }
  }

  return results;
}

/**
 * Ingest a single fallback lesson as a Cortex node.
 *
 * Creates or updates a `supplier_lesson` node with the lesson's metadata.
 * Returns the node ID. The caller is responsible for creating the
 * lesson → supplier edge.
 */
export async function ingestFallbackLessonToCortex(  // eslint-disable-line @typescript-eslint/require-await
  cortex: GraphEngine,
  lesson: SupplierLearnedFallbackPolicy,
): Promise<number> {
  const supplierId = (lesson.scope as Record<string, unknown>).supplierId as string | undefined;
  if (!supplierId) {
    throw new Error(`Cannot ingest fallback lesson ${lesson.id}: scope.supplierId is missing`);
  }

  const node = cortex.getOrCreateNode(lessonLabel(supplierId, lesson.id), {
    type: "supplier_lesson",
    supplierId,
    policyId: lesson.id,
    policyType: lesson.policyType,
    confidence: lesson.confidence,
    decision: lesson.decision,
    scope: lesson.scope,
    status: lesson.status,
  });

  return node.id;
}

/**
 * Returns Cortex node IDs for a supplier item's candidate provenance.
 *
 * Accepts `undefined` as a defensive no-op: returns `[]` when Cortex
 * isn't wired, so callers don't need separate existence checks.
 */
export function getCortexNodeIdsForSupplierCandidate(
  cortex: GraphEngine | undefined,
  supplierId: string,
  supplierItemId: string,
): number[] {
  if (!cortex) return [];

  const ids: number[] = [];

  // Item node (exact match)
  const itemLabel_ = `supplier_item_${supplierId}_${supplierItemId}`;
  const itemRow = cortex.db.prepare("SELECT id FROM nodes WHERE label = ?").get(itemLabel_) as
    { id: number } | undefined;
  if (itemRow) ids.push(itemRow.id);

  // Stock node (exact match)
  const stockLabel_ = `supplier_stock_${supplierId}_${supplierItemId}`;
  const stockRow = cortex.db.prepare("SELECT id FROM nodes WHERE label = ?").get(stockLabel_) as
    { id: number } | undefined;
  if (stockRow) ids.push(stockRow.id);

  // Mapping nodes (prefix match — multiple possible per item)
  const mappingPrefix = `supplier_mapping_${supplierId}_${supplierItemId}_`;
  const mappingRows = cortex.db
    .prepare("SELECT id FROM nodes WHERE label LIKE ?")
    .all(mappingPrefix + "%") as { id: number }[];
  ids.push(...mappingRows.map((r) => r.id));

  return ids;
}
