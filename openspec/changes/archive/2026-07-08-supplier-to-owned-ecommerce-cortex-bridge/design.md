# Design: Supplier → Cortex → Owned Ecommerce Bridge

## Technical Approach

Two new bridge modules — `supplierMirrorCortexBridge.ts` (SM→Cortex) and `supplierMirrorEcommerceBridge.ts` (SM→OE) — plus wiring in `bot/src/index.ts` and `supplierMirrorTools.ts`. Cortex is a secondary index: SM remains source of truth, no ML mutations from bridge code, CEO approval gates preserved.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Node idempotency | `getOrCreateNode()` with stable labels | No duplicate nodes on re-ingestion; metadata updates in place on resync |
| Edge creation | Try `createEdge()`, catch `DuplicateEdgeError` silently | No `findOrCreateEdge` in engine; duplicate means edge exists |
| Stock nodes | Only latest observation per item | Prevents node explosion; stock-history patterns stay in SM DB |
| Cortex pruning bridge nodes | `prune({ excludeNodeIds })` with bridge-supplied IDs | Darwinian pruning must not delete supplier business-data nodes |
| Ecommerce candidate stock filter | `in-stock` default, `minStockStatus` parameter | CEO can broaden to `low-stock` for niche opportunities |

## Data Flow

```
Supplier Mirror (SQLite) ──[ingestSupplierToCortex]──▶ Cortex Graph (Nodes + Edges)
                                                                │
                                                    queryByMetadata + spreadActivation
                                                                │
                                                                ▼
                                                        Agent reasoning
                                                                │
                                                        [proposes candidates]
                                                                │
Supplier Mirror (SQLite) ──[buildEcommerceCandidates]──▶ StorefrontCandidate[]
  listApprovedItemMappings()       │                  provenance.source="supplier-mirror"
  listStockObservations()          │                  cortexNodeIds populated
```

## Provenance Field Mapping

The proposal scope requires populating these `StorefrontCandidate.provenance` fields from bridge data:

| Provenance field | Source in bridge | Ingestion result field |
|-----------------|------------------|----------------------|
| `supplierId` | `store.getSupplier(supplierId)` | supplier `id` |
| `snapshotIds` | `listSupplierItemSnapshots(supplierId)` → `evidenceId` per item | `itemNodeIds` correspond to item snapshots |
| `cortexNodeIds` | `getCortexNodeIdsForSupplierCandidate(cortex, supplierId, supplierItemId)` | `itemNodeIds` + `stockNodeIds` + `mappingNodeIds` for that item |
| `evidenceIds` | `listStockObservations(supplierId, supplierItemId)` → `evidenceId` + mapping `evidenceIds` | Combined `stockNodeIds` and `mappingNodeIds` evidence IDs |

`buildEcommerceCandidatesFromSupplierMirror` is responsible for populating all four fields before returning `StorefrontCandidate[]`.

### Node metadata properties per type

Each node type carries specific metadata set during ingestion:

| Node type | Metadata properties |
|-----------|-------------------|
| `supplier_profile` | `type, supplierId, name, primarySource, enabled` |
| `supplier_item` | `type, supplierId, supplierItemId, categoryId, mlItemId, title, sku, price, currency, status` |
| `supplier_stock` | `type, supplierId, supplierItemId, status, quantity, authority, confidence` |
| `supplier_mapping` | `type, supplierId, supplierItemId, targetSellerId, targetItemId, state` |
| `supplier_policy` | `type, supplierId, scopeType, scopeId, pricingPolicy` |
| `supplier_lesson` | `type, supplierId, policyType, confidence, decision` |

Agent reasoning queries depend on these properties. `queryByMetadata({ type: "supplier_item", supplierId, status: "in-stock" })` requires `status` on supplier_item nodes.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/memory/src/supplierMirrorCortexBridge.ts` | **Create** | Core bridge: ingestion, query helpers, node conventions |
| `packages/agent/src/conversation/supplierMirrorEcommerceBridge.ts` | **Create** | SM→OE candidate builder with provenance + cortexNodeIds |
| `packages/memory/src/index.ts` | Modify | Re-export `SupplierCortexIngestionResult`, `ingestSupplierToCortex`, `ingestAllSuppliersToCortex` |
| `packages/agent/src/conversation/supplierMirrorTools.ts` | Modify | Wire `ingestFallbackLessonToCortex()` into `recordFallbackLesson`; add `query_supplier_cortex_patterns` tool |
| `packages/bot/src/index.ts` | Modify | Startup seed (`ingestAllSuppliersToCortex`) + hourly sync interval |

## Interfaces / Contracts

### `supplierMirrorCortexBridge.ts`

```typescript
export type SupplierCortexIngestionResult = {
  supplierNodeId: number;
  itemNodeIds: number[];
  stockNodeIds: number[];
  mappingNodeIds: number[];
  lessonNodeIds: number[];
  edgesCreated: number;
};

export function ingestSupplierToCortex(
  store: SupplierMirrorStore,
  cortex: GraphEngine,
  supplierId: string,
): Promise<SupplierCortexIngestionResult>;

export function ingestAllSuppliersToCortex(
  store: SupplierMirrorStore,
  cortex: GraphEngine,
): Promise<SupplierCortexIngestionResult[]>;

export function ingestFallbackLessonToCortex(
  cortex: GraphEngine,
  lesson: SupplierLearnedFallbackPolicy,
): Promise<number>; // returns node id

/** Returns Cortex node IDs for a supplier item's candidate provenance.
 *  Accepts `undefined` as a defensive no-op: returns `[]` when Cortex isn't wired,
 *  so callers don't need separate existence checks. */
