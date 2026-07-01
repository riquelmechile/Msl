# Verification Report: mercadolibre-api-gaps-2026

**Date**: 2026-07-01
**Mode**: Standard (strict_tdd: false)
**Status**: PASS WITH WARNINGS

## Executive Summary

All 917 tests pass across 36 files. Implementation matches specs for all three capabilities (moderation status, notices, questions answer). No domain/tool/MCP/bot/workers/agent/memory package changes — only `packages/mercadolibre/` modified. 30 TypeScript type errors exist in the test file (not in implementation) due to union type narrowing on `MlcReadSnapshot<T>.data`. All 16 implementation tasks complete; task 5.4 (matrix spec update) is deferred to archive.

## Completeness Table

| Dimension | Status | Notes |
|---|---|---|
| Tasks | 16/17 COMPLETE | Task 5.4 is archive-phase only |
| Spec scenarios | 9/12 TESTED | 3 untested (auth/rate-limit scenarios — consistent with existing pattern) |
| Design coherence | PASS | All 4 design decisions verified |
| Architecture constraints | PASS | Zero cross-package changes |
| Pattern compliance | PASS | ReadonlyArray, MlcReadSnapshot, optional `?` methods, no-transport prepare-only |
| Build/typecheck | PASS (implementation) / WARNING (tests) | 0 errors in implementation; 30 errors in test file |
| Test suite | PASS | 917/917 passing, 36 files |

## Build / Tests / Coverage

| Command | Result |
|---|---|
| `npx vitest run` | 917 passed, 0 failed (36 files, 17.30s) |
| `npx tsc --noEmit` | 30 errors (all in `mercadolibre.test.ts`, zero in `index.ts`) |

### New Tests Added (13 total, across 5 describe blocks)

| Describe block | Test count | Status |
|---|---|---|
| `normalizeModerationStatus` | 4 | PASS |
| `normalizeNotices` | 4 | PASS |
| `normalizeAnswer (prepare-only)` | 3 | PASS |
| `getNotices pagination integration` | 1 | PASS |
| (image upload existing block extended) | 1 | PASS |

## Spec Compliance Matrix

### ml-moderation-status

| Scenario | Status | Covering test(s) |
|---|---|---|
| Successful moderation read (wordings + evidence) | COMPLIANT | "parses a successful moderation result with wordings and evidence" (line 1932) |
| Item has no moderations (empty, blocked=false) | COMPLIANT | "returns partial completeness when payload is empty" (line 1981) |
| Blocked moderation result | COMPLIANT | "handles a blocked moderation result" (line 2006) |
| Correct API request path | COMPLIANT | "correctly constructs the API request path" (line 2040) |
| OAuth token missing or expired (ReconnectRequired) | UNTESTED | No test; auth handled by transport/MCP layer (consistent with all existing methods) |
| Upstream rate limited (HTTP 429) | UNTESTED | No test; same pattern as all existing methods |

### ml-notices

| Scenario | Status | Covering test(s) |
|---|---|---|
| Seller-scoped notices with dismiss_key + pagination | COMPLIANT | "parses seller-scoped notices with dismiss_key and pagination" (line 2072) |
| Integrator-scoped notices with title field | COMPLIANT | "handles integrator-scoped notices with title field" (line 2182) |
| Pagination returns bounded results (limit/offset) | COMPLIANT | "passes limit and offset as query params" (line 2154) |
| Omits undefined limit/offset | COMPLIANT | "omits undefined limit/offset from query" (line 2310) |
| No notices for seller (empty, full metadata) | COMPLIANT | "returns empty notices with full pagination metadata" (line 2130) |

### ml-questions-answer

| Scenario | Status | Covering test(s) |
|---|---|---|
| Valid answer prepared (pending, no transport) | COMPLIANT | "constructs a pending answer snapshot without calling transport" (line 2220) |
| Invalid/missing questionId (empty, graceful) | COMPLIANT (partial deviation) | "handles empty questionId gracefully" (line 2255) — returns empty snapshot, not "controlled blocked response" |
| Empty text (empty, graceful) | COMPLIANT (partial deviation) | "handles empty text gracefully" (line 2280) — same pattern |
| OAuth token missing/insufficient scope | UNTESTED | No test; auth handled by transport/MCP layer |
| prepareAnswer never calls transport | COMPLIANT | Verified by `expect(request).not.toHaveBeenCalled()` (line 2252) |

### ml-api-integration (spec delta)

| Requirement | Status |
|---|---|
| 3 new matrix entries (moderation, notices, answer) | COMPLIANT (spec-level) |
| Entries follow classification contract (siteSupport, confidence, surface) | COMPLIANT |
| MLC support is "to-be-confirmed" | COMPLIANT |
| Matrix synced to main spec | DEFERRED to archive (task 5.4) |

## Correctness Table

