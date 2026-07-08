# Supplier Mirror → Cortex → Owned Ecommerce Bridge — Complete Analysis

> **Created:** 2026-07-08 | **Status:** Ready for implementation review

---

## 1. Current State of Each System

### 1.1 Supplier Mirror

**What it does:** Mirrors supplier catalogs (currently Jinpeng/XKP) into MSL with auditable evidence, CEO-led policies, and safe target-account synchronization. It is a local-first system — all data lives in a dedicated SQLite database, separate from the operational read model.

**Data Model (9 SQLite tables):**

| Table                                 | Domain Type                       | Key Fields                                                                                                                                      |
| ------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `suppliers`                           | `SupplierRegistryEntry`           | id, name, enabled, primarySource, metadata (JSON)                                                                                               |
| `supplier_items`                      | `SupplierItemSnapshot`            | supplierId + supplierItemId (PK), mlItemId, title, sku, categoryId, price, currency, snapshot (JSON), source, confidence, freshness, evidenceId |
| `stock_observations`                  | `SupplierStockObservation`        | id, supplierId, supplierItemId, source, authority, quantity, status (in-stock/low-stock/out-of-stock), confidence, evidenceId                   |
| `item_mappings`                       | `SupplierTargetMapping`           | supplierId + supplierItemId + targetSellerId + targetItemId (PK), policyRef, state (proposed/approved/paused/rejected), evidenceIds (JSON)      |
| `target_policies`                     | `SupplierTargetPolicy`            | scopeType+scopeId+supplierId (PK), targetSellerIds (JSON), lowStockThreshold, autoPauseAllowed, pricingPolicy (JSON)                            |
| `sync_ledger`                         | `SupplierMirrorLedgerRecord`      | id, actionType (publish-proposal/price-proposal/pause-listing/skip/defer), idempotencyKey (UNIQUE), status, evidenceIds, before/after (JSON)    |
| `notification_preferences`            | `SupplierNotificationPreference`  | scopeType+scopeId (PK), preference (JSON)                                                                                                       |
| `supplier_mirror_notification_events` | `SupplierMirrorNotificationEvent` | id, type (stock-break-confirmed/pause-deferred/verification-inconclusive), status, supplierId, evidenceIds, metadata                            |
| `learned_fallback_policies`           | `SupplierLearnedFallbackPolicy`   | id, policyType (pricing/targeting/stock/notification/error-outcome), scope (JSON), decision (JSON), confidence, status                          |

**Runtime Boundaries:**

- **Env gate:** `MSL_SUPPLIER_MIRROR_DB_PATH` — when set, the singleton store is auto-injected into bot, daemons, and web
- **Worker gate:** `MSL_SUPPLIER_MIRROR_WORKER_ENABLED=true` + CEO readiness approval
- **Runtime singleton:** `getSupplierMirrorRuntimeFromEnv()` in `supplierMirrorRuntime.ts` — caches the SQLite connection
- **Adapter pattern:** `SupplierSourceAdapter` with `collect()` method — currently only `mercadolibre-api` and `unsupported` adapters exist
- **Staged autonomy:** Evidence (Stage 1), Proposals (Stage 2), Verified Pause (Stage 3), Learned Policy (Stage 4) — currently at Stage 1/2

**APIs:**

- **Store interface:** `SupplierMirrorStore` — 21 methods (CRUD for each entity type)
- **CEO tools (7):** `review_supplier_mirror_readiness`, `review_supplier_mirror_opportunities`, `review_supplier_mirror_notifications`, `propose_supplier_mirror_pricing_policy`, `record_supplier_mirror_fallback_lesson`, `plan_supplier_mirror_deepseek_usage`, `analyze_supplier_mirror_evidence`
- **Worker:** Scheduler (10-min poll), Stock-break monitor, Jinpeng bootstrap

