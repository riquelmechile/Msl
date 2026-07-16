# Tasks: Full Product Launch Cycle

## Review Workload Forecast

Estimated changed lines: 3000–3400 across 20 files

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

8 stacked PRs: Foundation → Recognition/Research → Creative → Listing → Orchestration (2 PRs) → Wiring → Telegram/E2E

## Phase 1: Foundation (PR 1)

- [x] 1.1 Create `packages/domain/src/productLaunch.ts` — ProductLaunch, ProductContext, ImageQualityScore + 9-state machine
- [x] 1.2 Create `packages/domain/src/productCatalog.ts` — ProductCatalogStore interface
- [x] 1.3 Create `packages/agent/src/workers/productCatalogStore.ts` — SQLite + migration for product_catalog/product_images/product_launches
- [x] 1.4 Tests: valid/invalid transitions, context accumulation, store CRUD, migration idempotency
  Test: `npm test -- productLaunch productCatalog productCatalogStore` | Rollback: remove new domain files + migration

## Phase 2: Recognition + Research (PR 2)

- [ ] 2.1 Create `packages/agent/src/workers/visionAnalyst.ts` — Google Lens → brand/model/color/category; low-confidence → CEO
- [ ] 2.2 Create `packages/agent/src/workers/catalogSpecialist.ts` — ML domain_discovery/search → catalog_product_id
- [ ] 2.3 Create `packages/agent/src/workers/marketResearcher.ts` — DeepSeek web search → specs/descriptions/URLs; fallback ML
- [ ] 2.4 Modify `packages/agent/src/conversation/lanes.ts` — ADD `product-recognition`, `product-research` lanes
- [ ] 2.5 Tests: recognition, multi-product, catalog lookup, research full/partial/fallback
  Test: `npm test -- visionAnalyst catalogSpecialist marketResearcher` | Rollback: remove 3 workers + 2 lanes

## Phase 3: Creative Production (PR 3)

- [x] 3.1 Create `packages/agent/src/workers/photoDirector.ts` — 0-100 score (4 dims) → USE_AS_REFERENCE | REGENERATE | DISCARD_AND_SEARCH
- [x] 3.2 Create `packages/agent/src/workers/imageScout.ts` — Google Lens image search → select clean ≥800px, resize 1200×1200
- [x] 3.3 Create `packages/agent/src/workers/studioArtist.ts` — wraps creativeStudioDaemon, lazy gen, MiniMax budget cap
- [x] 3.4 Modify `packages/agent/src/conversation/lanes.ts` — ADD `creative-production`
- [x] 3.5 Tests: quality thresholds, routing, image filtering, budget
  Test: `npm test -- photoDirector imageScout studioArtist` | Rollback: remove 3 workers + 1 lane

## Phase 4: Listing Composition (PR 4)

- [ ] 4.1 Create `packages/agent/src/workers/copywriter.ts` — DeepSeek: title ≤60 + description ≥200; Plasticov vs Maustian accounts
- [ ] 4.2 Create `packages/agent/src/workers/specTechnician.ts` — ML category attributes conditional validation
- [ ] 4.3 Create `packages/agent/src/workers/qualityInspector.ts` — ML items performance pre-flight
- [ ] 4.4 Modify `packages/agent/src/conversation/lanes.ts` — ADD `listing-composition`
- [ ] 4.5 Tests: account differentiation, attribute validation, quality prediction
  Test: `npm test -- copywriter specTechnician qualityInspector` | Rollback: remove 3 workers + 1 lane

## Phase 5: Orchestration Core (PR 5 + PR 6)

### PR 5: Coordinator

- [x] 5.1 Create `packages/agent/src/workers/productLaunchCoordinator.ts` — claims product-launch lane, delegates via bus, reports progress, escalates failures
- [x] 5.2 Modify `packages/agent/src/conversation/lanes.ts` — ADD `product-launch`
- [x] 5.3 Tests: delegation order, parallel execution, status, degradation paths
  Test: `npm test -- productLaunchCoordinator` | Rollback: remove coordinator + 1 lane

### PR 6: Cost Tracker + CEO Tools

- [x] 5.4 Create `packages/agent/src/economics/launchCostTracker.ts` — cost aggregation → WorkforceCostCacheLedger
- [x] 5.5 Create `packages/agent/src/conversation/tools/productLaunchTools.ts` — launch_product, query_launch_status, approve_launch
- [x] 5.6 Tests: cost tracking, ledger, tool validation
  Test: `npm test -- launchCostTracker productLaunchTools` | Rollback: remove tracker + tools

## Phase 6: Wiring + Integration + E2E (PR 7 + PR 8)

### PR 7: Daemon Registration

- [ ] 6.1 Modify `packages/agent/src/workers/daemonHandlerMap.ts` — register 11 daemon handlers
- [ ] 6.2 Modify `packages/agent/src/readiness/productionReadinessService.ts` — ADD product-launch capability
- [ ] 6.3 Tests: registration, readiness check, capability gating
  Test: `npm test -- daemonHandlerMap productionReadiness` | Rollback: revert registration + readiness

### PR 8: Telegram + E2E

- [ ] 6.4 Modify `packages/bot/src/index.ts` — ADD message:photo handler: download via ctx.getFile, save .msl/product-photos/{chatId}/{timestamp}.jpg, enqueue coordinator
- [ ] 6.5 Integration test: full pipeline with stubbed transports
- [ ] 6.6 E2E test: Telegram photo → full pipeline → approval-ready listing (Playwright, skip on unsupported platforms)
  Test: `npm run test:e2e` | Rollback: remove photo handler
