# Tasks: CEO Delegation Memory Cache

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Slice 1: 450-700; full change: 1,200-1,800 |
| 800-line budget risk | Slice 1 Low; full change High |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 lane contracts/cache/no-mutation; PR 2 read-model boundary; PR 3 Cortex feedback/ingestion |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
800-line budget risk: High

### Suggested Work Units / Commit Boundaries

| Unit | Goal | Slice | Commit boundary |
|------|------|-------|-----------------|
| 1 | Lane contracts, stable prefixes, telemetry extraction | Slice 1 | `feat(agent): add CEO lane contracts and cache telemetry` |
| 2 | Delegation proposal tool and no-mutation `dale` guard | Slice 1 | `feat(agent): block phase one mutations during delegation` |
| 3 | Operational evidence/read-model contracts only | Slice 2 | `feat(memory): define operational evidence boundary` |
| 4 | Cortex feedback reinforcement helpers | Slice 3 | `feat(memory): add delegation outcome learning hooks` |

## Phase 1: Slice 1 Foundation / Contracts

- [x] 1.1 Create `packages/agent/src/conversation/lanes.ts` with `LaneContract`, `LaneOutput`, `CacheTelemetry`, and CEO/Cost/Market/Creative lane definitions; no production mutations.
- [x] 1.2 Update `packages/agent/src/conversation/cacheBlocks.ts` to assemble token-0 stable lane prefixes plus refreshable context; test volatile evidence never enters prefixes; no production mutations.
- [x] 1.3 Add telemetry extraction helpers in `packages/agent/src/conversation/agentLoop.ts` for `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`; test missing counters degrade safely; no production mutations.

## Phase 2: Slice 1 Routing / Safety

- [x] 2.1 Add `delegate_to_subagent` proposal-only tool in `packages/agent/src/conversation/tools.ts`; test lane boundary warnings and evidence IDs are returned, never executed.
- [x] 2.2 Wire CEO lane routing in `packages/agent/src/conversation/agentLoop.ts`; test combined Spanish proposal includes recommendation, risks, evidence IDs, and no-mutation statement.
- [x] 2.3 Update `packages/bot/src/index.ts` approval wording so `dale` means bounded investigation/preparation only; test productive effects are blocked in Spanish.

## Phase 3: Later Slice Boundaries

- [x] 3.1 Extend `packages/domain/src/cacheFreshness.ts` with `OperationalEvidence` freshness/completeness metadata; test stale evidence avoids high-confidence claims.
- [x] 3.2 Add minimal read-model interfaces near the chosen persistence package; defer full catalog ingestion and remote sync implementation.
- [x] 3.3 Add `packages/memory/src/cortex/*` feedback contracts for approvals, rejections, corrections, and pruning; test Cortex never stores full catalog snapshots.

## Phase 4: Verification / Cleanup

- [x] 4.1 Add/extend `packages/agent/tests/conversation/*` for missing cost clarification, immutable prefix hygiene, telemetry association, and Phase 1 no-mutation.
- [x] 4.2 Run `npm test`, `npm run typecheck`, and targeted lint/format checks; document deferred operational ingestion in this tasks file if implementation scope changes.
  - 2026-07-01 remediation evidence: focused Slice 1 tests passed (`120` tests), targeted ESLint on changed Slice 1 files passed, and `delegate_to_subagent` now has OpenAI-compatible function-tool schema coverage.
  - 2026-07-01 global typecheck remediation: repository-wide `npm run typecheck` passes after fixing type blockers in `packages/mercadolibre`, `packages/workers`, `packages/agent/src/conversation/escribano.ts`, `packages/agent/src/conversation/syncTools.ts`, and `packages/mcp`; focused affected tests passed (`296` tests).
  - 2026-07-01 fresh final verification: `npm run typecheck`, focused Slice 1 tests (`120`), affected remediation tests (`296`), and targeted ESLint for `syncTools.ts`, `packages/mercadolibre/src/index.ts`, and `mercadolibre.test.ts` passed; repository `npm run lint` exists but fails with 114 broader ESLint errors, so the broad lint gate is not clean.
  - 2026-07-02 lint remediation: reproduced `npm run lint` failure (`114` errors), fixed all remaining repository-wide ESLint failures, then verified `npm run lint`, `npm run typecheck`, and affected focused tests (`109` tests) all pass.
  - 2026-07-02 fresh independent final verification after global lint remediation: `npm run lint`, `npm run typecheck`, focused Slice 1 tests (`120`), and affected remediation tests (`296`) all pass.
  - 2026-07-02 later-slice boundary implementation: focused domain/memory tests passed (`112` tests), `npm run typecheck` passed, and `npm run lint` passed.