**What flows in/out:** Data enters via source adapters (MercadoLibre API calls), persists to the local SQLite store. Data leaves via CEO-facing tools (read-only summaries to the LLM). **No data flows to Cortex or Owned Ecommerce today.**

### 1.2 Owned Ecommerce (Medusa)

**What it does:** Creates and manages owned storefront surfaces (Medusa.js) under CEO governance. Currently all write paths are fail-closed — it's a preparation-only system.

**Data Model (packages/domain/src/ownedEcommerce.ts):**

- `StorefrontProjection` — Complete storefront spec with catalog, content, media, readiness checks, evidence chain
- `StorefrontCandidate` — A product candidate for the storefront, with provenance (`CandidateProvenance`), evidence state, stock authority, margin, guardrail results
- `MedusaCatalogProjection` — Medusa-specific catalog shape (collectionHandle, products with variants)
- `GuardrailResult` — Deterministic checks with severity (block/approval-required/warning)
- `EvidenceClaim` — Marketing claims with evidence binding
- `CandidateProvenance` — **Already has `source: CandidateSourceKind` (includes `"supplier-mirror"`), `supplierId?: string`, `cortexNodeIds?: string[]`, `snapshotIds: string[]`**

**Package: `@msl/ecommerce-medusa`:**

- Only dependency: `@msl/domain` (zero runtime deps)
- `MedusaWriteBoundary` — `publish()` and `activateCheckout()` methods, always fail-closed unless explicitly configured with `liveWriter`
- `createFailClosedMedusaWriteBoundary()` — default, rejects all writes
- `createConfiguredMedusaWriteBoundary()` — gated by `MEDUSA_RUNTIME_WRITE_ENABLED`, `MEDUSA_BACKEND_URL`, `MEDUSA_ADMIN_API_TOKEN`
- `createMedusaPreviewAdapter()` — builds preview refs but rejects actual publishes
- `buildMedusaStorefrontPreview()` — transforms `StorefrontProjection` → `MedusaStorefrontPreview`

**Runtime Boundaries:**

- **Env gates:** `MEDUSA_RUNTIME_WRITE_ENABLED=true`, `MEDUSA_BACKEND_URL`, `MEDUSA_ADMIN_API_TOKEN`
- **Write boundary:** Always fail-closed by default; live writer requires explicit injection
- **CEO gating:** All operations need explicit approval + fresh readiness + idempotency + audit trail

**What flows in/out:** Candidates enter via agent tooling (currently not implemented from supplier mirror). Projections are built and stored locally. Writes are always blocked in the LLM-facing path.

### 1.3 Cortex Neural Memory

**What it does:** SQLite-backed directed weighted graph with Hebbian learning, spreading activation, Darwinian pruning, and convergence detection. Stores learned relationships, business patterns, and distilled lessons — NOT operational snapshots.

**Data Model (5 SQLite tables):**

| Table               | Type              | Key Fields                                                                                             |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `nodes`             | `GraphNode`       | id (int), label (string), activation (real), metadata (JSON string)                                    |
| `edges`             | `GraphEdge`       | id, source, target (FK→nodes), weight (0.0-1.0), last_activated, co_occurrence_count, distilled_lesson |
| `darwinian_lessons` | `DarwinianLesson` | id, source_node, target_node, lesson, archived_at, reason                                              |
| `actor_simulations` | —                 | actor_type, query, result, created_at                                                                  |
| `probe_results`     | —                 | proposal_id, probe_type, outcome, created_at                                                           |

**APIs:**

