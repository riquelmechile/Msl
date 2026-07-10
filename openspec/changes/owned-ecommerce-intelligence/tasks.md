# Tasks: Owned Ecommerce Intelligence

## Review Workload Forecast

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: Medium

| # | Scope | PR | Lines |
|---|-------|-----|-------|
| 1 | Types, bridge, docs | PR 1 | ~775 |
| 2 | Reasoner, scorer, projection | PR 2 | ~770 |
| 3 | Daemon, tools, integration | PR 3 | ~690 |

## PR 1 — Foundation

### A: Domain Types (225 lines)

- [x] A1 — `packages/domain/src/supplierWebSignal.ts`: `SupplierWebSignalKind` (6 kinds), `SupplierWebSignal`, `RecommendedAction`, `isValidSupplierWebSignal` guard. (120 ln, none)
- [x] A2 — `packages/domain/src/index.ts`: `export * from "./supplierWebSignal.js"`. (3 ln, A1)
- [x] A3 — `packages/domain/src/ownedEcommerce.ts`: add `"supplier-web-signal"` to `CandidateSourceKind`, add `StorefrontCandidateScore`. (30 ln, A1)
- [x] A4 — `supplierWebSignal.test.ts`: table-driven, all 6 kinds, type guard, severity. Covers R1. (80 ln, A1-A3)

### B: Supplier Bridge (380 lines)

- [x] B1 — `supplierManagerDaemon.ts`: enqueue `supplier-web-signal` for 6 signal kinds: stock-gap, price-change, publish-opportunity (unfilled-mirror), new-supplier-product, stock-restored, stock-out. Missing evidence→collect-more-evidence. (250 ln, A1)
- [x] B2 — Dedupe key: `sws:{supplierId}:{itemId}:{signalKind}:{hourKey}`. (30 ln, B1)
- [x] B3 — `supplierManagerDaemon.supplier-web-signal.test.ts`: fake bus/stores, all 6 kinds, dedupe. Covers R2. (100 ln, B1-B2)

### G: Docs (160 lines)

- [x] G1 — `docs/architecture/owned-ecommerce-intelligence.md`: pipeline, components, isolation, flag, degradation. (80 ln)
- [x] G2 — Update `docs/supplier-to-owned-ecommerce-cortex-bridge.md`: signal contract section. (40 ln)
- [x] G3 — Update `docs/agent-enterprise-vision.md`: intelligence lane. (40 ln)

## PR 2 — Intelligence Core

### C: Reasoner + Service (360 lines)

- [x] C1 — `ownedEcommerceCortexReasoner.ts`: `findSupplierProductContext` (queryByMetadata+spreadActivation), `spreadFromSupplierItem`, `buildCandidateProvenance`. Seller isolation via `SpreadingOptions.sellerId`. (120 ln, A1/A3)
- [x] C2 — `ownedEcommerceIntelligenceService.ts`: `prepareFromSupplierWebSignal(signal)`→validate→Cortex→score→AccountBrain?→DeepSeek?→projection. Cortex unreachable→cortexUnavailable, no hardcoded rules. Optional deps nullable. (140 ln, C1/D1/D2)
- [x] C3 — `ownedEcommerceCortexReasoner.test.ts`: in-memory GraphEngine, seed nodes, isolation, empty Cortex. Covers R3. (100 ln, C1)

### D: Scorer + Projection (370 lines)

- [x] D1 — `storefrontCandidateScorer.ts`: pure `scoreCandidate(candidate,channel?)→StorefrontCandidateScore`. No stock/margin→do-not-publish, no images→request-creative-assets, stale→collect-more-evidence. (110 ln, A3)
- [x] D2 — `storefrontProjectionBuilder.ts`: pure `buildProjection(scored[],deepSeek?)→StorefrontProjectionPreparation`. Catalog, SEO, GEO, media, pricing, readiness. Missing→missingMedia, no DeepSeek→deterministic fallback. noMutationExecuted. (120 ln, A3/D1)
- [x] D3 — Scorer + projection tests: table-driven combos, missingMedia, fallback. Covers R4, R5 detection, R3 fallback. (140 ln, D1/D2)

## PR 3 — Integration

### E: Daemon + Tools (420 lines)

- [x] E1 — Rewrite `ownedEcommerceDaemon.ts`: claim signal→flag gate→validate→`intelligenceService.prepareFromSupplierWebSignal` per seller→CEO proposal. Tick backward compat, duplicates suppressed, noMutationExecuted. (180 ln, C2/A1; F1-F3 optional)
- [x] E2 — `ownedEcommerceTools.ts`: add `inspect_owned_ecommerce_candidate`, `prepare_storefront_projection`, `read_storefront_projection_status`. Read-only, noMutationExecuted. (100 ln, A3/D1/D2/OwnedEcommerceStore)
- [x] E3 — Daemon+tools tests: signal→proposal lifecycle, flag, duplicates, isolation, inspect/prepare/nonexistent. Covers R3, R7. (140 ln, E1/E2)

### F: Integration (270 lines)

- [x] F1 — Wire `AccountBrainService.compareAccountAssets` into C2: channelRecommendation in score. Absent→skip, stale→collect-more-evidence. (60 ln, C2)
- [x] F2 — Creative delegation: request-creative-assets→enqueue `CreativeAssetRequest`, 24h dedup, missingMedia refs. (50 ln, D1)
- [x] F3 — Work sessions: register observation (signal), lesson (blocked candidate), link proposal. Store down→silent. (60 ln, E1/daemonTypes)
- [x] F4 — Integration tests: mock AccountBrain, fake creative queue, fake sessionStore. Covers R5, R6, R7. (100 ln, F1-F3)
