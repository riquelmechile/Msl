# Tasks: Operational Read Model Ingestion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 550–700 |
| 800-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Medium

## Phase 1: Foundation — SQLite Store

- [x] 1.1 Add `SnapshotRow` and `CheckpointRow` types to `packages/memory/src/operationalReadModel.ts`
- [x] 1.2 Add migration function `migrateOperationalStore(db)` — creates `operational_snapshots` + `ingestion_checkpoints` tables + `idx_snapshots_kind` index
- [x] 1.3 Implement `createSqliteOperationalReadModel(db: Database.Database): OperationalReadModel` factory — `upsertSnapshot`, `findEvidence`, `readSnapshot`, `upsertCheckpoint`, `getCheckpoint`
- [x] 1.4 Export factory from `packages/memory/src/index.ts`

## Phase 2: Core — Ingestion Dual-Write

- [x] 2.1 Extend `BackgroundIngestionConfig` with optional `operationalStore?: OperationalReadModelWriter` in `packages/agent/src/conversation/backgroundIngestion.ts`
- [x] 2.2 Add `store.upsertSnapshot()` call after each listing's Cortex `getOrCreateNode` in `processSellerListings` (kind=`"listing"`)
- [x] 2.3 Add `store.upsertCheckpoint(sellerId, "listing", capturedAt)` after the listing loop in `processSellerListings`

## Phase 3: Testing

- [x] 3.1 Create `packages/memory/tests/operationalReadModel.test.ts` — test upsert+read round-trip with fresh/complete/high-confidence snapshot
- [x] 3.2 Test stale/partial/low-confidence snapshots return `refresh-required` via `decideReadSnapshotFreshness`
- [x] 3.3 Test lane isolation: Plasticov query scoped to Plasticov seller_id, Maustian data not leaked
- [x] 3.4 Test checkpoint resume: upsert checkpoint → verify `getCheckpoint` returns correct `last_captured_at`
- [x] 3.5 Test `findEvidence` returns `null` for missing seller+kind; returns evidence with deterministic `evidence_id`
- [x] 3.6 Extend `packages/agent/tests/conversation/backgroundIngestion.test.ts` — mock `operationalStore`, assert `upsertSnapshot` called per listing, assert `upsertCheckpoint` called after loop

## Phase 4: Verify

- [x] 4.1 Run `npm run typecheck` — ensure no TS errors from new factory or config extension
- [x] 4.2 Run `npm test` — all unit + integration tests pass (993 pass, 1 pre-existing failure in actorIntegration.test.ts unrelated to this change)