- `createNode(label, metadata)` / `getNode(id)` — CRUD for nodes
- `createEdge(source, target)` — weight defaults to 0.5, rejects duplicates
- `reinforceEdge(source, target)` / `penalizeEdge(source, target)` — +0.1 / -0.15, clamped [0,1]
- `spreadActivation(nodeIds, options?)` — Recursive CTE, depth limit (default 3), threshold (0.01), decay (0.5)
- `findOrCreateConceptNode(label, metadata)` — Idempotent concept node
- `getOrCreateNode(label, metadata)` — Idempotent node with metadata update
- `queryByMetadata(filters)` — Query nodes by metadata fields (type, itemId, sellerId, status, categoryId, date range)
- `traverse()` — Returns activated nodes, traversed edges, lessons, flat LLM context
- `detectConvergence(snapshot)` — Cosine similarity between activation snapshots
- `prune(options?)` — Darwinian pruning of edges < 0.05, node cap archival
- `seedActorNodes(profiles)` / `reinforceActorOutcome(actorType, success)`
- `storeProbeResult(proposal)` — Honey-pot probe results with Hebbian update

**Runtime Boundaries:**

- **Env gate:** `MSL_CORTEX_SQLITE_PATH` or `MSL_TELEGRAM_CORTEX_SQLITE_PATH`
- **Instance:** `createGraphEngine(path?)` factory — returns `GraphEngine` wrapping a `better-sqlite3` Database
- **Integration pattern:** `GraphEngine` is passed to daemons via `DaemonContext`, used by Escribano observer, sync tools, and various daemons

**What flows in/out:** Cortex receives distilled signals via `getOrCreateNode()` from daemons. The Escribano observer applies Hebbian learning based on conversation outcomes. **No data flows from Supplier Mirror into Cortex today.**

---

## 2. Integration Points

### 2.1 Where the systems already touch (shared types)

The domain model already defines the bridge interfaces in `packages/domain/src/ownedEcommerce.ts`:

```typescript
// CandidateSourceKind already includes "supplier-mirror"
export type CandidateSourceKind =
  | "plasticov"
  | "maustian"
  | "supplier-mirror" // ← already defined
  | "future-supplier"
  | "read-model"
  | "cortex"; // ← already defined

// CandidateProvenance already has the bridge fields
export type CandidateProvenance = {
  source: CandidateSourceKind;
  sourceId: string;
  accountId?: string;
  supplierId?: string; // ← defined but never populated
  snapshotIds: string[];
  cortexNodeIds?: string[]; // ← defined but never populated
  evidenceIds: EvidenceId[];
};
```

**The types are ready. The implementation is missing.**

### 2.2 Supplier Mirror → Cortex integration points

**What should be mirrored from Supplier Mirror into Cortex:**

| Supplier Mirror Entity | Cortex Node Type        | Metadata                                                                      | Why                                        |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------ |
| Supplier               | `supplier_profile`      | { type, supplierId, name, primarySource, enabled }                            | Track supplier relationships               |
| Supplier Item          | `supplier_item`         | { type, supplierId, supplierItemId, categoryId, mlItemId, snapshot }          | Catalog knowledge for spreading activation |
| Stock Observation      | `supplier_stock`        | { type, supplierId, supplierItemId, status, quantity, authority, confidence } | Stock patterns over time                   |
| Approved Mapping       | `supplier_mapping`      | { type, supplierId, supplierItemId, targetSellerId, targetItemId }            | Cross-account relationship graph           |
| Target Policy          | `supplier_policy`       | { type, supplierId, scopeType, scopeId, pricingPolicy }                       | Pricing knowledge                          |
| Fallback Lesson        | `supplier_lesson`       | { type, supplierId, policyType, decision }                                    | Learned patterns                           |
| Notification Event     | `supplier_notification` | { type, supplierId, eventType, reason }                                       | Alert patterns                             |

**Cortex edges that should be created:**

| Source Node                       | Target Node                 | Weight |
| --------------------------------- | --------------------------- | ------ |
| Supplier → Supplier Item          | item belongs to supplier    | 0.8    |
| Supplier Item → Stock Observation | latest stock status         | 0.7    |
| Supplier Item → Mapping           | item is mapped to target    | 0.9    |
| Mapping → Target Seller           | mapping targets account     | 0.8    |
| Policy → Supplier                 | policy applies to supplier  | 0.7    |
| Fallback Lesson → Supplier        | lesson learned for supplier | 0.5    |
| Supplier Item → Category node     | item's category             | 0.5    |

