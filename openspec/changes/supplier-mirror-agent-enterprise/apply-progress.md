# Apply Progress: Supplier Mirror Agent Enterprise

## Mode

Standard apply mode. Strict TDD is not active; focused behavior/unit tests were added with the PR 1 and PR 2 work units.

## Delivery Boundary

- Strategy: stacked-to-main chained PRs.
- Previous slice: PR 1 — domain types and operational store.
- Current slice: PR 2 — supplier source adapter interfaces and read-only source adapters.
- Starts from: PR 1 domain/store branch stack with existing apply-progress merged from Engram observation #1436.
- Ends at: Supplier Mirror source adapter contracts, ML API-first read adapter, isolated scraper fallback parser/adapter, XKP enrichment adapter, exports, and focused MercadoLibre adapter tests.
- Out of scope for this slice: runtime polling, scheduler, CEO tools, publishing, price mutation, pause execution, Telegram wiring, DeepSeek routing, and any changes to the old Plasticov→Maustian sync guard.

## Completed Tasks

- [x] G.1 Do not reuse `assertPlasticovToMaustianDirection` for Supplier Mirror targeting; use explicit `target_policies`.
- [x] 1.1 Create `packages/domain/src/supplierMirror.ts`; update `packages/domain/src/preparedAction.ts` and `index.ts` with mirror action/types.
- [x] 1.2 Create `packages/memory/src/supplierMirrorStore.ts` and export it from `packages/memory/src/index.ts`.
- [x] 1.3 Test store migrations, snapshots, observations, policies, mappings, ledger skips, and confidence metadata in `packages/memory/src/memory.test.ts`.
- [x] 2.1 Create `packages/mercadolibre/src/supplierSource.ts` with ML API-first supplier reads and stock-authoritative evidence.
- [x] 2.2 Create `packages/mercadolibre/src/scraperFallback.ts` with isolated low-concurrency fallback evidence and no mutation exports.
- [x] 2.3 Test API stock authority, unsupported source evidence, API-gap fallback confidence, and XKP non-stock enrichment in `packages/mercadolibre/src/mercadolibre.test.ts`.

## Verification

- `npm test` — passed, 42 files / 1218 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed after formatting new files.
- `npm test -- packages/mercadolibre/src/mercadolibre.test.ts` — passed, 1 file / 146 tests.
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

## PR 1 Verification Fixes

- Added explicit policy traceability to `SupplierTargetMapping` and `item_mappings` via policy scope/supplier reference, so each mapping identifies the target policy alongside supplier item, target listing/account, and evidence IDs.
- Made `appendLedger()` duplicate handling explicit: duplicate idempotency keys return the existing ledger record, while duplicate ledger IDs with different idempotency keys throw a clear collision error instead of attempting to deserialize an undefined row.

## PR 1 Fix Verification

- `npm test -- packages/memory/src/memory.test.ts packages/domain/src/domain.test.ts` — passed, 2 files / 60 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