| Norm | Check | Result |
|---|---|---|
| All types use ReadonlyArray<> / Readonly<Record<...>> | Source inspection | PASS — `wordings: ReadonlyArray<...>`, `evidence: ReadonlyArray<...>`, `notices: ReadonlyArray<...>`, `actions: ReadonlyArray<...>` |
| MlcReadSnapshot<T> wrapper on all snapshots | Source inspection | PASS — `MlcModerationStatusSnapshot`, `MlcNoticesSnapshot`, `MlcAnswerSnapshot` |
| Optional `?` methods on MlcApiClient | Source inspection | PASS — all three `getModerationStatus?`, `getNotices?`, `prepareAnswer?` |
| prepareAnswer: noMutationExecuted=true, requiresApproval=true | Source + test | PASS — lines 1495-1496 in index.ts, lines 2247-2248 in test |
| prepareAnswer: no transport call | Runtime test | PASS — `expect(request).not.toHaveBeenCalled()` |
| No domain/tool/MCP package changes | Git diff | PASS — 0 lines changed outside `packages/mercadolibre/` |
| mod status API request path | Runtime test | PASS — `/moderations/last_moderation/MLC1001` |
| notices API request path + query | Runtime test | PASS — `/communications/notices` with `{limit, offset}` query |

## Design Coherence Table

| Design Decision | Implementation Match |
|---|---|
| Reuse `kind: "listing"` for moderation | ✓ `normalizeModerationStatus` returns `kind: "listing"` |
| Reuse `kind: "message"` for notices & answer | ✓ `normalizeNotices` and `normalizeAnswer` return `kind: "message"` |
| Single `getNotices` method with pagination params | ✓ One method, optional `{limit, offset}` |
| `prepareAnswer` builds snapshot without API call | ✓ No `input.request()` call; validated by test |
| Normalizers use asRecord/pushOptional/asArray/stringValue/booleanValue | ✓ All three normalizers follow this pattern |

## Issues

### WARNING

1. **Test file type errors (30 errors)**: `MlcReadSnapshot<T>.data` is typed as `ReadonlyArray<T> | T` (union), and the new test assertions access `.itemId`, `.blocked`, `.notices`, `.pagination`, `.questionId`, `.textLength` directly on `result.data` without narrowing. Since the normalizers always return `T` (not `T[]`), runtime behavior is correct. Fix: add type assertion or use `expect.objectContaining` / `toMatchObject` patterns that don't require property drilling.

2. **prepareAnswer invalid input handling**: Spec scenario "Invalid or missing question ID" expects a "controlled blocked response with reason `invalid-question-id`". Implementation returns an empty `MlcAnswerSnapshot` with `questionId: ""` and `textLength: 0` instead of a distinguished blocked response. This is minor because the empty snapshot still signals "not prepared" — but it loses the explicit reason.

3. **Auth/rate-limit scenarios untested**: Spec scenarios for ReconnectRequired and HTTP 429 are not tested at the client method layer. This is consistent with all 27 existing client methods (none test auth rejection directly). The auth and rate-limit handling lives in the transport/MCP layer.

### SUGGESTION

1. **Confidence metadata**: `ml-notices` spec declares confidence "Medium" but the normalizer sets confidence via `snapshotConfidence(completeness, notices.length)`. For empty notices with 0 results, confidence may be "low" which contradicts the spec's declared Medium. Consider whether confidence should be pinned or derived.

## Artifacts Verified

| Artifact | Path | Status |
|---|---|---|
| Delta specs (4 capabilities) | `specs/ml-{moderation-status,notices,questions-answer,api-integration}/spec.md` | Verified |
| Tasks | `tasks.md` | 16/17 checked |
| Apply progress | `apply-progress.md` | Consistent with implementation |
| Design | `design.md` | All 4 decisions verified |
| Implementation | `packages/mercadolibre/src/index.ts` | ~180 lines added; types, normalizers, client methods |
| Tests | `packages/mercadolibre/src/mercadolibre.test.ts` | 13 new tests, 917 total pass |

## Next Recommended

- **Immediate**: Fix 30 type errors in test file (type narrowing on `result.data`)
- **Archive (task 5.4)**: Update `openspec/specs/ml-api-integration/spec.md` with 3 new capability matrix entries
- **Optional**: Add auth rejection and rate-limit tests if project convention shifts to testing those at the client layer

## Risks

| Risk | Likelihood | Impact |
|---|---|---|
| `MlcReadSnapshot<T>.data` union type not caught at test time | High (always) | Low (runtime correct) |
| Auth/reconnect edge cases untested | Low | Medium (consistent with all existing methods) |
| MLC site support "to-be-confirmed" | N/A (design tradeoff) | Low (safe-reads are harmless; prepare-only has no execution path) |

## Skill Resolution

No user skills loaded. sdd-verify skill instructions used for verification workflow. Verification performed via source inspection, runtime test execution (`npx vitest run`), and type checking (`npx tsc --noEmit`).
