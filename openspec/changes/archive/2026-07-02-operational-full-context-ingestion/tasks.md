# Tasks: Operational Full-Context Ingestion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 800–1,000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved)
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | `getQuestions` + `paginateAll` + TTLs | PR 1 | Base: feature branch; ~250 lines; includes tests |
| 2 | 5 entity processors + order refactor | PR 2 | Base: PR 1 branch; ~450 lines; includes tests |
| 3 | Wiring into `run()` + checkpoint + full-cycle tests | PR 3 | Base: PR 2 branch; ~200 lines; includes tests |

## Phase 1: Foundation

- [x] 1.1 Add `MlcQuestionSummary`, `MlcQuestionsSnapshot`, `MlcQuestionsSearchResult` types to `packages/mercadolibre/src/index.ts`
- [x] 1.2 Add `getQuestions(sellerId, options?)` to `MlcApiClient` interface; implement in `createMlcReadMethods`; export new types
- [x] 1.3 Enhance `normalizeQuestions` to produce `MlcQuestionSummary` (not `MlcMessageSummary`) with `answerText`, `itemId`, `status`
- [x] 1.4 Add `paginateAll<T>` generic helper to `packages/agent/src/conversation/backgroundIngestion.ts` — respects `maxPages`, stops at exhaustion
- [x] 1.5 Add per-kind freshness TTL constants: `claim`/`order` 1h, `question` 2h, `message`/`reputation` 6h

## Phase 2: Entity Processors

- [x] 2.1 Implement `processSellerClaims`: `searchClaims()` → `paginateAll` → `upsertSnapshot(kind:"claim")`
- [x] 2.2 Implement `processSellerQuestions`: `getQuestions()` → `paginateAll` → `upsertSnapshot(kind:"question")`
- [x] 2.3 Implement `processSellerMessages`: `getMessages()` → `paginateAll` → `upsertSnapshot(kind:"message")`
- [x] 2.4 Implement `processSellerReputation`: `getReputation()` → `upsertSnapshot(kind:"reputation")` — single snapshot per cycle
- [x] 2.5 Refactor `ingestOrderSnapshots` → `processSellerOrders` using `paginateAll`; preserve Cortex dual-write path

## Phase 3: Wiring

- [x] 3.1 Wire all 5 processors into `run()` loop with per-seller try/catch inside Phase 1
- [x] 3.2 Save `upsertCheckpoint(sellerId, kind)` after each processor write when `operationalStore` is present

## Phase 4: Testing

- [x] 4.1 Unit: `getQuestions` shape from ML API payload — `packages/mercadolibre/src/mercadolibre.test.ts`
- [x] 4.2 Unit: `paginateAll` exhausts pages, respects `maxPages`, handles empty — `packages/agent/tests/conversation/backgroundIngestion.test.ts`
- [x] 4.3 Integration: each processor writes to operational store + creates Cortex nodes — same test file
- [x] 4.4 Integration: checkpoints resume without duplicate pages per `(seller_id, kind)` — same test file
- [x] 4.5 Typecheck + lint: `npm run typecheck && npm run lint`
