# Tasks: Supplier Mirror Agent Enterprise

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,800-2,400 |
| Configured review budget | 800 changed lines |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 store/types → PR 2 sources → PR 3a worker foundation → PR 3b monitor/pause → PR 4 CEO tools/pricing → PR 5 Cortex/cost/docs |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Domain and operational store | PR 1 | Tests with in-memory SQLite; no runtime polling. |
| 2 | ML/API-first source adapters | PR 2 | Depends on PR 1; scraper fallback is evidence-only. |
| 3a | Worker foundation | PR 3a | Depends on PR 1-2; disabled-by-default scheduler, registry, rate limiter, and ingestion persistence only. |
| 3b | Monitor, verification, pause | PR 3b | Depends on PR 3a; pause only after verified policy and explicit `targetSellerIds` membership. |
| 4 | CEO tools, lane wiring, pricing policy | PR 4 | Depends on PR 1-3; proposal-first UX. |
| 5 | Cortex learning, DeepSeek evidence, docs | PR 5 | Depends on PR 4; cost/cache proof and rollout docs. |

## Non-Goals and Safety Gates

- [x] G.1 Do not reuse `assertPlasticovToMaustianDirection` for Supplier Mirror targeting; use explicit `target_policies`.
- [x] G.2 Block blind mass publishing/price mutation; allow pause only after short verification, approved policy, ledger, and CEO notice. Implemented in PR 4/PR 3b monitor-pause slice.

## Phase 1: Domain and Store

- [x] 1.1 Create `packages/domain/src/supplierMirror.ts`; update `packages/domain/src/preparedAction.ts` and `index.ts` with mirror action/types.
- [x] 1.2 Create `packages/memory/src/supplierMirrorStore.ts` and export it from `packages/memory/src/index.ts`.
- [x] 1.3 Test store migrations, snapshots, observations, policies, mappings, ledger skips, and confidence metadata in `packages/memory/src/memory.test.ts`.

## Phase 2: Source Adapters

- [x] 2.1 Create `packages/mercadolibre/src/supplierSource.ts` with ML API-first supplier reads and stock-authoritative evidence.
- [x] 2.2 Create `packages/mercadolibre/src/scraperFallback.ts` with isolated low-concurrency fallback evidence and no mutation exports.
- [x] 2.3 Test API stock authority, API-gap fallback confidence, and XKP non-stock enrichment in `packages/mercadolibre/src/mercadolibre.test.ts`.

## Phase 3a: Worker Foundation

- [x] 3.1 Create `packages/workers/src/supplierMirror/` registry, rate limiter, ingestion persistence, and disabled-by-default scheduler foundation.
- [x] 3.2 Wire disabled-by-default runtime in `packages/workers/src/index.ts` with ~10-minute jitter and per-supplier ingestion limits.
- [x] 3.3 Test registry, disabled scheduler, per-supplier rate limiting, and ingestion persistence in `packages/workers/src/workers.test.ts`.

## Phase 3b: Stock-Break Verification and Safe Pause

- [x] 3.4 Create monitor candidate selection, stock-break verifier, and pause/defer planner.
- [x] 3.5 Enforce that each approved mapping target is present in `policy.targetSellerIds` before any pause execution.
- [x] 3.6 Test confirmed break pause, target-policy mismatch deferral, inconclusive skip/alert, idempotency keys, ledger records, and CEO notification events.

## Phase 4: CEO Tools and Pricing

- [x] 4.1 Create `packages/agent/src/conversation/supplierMirrorTools.ts` for evidence reads, policy proposals, decisions, and mirror requests.
- [x] 4.2 Update `packages/agent/src/conversation/lanes.ts` and `agentLoop.ts` to keep supplier workers hidden and CEO-only.
- [x] 4.3 Add pricing policy parsing/resolution for `x2`, `x3`, `x4`, fixed CLP uplift, learned, and missing-policy CEO prompts; test proposal flow.

## Phase 5: Cortex, Cost, Docs

- [x] 5.1 Record Cortex lessons for pricing, target policy, stock handling, suppressions, failures, and rejected outcomes.
- [x] 5.2 Add DeepSeek V4 Flash/Pro selection plus cache hit/miss, token, cost, and reason evidence to existing cost ledger tests.
- [x] 5.3 Document rollout, safety gates, supplier onboarding, and stacked PR verification in `docs/supplier-mirror.md`.
