# Design: Operational Full-Context Ingestion

## Technical Approach

Add 5 entity processors to the background ingestion loop, extending the proven `processSellerListings` pattern (API call → paginate → upsert snapshot → checkpoint). Each processor follows the same dual-write contract (Cortex node + operational store when configured). Add `getQuestions` to `MlcApiClient` with a new `MlcQuestionSummary` type that captures question-specific fields instead of shoehorning into `MlcMessageSummary`.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| New `MlcQuestionSummary` vs reuse `MlcMessageSummary` | Reuse = zero new types, but loses `answer_text`/`item_id`/outcome. New type = richer Darwinian context. | New `MlcQuestionSummary` — proposal requires `answer_text` and outcome which `MlcMessageSummary` lacks. |
| Per-entity processor vs generic loop over kind array | Generic = DRY but forces identical upsert shapes per entity. Per-entity = slightly more code but each processor tailors snapshot structure. | Per-entity processors — matches existing `processSellerListings` pattern, easier to test in isolation. |
| Inline pagination in each processor vs shared paginator helper | Shared = less duplication but harder to customize per-endpoint. Inline = some repetition but each entity has different pagination semantics. | Shared `paginateAll` helper — all 5 endpoints return `{paging: {total, offset, limit}, results}`. Configurable `maxPages` per kind with default 100. |
| `getQuestions` on `MlcApiClient` (primary interface) vs only on `MlClient` (legacy) | `MlcApiClient` is the canonical typed client used by `backgroundIngestion`. | Add to `MlcApiClient` — `MlClient` already has it but `backgroundIngestion` consumes `MlcApiClient`. |

## Data Flow

```
run() loop per seller
  ├─ processSellerListings  (existing)
  ├─ processSellerClaims    → mlcClient.searchClaims() → paginateAll → upsertSnapshot(kind:"claim")
  ├─ processSellerQuestions  → mlcClient.getQuestions() → paginateAll → upsertSnapshot(kind:"question")
  ├─ processSellerOrders     (existing ingestOrderSnapshots, refactored)
  ├─ processSellerMessages   → mlcClient.getMessages()  → paginateAll → upsertSnapshot(kind:"message")
  ├─ processSellerReputation → mlcClient.getReputation() → upsertSnapshot(kind:"reputation")
  └─ upsertCheckpoint(sellerId, kind) per processor
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modify | Add `MlcQuestionSummary` type (~10 fields). Add `getQuestions` to `MlcApiClient` interface + `createMlcReadMethods`. Enhance `normalizeQuestions` to produce `MlcQuestionsSnapshot` with new type. Add exports. |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modify | Add `processSellerClaims`, `processSellerQuestions`, `processSellerMessages`, `processSellerReputation`, `paginateAll` helper. Wire into `run()` loop. Add per-kind freshness config constants. |

## Interfaces / Contracts

```typescript
// New type in @msl/mercadolibre
export type MlcQuestionSummary = {
  id: string;
  text?: string;
  answerText?: string;
  status?: string;
  dateCreated?: string;
  itemId?: string;
};
export type MlcQuestionsSnapshot = MlcSingleReadSnapshot<MlcQuestionsSearchResult>;
export type MlcQuestionsSearchResult = {
  paging: { total: number; offset: number; limit: number };
  results: ReadonlyArray<MlcQuestionSummary>;
};

// New on MlcApiClient
getQuestions(sellerId: string, options?: { limit?: number; offset?: number }): Promise<MlcQuestionsSnapshot>;
```

```typescript
// Pagination helper in backgroundIngestion
type PaginationConfig = { maxPages: number; pageSize?: number };

async function paginateAll<T>(
  fetchPage: (offset: number) => Promise<{ total: number; results: T[] }>,
  config: PaginationConfig,
): Promise<T[]>;
```

**Freshness TTLs per kind:**

| Kind | `maxAgeMs` | Rationale |
|------|-----------|-----------|
| `claim`, `order` | 1h (3.6M ms) | High velocity — resolutions and statuses change frequently |
| `question` | 2h (7.2M ms) | Medium velocity — answers accumulate over hours not minutes |
| `message`, `reputation` | 6h (21.6M ms) | Low velocity — messages are archival, reputation updates slowly |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `normalizeQuestions` produces correct `MlcQuestionSummary` from ML API payload | Vitest — follow existing `mercadolibre.test.ts` patterns with mock payloads |
| Unit | `paginateAll` correctly respects `maxPages`, stops at exhaustion | Vitest — mock fetchPage with known total |
| Integration | Each new processor writes to operational store and creates Cortex nodes | Vitest — follow `backgroundIngestion.test.ts` pattern: in-memory DB + mock `MlcApiClient` |
| Integration | Checkpoints resume correctly per `(seller_id, kind)` | Vitest — verify no duplicate pages after checkpoint resume |
| E2E | Not applicable — no user-visible UI change | Skip |

## Rollout

No migration required. New processor functions are additive. Checkpoint `kind` values carry no constraint — old rows with `kind: "listing"` coexist with new rows. To roll back: remove wiring calls from `run()`. To roll forward: deploy, next cycle picks up all 5 entity types. No feature flag needed — optional `operationalStore` gate already exists.

## Open Questions

None.
