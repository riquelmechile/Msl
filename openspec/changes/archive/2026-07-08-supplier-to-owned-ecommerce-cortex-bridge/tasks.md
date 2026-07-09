# Tasks: Supplier → Cortex → Owned Ecommerce Bridge

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~370 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-forecast |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: feature-branch-chain
400-line budget risk: Low

~370 lines over 5 files, all well under 800-line budget. Single PR.

## Phase 1: Bridge Foundation — SM→Cortex Ingestion

- [x] 1.1 Create `packages/memory/src/supplierMirrorCortexBridge.ts` — types (`SupplierCortexIngestionResult`) + node label conventions + `getOrCreateNode()` wrappers for 6 node types
- [x] 1.2 Implement `ingestSupplierToCortex` + `ingestAllSuppliersToCortex` — read SM store, create nodes + weighted edges (0.5–0.9)
- [x] 1.3 Implement `ingestFallbackLessonToCortex` + `getCortexNodeIdsForSupplierCandidate` — defensive `undefined` cortex param
- [x] 1.4 Unit tests: double-ingest idempotency, edge weights, all 6 node types created, stock node in-place update

## Phase 2: Ecommerce Candidate Bridge

- [x] 2.1 Create `packages/agent/src/conversation/supplierMirrorEcommerceBridge.ts` — `buildEcommerceCandidatesFromSupplierMirror` with `minStockStatus` filter + populate `supplierId`, `cortexNodeIds`, `snapshotIds`, `evidenceIds` in provenance
- [x] 2.2 Unit tests: stock filter (in-stock only by default), provenance fields populated, empty results on no matching items

## Phase 3: Tools + Re-exports

- [x] 3.1 Modify `packages/memory/src/index.ts` — re-export bridge types and functions
- [x] 3.2 Modify `packages/agent/src/conversation/supplierMirrorTools.ts` — wire `ingestFallbackLessonToCortex` into `recordFallbackLesson` + add `query_supplier_cortex_patterns` tool

## Phase 4: Bot Wiring

- [x] 4.1 Modify `packages/bot/src/index.ts` — startup seed (`ingestAllSuppliersToCortex`) + hourly sync interval with `.unref()` + error-tolerant catch

## Phase 5: Integration Verification

- [x] 5.1 Integration test: seed SM → ingest to Cortex → query via `queryByMetadata` → build ecommerce candidates → assert provenance populated with cortexNodeIds