### 2.3 Supplier Mirror → Owned Ecommerce integration points

When building `StorefrontCandidates` for owned ecommerce:

```
SupplierMirrorStore.listApprovedItemMappings()
  → populate CandidateProvenance.source = "supplier-mirror"
  → populate supplierId, snapshotIds, evidenceIds
```

### 2.4 Cortex → Owned Ecommerce integration points

The `cortexNodeIds` field in `CandidateProvenance` should be populated by querying Cortex for supplier-related nodes:

```typescript
const nodes = cortex.queryByMetadata({
  type: "supplier_item",
  supplierId: supplier.id,
  status: "in-stock",
  limit: 50,
});
```

---

## 3. Gap Analysis

### 3.1 Critical Gaps (blocks the bridge)

| #   | Gap                                                   | System | Details                                                                 |
| --- | ----------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| 1   | No Supplier Mirror → Cortex bridge                    | SM→CX  | New module needed: `supplierMirrorCortexBridge.ts`                      |
| 2   | No Supplier Mirror data in Owned Ecommerce candidates | SM→OE  | `listApprovedItemMappings()` never feeds `StorefrontCandidate` pipeline |
| 3   | No Cortex node IDs in Owned Ecommerce candidates      | CX→OE  | `cortexNodeIds` field exists but never populated                        |
| 4   | Fallback lessons are SQLite-only                      | SM→CX  | `SupplierLearnedFallbackPolicy` never reaches the graph                 |

### 3.2 Moderate Gaps

| #   | Gap                                                  | Details                                                                           |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| 5   | No concept node labels defined for supplier entities | Need naming convention: `supplier_${id}`, `supplier_item_${supplierId}_${itemId}` |
| 6   | No edge type taxonomy for supplier relationships     | Edges are just weights — metadata holds meaning                                   |
| 7   | Supplier Mirror store is separate SQLite DB          | Cannot span transactions across `SupplierMirrorStore` and `GraphEngine` DBs       |
| 8   | No idempotency in Cortex node creation               | Must use `getOrCreateNode()` to avoid duplicates                                  |

### 3.3 Env Vars and Runtime Configuration

| Env Var                        | Current Status | Needed For Bridge                              |
| ------------------------------ | -------------- | ---------------------------------------------- |
| `MSL_SUPPLIER_MIRROR_DB_PATH`  | ✅ Wired       | Already injected — store available at startup  |
| `MSL_CORTEX_SQLITE_PATH`       | ✅ Wired       | Already injected — engine available at startup |
| `MEDUSA_RUNTIME_WRITE_ENABLED` | ✅ Wired       | Not needed for bridge (read-only for SM→OE)    |

### 3.4 Domain Types to Add

Minimal — most types already exist. Suggested addition in `packages/domain/src/supplierMirror.ts`:

```typescript
export type SupplierMirrorCortexIngestion = {
  supplierId: SupplierId;
  nodes: Array<{ label: string; type: string; metadata: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; weight: number; label: string }>;
  ingestedAt: string;
};
```

**Node label conventions (standardize):**

- Suppliers: `supplier_${supplierId}`
- Items: `supplier_item_${supplierId}_${supplierItemId}`
- Categories: `supplier_category_${categoryId}`
- Policies: `supplier_policy_${supplierId}_${scopeType}_${scopeId}`
- Lessons: `supplier_lesson_${policyId}`
- Observations: `supplier_stock_${supplierId}_${supplierItemId}_${timestamp}`

---

## 4. Implementation Plan

### Phase 1: Supplier Mirror → Cortex Bridge

**Goal:** Write supplier data into the Cortex graph so that spreading activation and query-by-metadata can discover supplier patterns.

**Files to create:**

