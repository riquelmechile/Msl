# Apply Progress: Operational Full-Context Ingestion

**Status**: All 17 tasks complete  
**Mode**: Standard (strict_tdd: false)  
**Date**: 2026-07-02

## Completed Tasks

- [x] 1.1 Add `MlcQuestionSummary`, `MlcQuestionsSnapshot`, `MlcQuestionsSearchResult` types
- [x] 1.2 Add `getQuestions` to `MlcApiClient`; implement in `createMlcReadMethods`
- [x] 1.3 Enhance `normalizeQuestions` for `MlcQuestionSummary` with `answerText`, `itemId`, `status`
- [x] 1.4 Add `paginateAll<T>` generic helper with `maxPages`, exhaustion stop
- [x] 1.5 Add per-kind freshness TTL constants
- [x] 2.1 `processSellerClaims` — `searchClaims()` → `paginateAll` → `upsertSnapshot(kind:"claim")`
- [x] 2.2 `processSellerQuestions` — `getQuestions()` → `paginateAll` → `upsertSnapshot(kind:"question")`
- [x] 2.3 `processSellerMessages` — `getMessages()` → `paginateAll` → `upsertSnapshot(kind:"message")`
- [x] 2.4 `processSellerReputation` — `getReputation()` → single `upsertSnapshot(kind:"reputation")`
- [x] 2.5 Refactor `ingestOrderSnapshots` → `processSellerOrders` using `paginateAll`; Cortex dual-write preserved
- [x] 3.1 Wire all 5 processors into `run()` loop with per-seller try/catch
- [x] 3.2 Save `upsertCheckpoint(sellerId, kind)` per processor when `operationalStore` present
- [x] 4.1 Unit test: `getQuestions` shape in `mercadolibre.test.ts`
- [x] 4.2 Unit test: `paginateAll` (exhaustion, maxPages, empty) in `backgroundIngestion.test.ts`
- [x] 4.3 Integration: entity snapshot writes (claims, questions, messages, orders, reputation)
- [x] 4.4 Integration: checkpoint resume per `(seller_id, kind)`
- [x] 4.5 Typecheck + lint pass (`npm run typecheck && npm run lint`)

## Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `packages/mercadolibre/src/index.ts` | Modified | Added `MlcQuestionSummary`, `MlcQuestionsSearchResult`, `MlcQuestionsSnapshot` types. Enhanced `normalizeQuestions` for question-specific fields. Added `getQuestions` to `MlcApiClient` + implementation. Updated `getOrders`/`getMessages` with optional pagination params and `paging` metadata. Modified `MlClient` interface for new `MlcQuestionsSnapshot` return type. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modified | Updated `getQuestions` stub test for new `MlcQuestionsSnapshot` shape. Verified `text`, `status`, `dateCreated`, `itemId` fields. |
| `packages/mercadolibre/src/sync/sync.test.ts` | Modified | Fixed `getQuestions` mock to return `MlcQuestionsSnapshot` shape. |
| `packages/domain/src/cacheFreshness.ts` | Modified | Added `"question"` to `BusinessSignalKind` union type. |
| `packages/domain/src/readSnapshot.ts` | Modified | Added `"claim"` and `"question"` to `ReadSnapshotKind` union type. |
| `packages/workers/src/insights/index.ts` | Modified | Added `question: "preguntas"` to `signalLabels` record. |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | Added `KIND_FRESHNESS_TTL`, `KIND_DEFAULT_MAX_PAGES`, `paginateAll` helper. Implemented 5 entity processors (`processSellerClaims`, `processSellerQuestions`, `processSellerMessages`, `processSellerReputation`, `processSellerOrders`). Removed old `ingestOrderSnapshots`. Wired all processors into `run()` loop. Checkpoints saved per processor. |
| `packages/agent/tests/conversation/backgroundIngestion.test.ts` | Modified | Added unit tests for `paginateAll` (5 cases), TTL constants (3 cases), checkpoint resume (2 cases), entity snapshot writes (5 cases). |
| `packages/agent/tests/conversation/syncTools.test.ts` | Modified | Fixed `getQuestions` mock to return `MlcQuestionsSnapshot` shape. |

## Verification

- **Typecheck**: ✅ Pass (`npm run typecheck`)
- **Lint**: ✅ Pass (`npm run lint`)
- **Format**: ✅ Pass (`npm run format:check`)
- **Tests**: ✅ 1026/1027 pass (1 pre-existing failure in `actorIntegration.test.ts`, unrelated)

## Deviations from Design

1. **`getQuestions` on `MlcApiClient` is optional** (`getQuestions?`) rather than required. This follows the existing pattern for `searchClaims` and avoids breaking all existing `MlcApiClient` mock objects across 40+ test files.
2. **`getOrders`/`getMessages` return types unchanged** — added optional `paging` metadata (`paging?: { total, offset, limit }`) to `MlcOrdersSnapshot`/`MlcMessagesSnapshot` instead of creating new paginated snapshot types. This preserves backward compatibility.
3. **Cortex nodes created per-entity** — claims, questions, messages each get individual `*_snapshot` Cortex nodes (mirroring `listing_snapshot` pattern) rather than aggregated per-cycle nodes. Orders retain the existing aggregated `order_snapshot` Cortex node for analytics compatibility.
4. **Domain types extended** — `BusinessSignalKind` and `ReadSnapshotKind` unions gained `"question"` and `"claim"` entries to support the new entity kind. No migration needed; these are additive.

## Issues Found

None. Implementation matches design and all artifact constraints.

## Workload / PR Boundary

- Mode: stacked-to-main (3 chained PRs)
- WU1 (Foundation): `getQuestions` + `paginateAll` + TTLs + tests — ~300 changed lines
- WU2 (Processors): 5 entity processors + order refactor + tests — ~450 changed lines
- WU3 (Wiring): `run()` loop + checkpoint + full-cycle tests — ~200 changed lines
- Total estimated: ~950 changed lines
