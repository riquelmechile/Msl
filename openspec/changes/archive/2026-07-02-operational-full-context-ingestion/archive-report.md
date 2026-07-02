# Archive Report: operational-full-context-ingestion

**Date**: 2026-07-02
**Mode**: openspec
**Verdict**: PASS WITH WARNINGS

## Task Completion Gate

All 17/17 tasks checked `[x]`. No unchecked implementation tasks. ✅

## Verification Summary

- **CRITICAL**: 0
- **WARNING**: 2
  - W-01: `getQuestions` is optional (`getQuestions?`) rather than required on `MlcApiClient`. Follows `searchClaims` precedent; design did not call for optionality.
  - W-02: `normalizeQuestions` read-snapshot uses `kind: "message"` rather than `kind: "question"` for freshness path. Operational store correctly uses `kind: "question"`. Semantic layering quirk — `signalLabels["question"]` label exists but read-path signal kind diverges.
- **SUGGESTION**: 2 (optional `paging?` metadata on getOrders/getMessages; per-item Cortex nodes may bloat with high-volume sellers)
- **Tests**: 1026/1027 pass (1 pre-existing unrelated failure in `actorIntegration.test.ts`)
- **Compliance**: 11/11 spec scenarios compliant

Verdict: **PASS WITH WARNINGS** — no CRITICAL blockers. Both warnings are design deviations with clear precedent and no functional impact.

## Spec Sync (Delta → Main)

| Domain | Action | Details |
|--------|--------|---------|
| business-memory-cache | Updated | 2 MODIFIED + 2 ADDED requirements |
| ml-questions-answer | Updated | 1 ADDED requirement |

### Merged Requirements

- `business-memory-cache`: Operational Business Read Model (MODIFIED — expanded from catalog/listings to all 5 entity kinds), SQLite Operational Snapshot Persistence (MODIFIED — expanded to any entity kind with reputation period semantics), Multi-Kind Operational Ingestion (ADDED), Per-Kind Ingestion Tuning (ADDED)
- `ml-questions-answer`: getQuestions Safe-Read (ADDED — read-only `/questions/search` with normalization, no mutation)

No destructive or removing deltas applied — only ADDED and MODIFIED requirements; zero REMOVED or RENAMED sections.

## Archive Contents

- proposal.md ✅
- specs/ (2 delta specs: business-memory-cache, ml-questions-answer) ✅
- design.md ✅
- tasks.md ✅ (17/17 tasks complete, 0 unchecked)
- apply-progress.md ✅
- verify-report.md ✅

## Warnings Preserved for Future Awareness

- W-01: `getQuestions?` optionality — low severity; follows existing `searchClaims` optional pattern across 40+ mock objects. Consider making required in a future type cleanup of `MlcApiClient`.
- W-02: Read-snapshot signal kind mismatch (`"message"` vs `"question"`) — no functional impact today. The `signalLabels["question"] = "preguntas"` entry exists but is unused by the read-snapshot freshness path. Future: align the read-path signal kind or wire the label.

## Deviations from Design (Design-Conscious)

| # | Deviation | Severity | Accepted? |
|---|-----------|----------|-----------|
| 1 | `getQuestions` optional vs required | WARNING | Yes — precedent from `searchClaims` optional pattern |
| 2 | `getOrders`/`getMessages` optional `paging?` metadata | SUGGESTION | Yes — backward-compatible; cleaner than new snapshot types |
| 3 | Cortex nodes per-entity (claims/questions/messages) vs aggregated | SUGGESTION | Yes — mirrors `listing_snapshot` pattern; orders retain aggregated node |
| 4 | Read-snapshot signal kind `"message"` vs `"question"` | WARNING | Yes — ML API layering; operational store uses correct `kind: "question"` |

All four deviations are accepted as design-conscious tradeoffs with clear rationale and no functional regression.

## SDD Cycle Complete

The `operational-full-context-ingestion` change has been fully planned, implemented, verified, and archived.

5 entity types (claims, questions, orders, messages, reputation) ingested with per-kind freshness TTLs, configurable pagination, dual-write to operational store + Cortex, and checkpoint resume per `(seller_id, kind)`.
