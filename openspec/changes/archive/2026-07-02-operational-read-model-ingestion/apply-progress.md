# Apply Progress: Operational Read Model Ingestion

**Date**: 2026-07-02
**Mode**: Standard (strict_tdd: false)
**Delivery**: Single PR, stacked-to-main chain strategy, within 800-line budget

## Completed Tasks

### Phase 1: Foundation — SQLite Store
- [x] 1.1 Added `SnapshotRow` and `CheckpointRow` types
- [x] 1.2 Added `migrateOperationalStore(db)` with tables and index
- [x] 1.3 Implemented `createSqliteOperationalReadModel(db)` factory
- [x] 1.4 Exported factory and types from `packages/memory/src/index.ts`

### Phase 2: Core — Ingestion Dual-Write
- [x] 2.1 Extended `BackgroundIngestionConfig` with optional `operationalStore`
- [x] 2.2 Added `upsertSnapshot()` in `processSellerListings` loop
- [x] 2.3 Added `upsertCheckpoint()` after listing loop

### Phase 3: Testing
- [x] 3.1 Created `operationalReadModel.test.ts` — 23 tests
- [x] 3.2 Tested stale/partial/low-confidence → refresh-required
- [x] 3.3 Tested lane isolation (Plasticov vs Maustian)
- [x] 3.4 Tested checkpoint upsert/retrieve/isolation
- [x] 3.5 Tested `findEvidence` null and deterministic evidence_id
- [x] 3.6 Created `backgroundIngestion.test.ts` — 5 integration tests

### Phase 4: Verify
- [x] 4.1 `npm run typecheck` passes
- [x] 4.2 `npm test` — 993/994 pass (1 pre-existing failure in actorIntegration.test.ts, unrelated)
- [x] `npm run lint` passes
- [x] `npm run format:check` passes

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/memory/src/operationalReadModel.ts` | Modified | Added SnapshotRow, CheckpointRow types; Extended OperationalReadModelWriter with checkpoint methods; Added migrateOperationalStore(); Implemented createSqliteOperationalReadModel() factory |
| `packages/memory/src/index.ts` | Modified | Exported createSqliteOperationalReadModel, migrateOperationalStore, SnapshotRow, CheckpointRow |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | Added OperationalReadModelWriter import; Extended BackgroundIngestionConfig with operationalStore; Added dual-write in processSellerListings (upsertSnapshot per listing + upsertCheckpoint after loop); Exported processSellerListings for testing |
| `packages/memory/tests/operationalReadModel.test.ts` | Created | 23 tests covering store contract, lane isolation, checkpoint, freshness, evidence_id determinism |
| `packages/agent/tests/conversation/backgroundIngestion.test.ts` | Created | 5 integration tests verifying dual-write, checkpoint, lane isolation, and zero-store safety |

## Deviations from Design

None — implementation matches design. One minor addition: `OperationalReadModelWriter` was extended with `upsertCheckpoint` and `getCheckpoint` methods to match the task requirements, which the design's `BackgroundIngestionConfig` extension depends on.

## Issues Found

- Pre-existing test failure in `actorIntegration.test.ts` (CEO strategy guardrail mock assertion) — unrelated to this change
- `findEvidence`/`readSnapshot` had a falsy-empty-string branch issue for `entityId` — fixed by using `!== undefined` instead of truthiness check

## Workload / PR Boundary

- Mode: Single PR with stacked-to-main chain strategy
- Estimated review budget: ~550 added lines across 5 files
