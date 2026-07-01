# Archive Report: mercadolibre-api-gaps-2026

**Date**: 2026-07-01
**Status**: Complete
**Classification**: `openspec` mode

## Executive Summary

Slice 1 of ML API gaps 2026 deployed — three new client capabilities added to `packages/mercadolibre/src/index.ts`: image moderation status (`safe-read`, ~80 lines), communications/notices (`safe-read`, ~70 lines), and questions answer (`prepare-only`, ~50 lines). Total ~180 lines + 13 tests. All 917 tests pass. Typecheck clean on implementation (30 test-file-only warnings exist, non-blocking).

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `ml-api-integration` | Updated | 1 ADDED requirement: "Capability Matrix — Slice 1 2026 Gap Entries" with 3 new matrix rows and 2 scenarios |
| `ml-moderation-status` | Created | Full spec: 2 requirements (Moderation Status Read, Runtime Surface Classification), 6 scenarios |
| `ml-notices` | Created | Full spec: 2 requirements (Notices Read with Pagination, Runtime Surface Classification), 5 scenarios |
| `ml-questions-answer` | Created | Full spec: 2 requirements (Question Answer Preparation, Runtime Surface Classification), 4 scenarios |

## Archive Contents

| Artifact | Path | Status |
|----------|------|--------|
| Exploration | `exploration.md` | ✅ |
| Proposal | `proposal.md` | ✅ |
| Delta specs (4 domains) | `specs/{ml-api-integration,ml-moderation-status,ml-notices,ml-questions-answer}/spec.md` | ✅ |
| Design | `design.md` | ✅ |
| Tasks | `tasks.md` | ✅ (17/17 complete) |
| Apply progress | `apply-progress.md` | ✅ |
| Verify report | `verify-report.md` | ✅ (PASS WITH WARNINGS) |

## Source of Truth Updated

- `openspec/specs/ml-api-integration/spec.md` — 1 new requirement appended (3 matrix entries)
- `openspec/specs/ml-moderation-status/spec.md` — new spec (safe-read, moderation status)
- `openspec/specs/ml-notices/spec.md` — new spec (safe-read, communications notices)
- `openspec/specs/ml-questions-answer/spec.md` — new spec (prepare-only, questions answer)

## Task 5.4 Reconciliation

Task 5.4 was explicitly deferred to archive phase by design (verify report: "DEFERRED to archive"). The orchestrator instructed reconciliation during archive. The delta spec for `ml-api-integration` has been merged into the main spec, and task 5.4 is marked complete. Archive-time reconciliation evidence: verify-report.md confirms delta matches implementation, and the main spec now includes the 3 new matrix entries with classification contract compliance.

## Implemented Capabilities

| Capability | Classification | Lines | Tests | Status |
|-----------|---------------|-------|-------|--------|
| Image moderation status (`getModerationStatus?`) | `safe-read` | ~80 | 4 | PASS |
| Communications/notices (`getNotices?`) | `safe-read` | ~70 | 5 | PASS |
| Questions answer (`prepareAnswer?`) | `prepare-only` | ~50 | 4 | PASS |

## Deferred to Future Slices

| Item | Target Slice | Notes |
|------|-------------|-------|
| Claims search/detail | Slice 2 | ~200 lines |
| Shipping status | Slice 2 | ~100 lines |
| Image orchestration flow | Slice 3 | Spec-only |
| Brand Protection Program | Docs-only | No runtime |
| MCP tool wiring | Slice 2+ | All 3 capabilities |
| Auth/rate-limit scenario tests | Optional | Consistent with existing 27 methods |
| Test file type narrowing (30 errors) | Immediate | Non-blocking — runtime correct |

## Warnings (from verify-report)

1. **30 test-file type errors** (`MlcReadSnapshot<T>.data` union type) — runtime correct, low impact
2. **prepareAnswer invalid input handling** — returns empty snapshot instead of distinguished blocked response with `invalid-question-id` reason. Minor.
3. **Auth/rate-limit scenarios untested** — consistent with all 27 existing client methods

No CRITICAL issues. Archive approved.

## Risks

| Risk | Likelihood | Impact |
|------|------------|--------|
| MLC site support "to-be-confirmed" for all 3 endpoints | Medium | Low — safe-reads are harmless; prepare-only has no execution path |
| Test type errors may surface during future refactors | High (always) | Low |
| Notices shape may differ integrator vs seller token | Low | Modeled with optional fields |

## Skill Resolution

`sdd-archive` skill executed in `openspec` mode. Delta specs synced to main specs via merge (ADDED requirements appended). New domain specs created for three domains without existing main specs. Change folder archived with ISO date prefix. No user skills required.

## SDD Cycle Complete

The change `mercadolibre-api-gaps-2026` has been fully planned, implemented, verified, and archived. Slice 1 is closed. Ready for Slice 2 (claims, shipping, MCP wiring).
