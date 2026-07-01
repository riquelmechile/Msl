# Design: MercadoLibre API Gaps 2026 — Slice 1

## Technical Approach

Follow the existing 27-endpoint pattern: summary types → `MlcReadSnapshot<T>` snapshots → normalizers using `asRecord`/`pushOptional`/`asArray`/`stringValue` → optional methods on `MlcApiClient` → implementations in `createMlcReadMethods`. Three additive endpoints, no architectural changes. Reuse existing `ReadSnapshotKind` values (`"listing"`, `"message"`) to avoid modifying the domain package.

## Architecture Decisions

| Choice | Alternatives | Rationale |
|--------|-------------|-----------|
| Reuse `kind: "listing"` for moderation | Add new `"moderation"` kind to domain | Image diagnostics already reuses `"listing"`. Adding a domain kind would require a cross-package change; zero benefit for this read-only work. |
| Reuse `kind: "message"` for notices & answer | New `"notice"` / `"question-answer"` kinds | Notices are seller communications (message family). Answer is question reply (also message family). Existing `normalizeQuestions` already maps questions → `kind: "message"`. |
| `getNotices` as single method with pagination params | Split into `getSellerNotices` + `getIntegratorNotices` | Token type determines response shape, not endpoint. Model both via optional fields (`dismiss_key?`, `title?`). Caller selects token identity externally. |
| `prepareAnswer` builds snapshot without API call | Call API with dry-run flag | ML API has no dry-run mode for `POST /answers`. Prepare-only = validate input, construct snapshot with `requiresApproval: true`, never call transport. |

## Data Flow

```
Safe-read (moderation, notices):
  ML API ──→ input.request() ──→ normalizeX() ──→ MlcReadSnapshot<T>
                                                       ↓
                                              @msl/tools read tool
                                                       ↓
                                              @msl/mcp tool

Prepare-only (answer):
  Input validation ──→ normalizeAnswer() (no API call) ──→ MlcReadSnapshot<MlcAnswerSummary>
  with requiresApproval: true, confidence: "low", completeness: "partial"
```

## New Types

| Type | Kind | Placement in index.ts |
|------|------|-----------------------|
| `MlcModerationStatusSummary` | Summary | After line 192 (near ImageDiagnostic) |
| `MlcModerationStatusSnapshot` | `MlcReadSnapshot<MlcModerationStatusSummary>` | After line 549 (snapshot aliases) |
| `MlcNoticesSummary` | Summary | After ModerationStatus |
| `MlcNoticesSnapshot` | `MlcReadSnapshot<MlcNoticesSummary>` | After line 549 |
| `MlcAnswerInput` | Input type | After NoticesSummary |
| `MlcAnswerSummary` | Summary | After MlcAnswerInput |
| `MlcAnswerSnapshot` | `MlcReadSnapshot<MlcAnswerSummary>` | After line 549 |

### Type shapes

```typescript
type MlcModerationStatusSummary = {
  itemId: string;
  blocked: boolean;
  date?: string;
  wordings: ReadonlyArray<{ kind: string; value: string }>;
  evidence: ReadonlyArray<{ textMatched?: string; sectionName?: string }>;
};

type MlcNoticesSummary = {
  notices: ReadonlyArray<{
    id: string;
    fromDate?: string;
    tags?: ReadonlyArray<string>;
    highlighted?: boolean;
    dismissKey?: string;  // seller tokens
    title?: string;       // integrator tokens
    actions: ReadonlyArray<{ label?: string; url?: string }>;
  }>;
  pagination: { total?: number; limit: number; offset: number };
  category?: string;
};

type MlcAnswerInput = { questionId: string; text: string };
type MlcAnswerSummary = {
  questionId: string;
  status: "pending";
  requiresApproval: true;
  noMutationExecuted: true;
  textLength: number;
};
```

## Normalizer Design

All follow `(input: { sellerId: string; payload: unknown; now: Date }) => Snapshot`:

- **normalizeModerationStatus**: `GET /moderations/last_moderation/{itemId}` → extracts `id`, `blocked`, `date`, iterates `wordings[]` and `evidence[]`. Uses `pushOptional` for optional fields. Completeness: "complete" if `id` present.
- **normalizeNotices**: `GET /communications/notices?limit=&offset=` → iterates `results[]`, extracts `id`, `from_date`, `tags[]`, `highlighted`, `dismiss_key`, `title`, `actions[]`. Pagination metadata from root `paging` or count fallback.
- **normalizeAnswer**: No API payload — takes `{ questionId, text }`, builds summary with `status: "pending"`, `textLength` (not full text). Completeness: "partial", confidence: "low" (prepare-only).

## Interface Methods (MlcApiClient)

```typescript
getModerationStatus?(sellerId: string, itemId: string): Promise<MlcModerationStatusSnapshot>;
getNotices?(sellerId: string, options?: { limit?: number; offset?: number }): Promise<MlcNoticesSnapshot>;
prepareAnswer?(sellerId: string, input: MlcAnswerInput): Promise<MlcAnswerSnapshot>;
```

All optional (`?`) — consistent with newer methods. Inserted after `uploadImage?` in the interface (after line 700).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modify | 3 client methods + 3 normalizers + 6 new types + 3 snapshot aliases (~200 lines) |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modify | Normalizer unit tests + transport-mocked integration tests |
| `openspec/specs/ml-api-integration/spec.md` | Modify | 3 new capability matrix entries (done via spec delta) |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Normalizers | Fixed API payload fixtures → assert snapshot shape, completeness, kind. Vetest `describe` per normalizer. |
| Unit | `prepareAnswer` input validation | Malformed/invalid questionId → blocked response. Missing text → controlled error. |
| Integration | Transport + normalizers | Mock `MercadoLibreApiTransport` with realistic ML API payloads. Assert request paths and response normalization. |
| E2E | None in Slice 1 | No MCP wiring or real credentials. Deferred to Slice 2+. |

## Migration / Rollout

No migration required. All additive types and methods. `prepareAnswer` has no execution path — `createMlcReadMethods` builds the snapshot without calling `input.request`.

## Open Questions

None — all decisions resolved above.