export function getCortexNodeIdsForSupplierCandidate(
  cortex: GraphEngine | undefined,
  supplierId: string,
  supplierItemId: string,
): number[];
```

### Node labels

| Entity | Label |
|--------|-------|
| Supplier | `supplier_${supplierId}` |
| Item | `supplier_item_${supplierId}_${supplierItemId}` |
| Category | `supplier_category_${categoryId}` |
| Stock obs | `supplier_stock_${supplierId}_${supplierItemId}` |
| Mapping | `supplier_mapping_${supplierId}_${supplierItemId}_${targetSellerId}` |
| Policy | `supplier_policy_${supplierId}_${scopeType}_${scopeId}` |
| Fallback lesson | `supplier_lesson_${supplierId}_${policyId}` |

### Edge weights (conservative)

```
supplier ──[0.8]──▶ supplier_item
supplier_item ──[0.7]──▶ supplier_stock
supplier_item ──[0.9]──▶ supplier_mapping
supplier_policy ──[0.7]──▶ supplier (policies attach to supplier)
supplier_lesson ──[0.5]──▶ supplier (lessons learned for supplier)
```

### `supplierMirrorEcommerceBridge.ts`

```typescript
export type SupplierEcommerceCandidateInput = {
  supplierId: string;
  minStockStatus?: "in-stock" | "low-stock" | "out-of-stock" | "unknown";
};

export function buildEcommerceCandidatesFromSupplierMirror(
  store: SupplierMirrorStore,
  input: SupplierEcommerceCandidateInput,
): Promise<StorefrontCandidate[]>;
```

## Agent Reasoning Design

The agent queries Cortex via existing tools plus new bridge-query tools:

1. **`queryByMetadata({ type: "supplier_item", supplierId, status: "in-stock" })`** — finds in-stock supplier items in the graph
2. **`spreadActivation(supplierNodeIds, { maxDepth: 2 })`** — discovers related nodes (items→stock, items→mappings)
3. Agent reasons on results and proposes `StorefrontCandidate` entries — no hardcoded pipeline
4. Cost-aware: supplier reasoning uses `DeepSeekReasoningGateway` cache-block pattern (stable prefix anchored)

### New tool: `query_supplier_cortex_patterns`

Added to `supplierMirrorTools.ts`, reads from Cortex (queryByMetadata + spreadActivation) and returns structured findings for the agent to reason on.

## Wiring and Runtime Integration

**Bot startup** (`bot/src/index.ts`, in `createTelegramBotFromEnv`):

```typescript
if (engine && supplierMirrorRuntime) {
  ingestAllSuppliersToCortex(supplierMirrorRuntime.store, engine)
    .catch(err => console.error("Supplier Mirror → Cortex seed failed:", err));
}
```

**Periodic sync** (hourly, same scope):
```typescript
const supplierCortexSync = setInterval(async () => {
  const runtime = getSupplierMirrorRuntimeFromEnv();
  if (engine && runtime) {
    await ingestAllSuppliersToCortex(runtime.store, engine);
  }
}, 60 * 60 * 1000);

// Ensure interval errors don't silently kill the timer:
supplierCortexSync.unref(); // doesn't keep process alive on its own
// Errors inside ingestAllSuppliersToCortex are caught internally and logged;
// the interval continues even after failures.
```

**Reactive trigger**: The stock-break monitor in `packages/workers/src/supplierMirror/` already detects stock changes. After this change, when a stock-break event is recorded:

1. **Publish side**: The supplier worker posts to the Agent Message Bus (SQLite-backed async queue) with type `stock-break`. The existing `AgentMessageBus` infrastructure handles delivery, deduplication, and claim/resolve/fail lifecycle.
2. **Consume side**: The agent's next evaluation cycle (or periodic daemon poll) claims pending `stock-break` messages from the bus via `AgentMessageBus.claimPending(type: "stock-break")`. If the item is currently published in the owned storefront, the agent auto-pauses the listing (autonomy level: advanced, safety action) and notifies the CEO via Telegram. This follows the same message-bus consumption pattern already used by specialist daemons.

**Price changes**: Handled by the hourly periodic sync — price data refreshes when `ingestAllSuppliersToCortex` re-runs every 60 minutes. Real-time price reactivity via the message bus is deferred to future work; the current 10-minute supplier worker poll + hourly Cortex sync provides sufficient freshness for ecommerce pricing proposals.

## Safety Boundaries

| Rule | Enforcement |
|------|------------|
| No ML mutations from bridge | Bridge never calls `msl_prepare_mercadolibre_write`, `msl_sync_product`, or any execute tool |
| Cortex is secondary index | All business decisions read fresh SM data via `SupplierMirrorStore` |
| CEO approval gates preserved | Bridge is infrastructure — agent-tool workflow retains `prepare → approve → execute` |
| No worker selection exposed | Workers stay internal; bridge doesn't expose enablement flags |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `ingestSupplierToCortex` idempotency | In-memory SM store + in-memory Cortex; call twice, assert node count unchanged |
| Unit | Edge creation with correct weights | Validate weight values on created edges |
| Unit | `buildEcommerceCandidatesFromSupplierMirror` stock filter | Seed approved mappings + stock observations, verify in-stock-only output |
| Integration | Full flow SM→Cortex→OE candidate | Single test: seed SM → ingest → query Cortex → build candidates → assert provenance populated |
| Unit | `ingestFallbackLessonToCortex` | Create lesson, call function, verify node + edge in Cortex |
