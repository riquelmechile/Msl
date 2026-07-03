# Apply Progress: Supplier Mirror Agent Enterprise

## Mode

Standard apply mode. Strict TDD is not active; focused behavior/unit tests were added with the PR 1 work unit.

## Delivery Boundary

- Strategy: stacked-to-main chained PRs.
- Current slice: PR 1 — domain types and operational store.
- Starts from: approved SDD proposal/design/tasks with no prior apply-progress artifact.
- Ends at: Supplier Mirror domain model, better-sqlite3 operational store, exports, and store/domain tests.
- Out of scope for this slice: runtime polling, source adapters, scheduler, CEO tools, scraping, publishing, pause execution, and DeepSeek routing.

## Completed Tasks

- [x] G.1 Do not reuse `assertPlasticovToMaustianDirection` for Supplier Mirror targeting; use explicit `target_policies`.
- [x] 1.1 Create `packages/domain/src/supplierMirror.ts`; update `packages/domain/src/preparedAction.ts` and `index.ts` with mirror action/types.
- [x] 1.2 Create `packages/memory/src/supplierMirrorStore.ts` and export it from `packages/memory/src/index.ts`.
- [x] 1.3 Test store migrations, snapshots, observations, policies, mappings, ledger skips, and confidence metadata in `packages/memory/src/memory.test.ts`.

## Verification

- `npm test` — passed, 42 files / 1218 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed after formatting new files.

## Notes

- First attempted `npm test -- --runInBand`; Vitest does not support Jest's `--runInBand` flag, so verification was rerun with the repository's configured `npm test` command.
- Supplier Mirror targeting is independent from the existing Plasticov→Maustian sync guard; no existing MercadoLibre sync files were changed.

## PR 1 Verification Fixes

- Added explicit policy traceability to `SupplierTargetMapping` and `item_mappings` via policy scope/supplier reference, so each mapping identifies the target policy alongside supplier item, target listing/account, and evidence IDs.
- Made `appendLedger()` duplicate handling explicit: duplicate idempotency keys return the existing ledger record, while duplicate ledger IDs with different idempotency keys throw a clear collision error instead of attempting to deserialize an undefined row.

## PR 1 Fix Verification

- `npm test -- packages/memory/src/memory.test.ts packages/domain/src/domain.test.ts` — passed, 2 files / 60 tests.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