| File                                                | Purpose           |
| --------------------------------------------------- | ----------------- |
| `packages/memory/src/supplierMirrorCortexBridge.ts` | Core bridge logic |

**Key functions:**

```typescript
import type { GraphEngine } from "./cortex/engine.js";
import type { SupplierMirrorStore } from "./supplierMirrorStore.js";

export type SupplierCortexIngestionResult = {
  supplierNodeId: number;
  itemNodeIds: number[];
  stockNodeIds: number[];
  mappingNodeIds: number[];
  lessonNodeIds: number[];
  edgesCreated: number;
};

export async function ingestSupplierToCortex(
  store: SupplierMirrorStore,
  cortex: GraphEngine,
  supplierId: string,
): Promise<SupplierCortexIngestionResult> { ... }

export async function ingestAllSuppliersToCortex(
  store: SupplierMirrorStore,
  cortex: GraphEngine,
): Promise<SupplierCortexIngestionResult[]> { ... }

export async function ingestFallbackLessonToCortex(
  cortex: GraphEngine,
  lesson: SupplierLearnedFallbackPolicy,
): Promise<number> { ... }
```

**Key logic:**

1. `getSupplier()` → create/update `supplier_${id}` node (type: "supplier_profile")
2. `listSupplierItemSnapshots()` → create nodes (type: "supplier_item")
3. Create edges: supplier → item (weight 0.8)
4. `listStockObservations()` → latest only → create nodes (type: "supplier_stock")
5. Create edges: item → stock (weight 0.7)
6. `listApprovedItemMappings()` → create nodes (type: "supplier_mapping")
7. Create edges: item → mapping (weight 0.9)
8. `listLearnedFallbackPolicies()` → create nodes (type: "supplier_lesson") + edge to supplier

**Files to modify:**

| File                                                     | Change                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/memory/src/index.ts`                           | Re-export new bridge types and functions                           |
| `packages/agent/src/conversation/supplierMirrorTools.ts` | Wire `ingestFallbackLessonToCortex` into `recordFallbackLesson`    |
| `packages/bot/src/index.ts`                              | Optional startup seed: `ingestAllSuppliersToCortex(store, engine)` |

**Testing:**

- Unit test `ingestSupplierToCortex` with in-memory `SupplierMirrorStore` and `GraphEngine`
- Verify nodes created with correct labels and metadata
- Verify edges created with expected weights
- Verify idempotency (re-ingesting same supplier doesn't duplicate nodes)

### Phase 2: Supplier Mirror → Owned Ecommerce Candidate Bridge

**Goal:** Populate `StorefrontCandidate.provenance.supplierId` and evidence IDs from Supplier Mirror.

**Files to create:**

| File                                                               | Purpose                                     |
| ------------------------------------------------------------------ | ------------------------------------------- |
| `packages/agent/src/conversation/supplierMirrorEcommerceBridge.ts` | Bridge from SM data to ecommerce candidates |

**Key functions:**

```typescript
export type SupplierEcommerceCandidateInput = {
  supplierId: string;
  minStockStatus?: "in-stock" | "low-stock" | "out-of-stock" | "unknown";
};

