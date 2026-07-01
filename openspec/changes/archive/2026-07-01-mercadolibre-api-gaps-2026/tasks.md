# Tasks: MercadoLibre API Gaps 2026 — Slice 1

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~180 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

## Phase 1: Types & Constants (Foundation)

- [x] 1.1 Add `MlcModerationStatusSummary` type after line 192 (`MlcImageUploadSnapshot`): `{ itemId: string; blocked: boolean; date?: string; wordings: ReadonlyArray<{ kind: string; value: string }>; evidence: ReadonlyArray<{ textMatched?: string; sectionName?: string }> }`
- [x] 1.2 Add `MlcNoticesSummary` type after `MlcModerationStatusSummary`: `{ notices: ReadonlyArray<{ id: string; fromDate?: string; tags?: ReadonlyArray<string>; highlighted?: boolean; dismissKey?: string; title?: string; actions: ReadonlyArray<{ label?: string; url?: string }> }>; pagination: { total?: number; limit: number; offset: number }; category?: string }`
- [x] 1.3 Add `MlcAnswerInput` and `MlcAnswerSummary` types after `MlcNoticesSummary`: `{ questionId: string; text: string }` and `{ questionId: string; status: "pending"; requiresApproval: true; noMutationExecuted: true; textLength: number }`
- [x] 1.4 Add 3 snapshot aliases after line 549: `MlcModerationStatusSnapshot = MlcReadSnapshot<MlcModerationStatusSummary>`, `MlcNoticesSnapshot = MlcReadSnapshot<MlcNoticesSummary>`, `MlcAnswerSnapshot = MlcReadSnapshot<MlcAnswerSummary>`

## Phase 2: Interface Methods

- [x] 2.1 Add `getModerationStatus?(sellerId: string, itemId: string): Promise<MlcModerationStatusSnapshot>` to `MlcApiClient` interface after `uploadImage?` (line ~700)
- [x] 2.2 Add `getNotices?(sellerId: string, options?: { limit?: number; offset?: number }): Promise<MlcNoticesSnapshot>` to `MlcApiClient` interface
- [x] 2.3 Add `prepareAnswer?(sellerId: string, input: MlcAnswerInput): Promise<MlcAnswerSnapshot>` to `MlcApiClient` interface

## Phase 3: Normalizers

- [x] 3.1 Implement `normalizeModerationStatus(input: { sellerId, payload, now })` near line ~1300 (after `normalizeImageUpload`): parse `GET /moderations/last_moderation/{id}` payload → `MlcModerationStatusSnapshot` with `kind: "listing"`, use `asRecord`/`stringValue`/`booleanValue`/`pushOptional`/`asArray`
- [x] 3.2 Implement `normalizeNotices(input: { sellerId, payload, now })` near line ~1370: parse `GET /communications/notices` payload → `MlcNoticesSnapshot` with `kind: "message"`, iterate `results[]`, extract tags/actions/dismiss_key/title, extract `paging`
- [x] 3.3 Implement `normalizeAnswer(input: { sellerId, questionId, text, now })` near line ~1440: no API call — construct `MlcAnswerSnapshot` with `status: "pending"`, `requiresApproval: true`, `noMutationExecuted: true`, `textLength`, `kind: "message"`, completeness `"partial"`, confidence `"low"`

## Phase 4: Client Methods (createMlcReadMethods)

- [x] 4.1 Add `getModerationStatus` inside `createMlcReadMethods` after `uploadImage` (near line 2748): assert item ID, `GET /moderations/last_moderation/{safeItemId}`, delegate to `normalizeModerationStatus`
- [x] 4.2 Add `getNotices` after `getModerationStatus`: build query with optional `limit`/`offset`, `GET /communications/notices`, delegate to `normalizeNotices`
- [x] 4.3 Add `prepareAnswer` after `getNotices`: validate `questionId` non-empty, validate `text` non-empty → return `normalizeAnswer` without calling `input.request` (prepare-only, no transport)

## Phase 5: Verification

- [x] 5.1 Unit test each normalizer: `npm test` with fixed ML API payload fixtures for moderation + notices, and input validation fixtures for prepareAnswer
- [x] 5.2 Integration test: mock `MercadoLibreApiTransport`, verify `getModerationStatus` request path, verify `getNotices` pagination query params, verify `prepareAnswer` never calls transport
- [x] 5.3 Typecheck: `npm run typecheck` passes
- [x] 5.4 Update `ml-api-integration` main spec with 3 new matrix entries (archive will do this; verify delta matches)
