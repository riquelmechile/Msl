# Apply Progress: Supplier Mirror Agent Enterprise

## Mode

Standard apply mode. Strict TDD is not active; focused behavior/unit tests were added with the PR 1, PR 2, and PR 3a work units.

## Delivery Boundary

- Strategy: stacked-to-main chained PRs.
- Previous slices: PR 1 — domain types and operational store; PR 2 — supplier source adapter interfaces and read-only source adapters.
- Current slice: PR 3a — Supplier Mirror worker foundation only.
- Starts from: PR 2 source adapter branch stack with existing OpenSpec and Engram apply-progress merged from observation #1436.
- Ends at: Supplier Mirror workers service exported from `packages/workers/src/index.ts`, disabled-by-default ~10-minute scheduler, explicit adapter registry, per-supplier ingestion rate limiter, ingestion persistence, and focused worker foundation tests.
- Deferred to PR 3b: monitor candidate selection, stock-break verification, safe pause/defer planner, ledger records, CEO notification events, and the required `mapping.targetSellerId` in `policy.targetSellerIds` enforcement before pause execution.
- Out of scope for this slice: safe pause execution, CEO Telegram tool UX, broad CEO prompt rewrites, pricing policy parsing/proposals, Cortex learning, DeepSeek routing/cost implementation, blind publishing, mass price mutation, and any changes to the old Plasticov→Maustian sync guard.

## Completed Tasks

- [x] G.1 Do not reuse `assertPlasticovToMaustianDirection` for Supplier Mirror targeting; use explicit `target_policies`.
- [x] 1.1 Create `packages/domain/src/supplierMirror.ts`; update `packages/domain/src/preparedAction.ts` and `index.ts` with mirror action/types.
- [x] 1.2 Create `packages/memory/src/supplierMirrorStore.ts` and export it from `packages/memory/src/index.ts`.
- [x] 1.3 Test store migrations, snapshots, observations, policies, mappings, ledger skips, and confidence metadata in `packages/memory/src/memory.test.ts`.
- [x] 2.1 Create `packages/mercadolibre/src/supplierSource.ts` with ML API-first supplier reads and stock-authoritative evidence.
- [x] 2.2 Create `packages/mercadolibre/src/scraperFallback.ts` with isolated low-concurrency fallback evidence and no mutation exports.
- [x] 2.3 Test API stock authority, unsupported source evidence, API-gap fallback confidence, and XKP non-stock enrichment in `packages/mercadolibre/src/mercadolibre.test.ts`.
- [x] 3.1 Create `packages/workers/src/supplierMirror/` registry, rate limiter, ingestion persistence, and disabled-by-default scheduler foundation.
- [x] 3.2 Wire disabled-by-default runtime in `packages/workers/src/index.ts` with ~10-minute jitter and per-supplier ingestion limits.
- [x] 3.3 Test registry, disabled scheduler, per-supplier rate limiting, and ingestion persistence in `packages/workers/src/workers.test.ts`.

## Deferred Tasks

- [ ] G.2 Block blind mass publishing/price mutation; allow pause only after short verification, approved policy, ledger, and CEO notice.
- [ ] 3.4 Create monitor candidate selection, stock-break verifier, and pause/defer planner.
- [ ] 3.5 Enforce that each approved mapping target is present in `policy.targetSellerIds` before any pause execution.
- [ ] 3.6 Test confirmed break pause, target-policy mismatch deferral, inconclusive skip/alert, idempotency keys, ledger records, and CEO notification events.

## Verification

- `npm test` — passed, 42 files / 1218 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed after formatting new files.
- `npm test -- packages/mercadolibre/src/mercadolibre.test.ts` — passed, 1 file / 146 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm test -- packages/workers/src/workers.test.ts` — passed, 1 file / 13 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.

## Notes

- First attempted `npm test -- --runInBand`; Vitest does not support Jest's `--runInBand` flag, so verification was rerun with the repository's configured `npm test` command.
- Supplier Mirror targeting is independent from the existing Plasticov→Maustian sync guard; no existing MercadoLibre sync files were changed.
- PR 2 verification cleanup added focused runtime coverage for `createUnsupportedSupplierSourceAdapter`, proving unsupported suppliers skip items/stock and return low-confidence unsupported evidence with requested source metadata.
- PR 2 used current MercadoLibre MCP documentation for Items & Searches. The docs confirm seller item search endpoints and warn that public `available_quantity` can be referential, so the adapter uses the authenticated API client path and treats item API payloads as the stock-authoritative evidence source.
- Scraper fallback is isolated behind evidence/confidence metadata and raw hash capture; it exports no mutation functions and only provides low/medium-confidence fallback evidence for API gaps.
- XKP enrichment is modeled as catalog enrichment only. Any stock-like XKP field is explicitly ignored for authority and normalized as `catalog-enrichment` with unknown quantity.
- PR 3a keeps Supplier Mirror runtime disabled by default. The scheduler uses a 10-minute default interval with jitter, and the service consumes explicit adapters/store ports so tests can mock ingestion without mutation scope.
- PR 3b must restore stock-break verification and safe pause workflow with explicit policy target membership enforcement before any pause execution.
- Per-supplier rate limiting is local to the worker foundation and skips ingestion cycles rather than forcing reads.

## PR 1 Verification Fixes

- Added explicit policy traceability to `SupplierTargetMapping` and `item_mappings` via policy scope/supplier reference, so each mapping identifies the target policy alongside supplier item, target listing/account, and evidence IDs.
- Made `appendLedger()` duplicate handling explicit: duplicate idempotency keys return the existing ledger record, while duplicate ledger IDs with different idempotency keys throw a clear collision error instead of attempting to deserialize an undefined row.

## PR 1 Fix Verification

- `npm test -- packages/memory/src/memory.test.ts packages/domain/src/domain.test.ts` — passed, 2 files / 60 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