export async function buildEcommerceCandidatesFromSupplierMirror(
  store: SupplierMirrorStore,
  input: SupplierEcommerceCandidateInput,
): Promise<StorefrontCandidate[]> { ... }
```

**Key logic:**

1. `store.getSupplier(supplierId)` for metadata
2. `store.listApprovedItemMappings(supplierId)` — only approved mappings
3. For each mapping, `store.listStockObservations(mapping.supplierId, mapping.supplierItemId)` for latest stock
4. Filter by `minStockStatus` (default `in-stock`)
5. Build `StorefrontCandidate` with `provenance.source: "supplier-mirror"`, `supplierId`, `snapshotIds`, `evidenceIds`

### Phase 3: Cortex → Owned Ecommerce bridge

**Goal:** Populate `CandidateProvenance.cortexNodeIds` with related cortex nodes.

**Key function (add to `supplierMirrorCortexBridge.ts`):**

```typescript
export function getCortexNodeIdsForSupplierCandidate(
  cortex: GraphEngine | undefined,
  supplierId: string,
  supplierItemId: string,
): number[] {
  if (!cortex) return [];
  const nodes = cortex.queryByMetadata({
    type: "supplier_item",
    itemId: `${supplierId}_${supplierItemId}`,
  });
  return nodes.map((n) => n.id);
}
```

### Phase 4: Wiring in Bot Startup

In `packages/bot/src/index.ts`, after both `engine` and `store` are available:

```typescript
if (engine && store) {
  ingestAllSuppliersToCortex(store, engine).catch((err) => {
    console.error("Supplier Mirror → Cortex seed failed:", err);
  });
}
```

And a periodic sync in the daemon scheduler (every hour):

```typescript
const supplierCortexSync = setInterval(
  async () => {
    const store = getSupplierMirrorRuntimeFromEnv()?.store;
    if (engine && store) {
      await ingestAllSuppliersToCortex(store, engine);
    }
  },
  60 * 60 * 1000,
);
```

---

## 5. Risk Assessment

### 5.1 What Could Go Wrong

| Risk                                               | Likelihood | Impact | Mitigation                                                                                           |
| -------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------- |
| **Cortex node explosion** from repeated ingestion  | Medium     | High   | Use `getOrCreateNode()` for stable entities. Only latest stock observation. Periodic `prune()`.      |
| **Cross-DB transaction inconsistency**             | High       | Medium | SM is source of truth. Cortex is secondary index for pattern detection. Accept eventual consistency. |
| **Bridge creates noise in spreading activation**   | Medium     | Medium | Conservative initial weights (0.5-0.7). `activationThreshold` filters weak paths.                    |
| **Duplicate CEO notifications** from bridge errors | Low        | Low    | Bridge is silent on failures (catch and log). CEO tools remain primary workflow.                     |
| **Edge weight decay from stale data**              | Low        | Low    | Update `last_activated` on periodic sync. `prune()` handles old edges.                               |

### 5.2 Safety Boundaries to Preserve

| Rule                                         | How to Preserve                                    |
| -------------------------------------------- | -------------------------------------------------- |
| No mutations from bridge                     | Never call ML write/execute tools from bridge code |
| Cortex is NOT source of truth for SM data    | Always read fresh SM data for decisions            |
| Supplier Mirror source authority rules apply | Preserve `authority` flag in cortex metadata       |
| No CEO approval bypass                       | Bridge is infrastructure, not agent workflow       |
| Bridge does not expose worker selection      | Workers stay internal                              |

### 5.3 Rollback Strategy

| Phase         | Rollback Action                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- |
| 1 (SM→Cortex) | Remove periodic sync. Remove `ingestFallbackLessonToCortex()` call. Prune cortex nodes if needed. |
| 2 (SM→OE)     | Remove bridge function from ecommerce candidate pipeline. Existing projections unaffected.        |
| 3 (CX→OE)     | Same as Phase 2. `cortexNodeIds` is optional — no data dependency risk.                           |
| All           | No SM or OE data is mutated by the bridge. Rollback = cease writing to Cortex.                    |

### 5.4 Ready for Implementation

**Yes.** The plan is actionable. Proceed in phases:

1. **Phase 1 — Highest Priority:** SM→Cortex bridge (~200 lines, 1 new file, 2 modified)
2. **Phase 2:** SM→OE candidate bridge (~100 lines, 1 new file)
3. **Phase 3:** CX→OE wiring (~50 lines, same file as Phase 1)
4. **Phase 4:** Bot startup wiring (~20 lines in `bot/src/index.ts`)

Total estimated: ~370 lines across 2 new files, 4 modified files.
