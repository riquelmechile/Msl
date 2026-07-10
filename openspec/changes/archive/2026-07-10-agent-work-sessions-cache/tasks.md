# Tasks: Agent Work Sessions & Cache

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,250 |
| 400-line budget risk | High |
| 800-line budget risk | Medium (splits cleanly) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Foundation + Core Logic + their tests) → PR 2 (Orchestration + Integration + remaining tests + docs) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Domain types + SQLite store + wake policy + prompt builder + barrel + store/wake/prompt tests | PR 1 | Base: main. ~593 lines. No runtime effect; types + pure logic + persistence only. |
| 2 | Runner + cortex bridge + shift summary + daemon hooks + cost ledger + CEO tool + runner/integration/docs tests + architecture docs | PR 2 | Base: main (types imported from PR 1). ~655 lines. Wires everything; runtime becomes active. |

## Phase 1: Foundation — Domain + Store + Wake + Prompt (PR 1)

- [x] T001 Create `packages/domain/src/agentWorkSession.ts`: all 9 types (SessionStatus, AgentWorkSession, AgentObservation, AgentLesson, AgentWakeDecision, SignalDelta, StablePromptBlock, VariableEvidenceBlock, AgentWorkPrompt). Export from `packages/domain/src/index.ts`. ~60 lines.
- [x] T002 Create `packages/agent/src/sessions/AgentWorkSessionStore.ts`: 5 tables with indexes, full Store API (startSession, getSession, complete/fail/skipSession, listRecentSessionsByAgent, getLastSessionForSignals, addObservation, addProposalLink, addLesson, listRecentLessons, summarizeShift). Follow createTableIfNotExists + columnExists + defensive-parse patterns. ~200 lines.
- [x] T003 Create `packages/agent/src/sessions/agentWakePolicy.ts`: pure hashAgentSignals (SHA-256), shouldAgentWakeUp (5 rules: manual→wake, hash match+<1h→skip, high/critical risk→override, pending proposal→skip, default→wake), computeSignalDelta. ~50 lines.
- [x] T004 Create `packages/agent/src/prompts/cacheFriendlyPromptBuilder.ts`: 9-layer prompt assembly (policy→role→rules→safety→account→memory → [cache break] → evidence→questions→schema). SHA-256 stablePromptHash + evidenceHash. Includes transferable-lessons injection (max 3). ~80 lines.

## Phase 2: Orchestration — Runner + Cortex + Summaries (PR 2)

- [x] T005 Create `packages/agent/src/sessions/AgentWorkSessionRunner.ts`: full lifecycle orchestrator with DI (workSessionStore, accountAssetStore, cortex, ceoInboxStore, messageBus, deepSeekTransport, clock, logger). Flow: signals→shouldWake→startSession→buildPrompt→DeepSeek→parse→record→CEO inbox→Cortex→complete/fail. FakeTransport in tests. ~120 lines.
- [x] T006 Create `packages/agent/src/sessions/agentWorkCortexBridge.ts`: recordWorkSessionToCortex, recordObservationToCortex, recordLessonToCortex, connectSessionToProposal, connectSessionToOutcome. Graph model AccountAsset→Agent→WorkSession→..., seller-scoped. Reuses getOrCreateNode + reinforceEdge. ~50 lines.
- [x] T007 Create `packages/agent/src/sessions/agentShiftSummary.ts`: createMorningBrief, createEndOfDaySummary, summarizeAccountShift. DB-query-first; DeepSeek optional for compression. Match morningReportDaemon/eodSummaryDaemon output. ~60 lines.

## Phase 3: Integration — Daemon + Ledger + Tool (PR 2)

- [x] T008 Extend `packages/agent/src/workers/daemonScheduler.ts` + `daemonTypes.ts`: add optional `enableWorkSessions` + `workSessionRunner` config. Extend DaemonHandler with optional session params (backward compatible). signalsHash deduplication. Apply to 6 lanes: unanswered-questions, product-ads-profitability, creative-assets, operations-manager, morning-report, eod-summary. ~35 lines.
- [x] T009 Migrate `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts`: add seller_id, session_id, stable_prompt_hash, evidence_hash via idempotent columnExists(). Extend insertEntry() with optional fields (backward compatible). New methods: recordAgentSessionUsage, aggregateCostByAgentAndSeller, aggregateCacheEfficiencyBySeller. ~45 lines.
- [x] T010 Register get_agent_work_status in `packages/agent/src/conversation/tools.ts`: input sellerId/agentId/since/includeLessons; output agent status, observations, proposals, costs, cache efficiency. noMutationExecuted: true. Backend-only JSON. ~25 lines.

## Phase 4: Testing (PR 1 + PR 2)

- [x] T011 [PR 1] Vitest: AgentWorkSessionStore — CRUD roundtrip, seller scoping, cross-seller isolation, reopen-after-close, idempotent schema, defensive parsing. In-memory SQLite. ~100 lines.
- [x] T012 [PR 1] Vitest: agentWakePolicy — 5 scenarios: same signal→no wake, new question→wake, high risk→override, duplicate pending→skip, seller isolation. describe.each over signal/hash combos. ~50 lines.
- [x] T013 [PR 1] Vitest: cacheFriendlyPromptBuilder — stable hash consistency, evidence hash changes, seller differentiation, safety policy presence, lessons injection limit. ~50 lines.
- [x] T014 [PR 2] Vitest: AgentWorkSessionRunner — FakeTransport (0 HTTP): skipped (no wake), completed (observations), DeepSeek error→failed, CEO proposal→scoped, invalid output→errorJson. ~80 lines.
- [x] T015 [PR 2] Vitest: cortex bridge + shift summary + cost ledger + daemon scheduler + CEO tool — in-memory DB, node/edge counts, seller isolation, cache efficiency ratios, morning/EOD format. ~100 lines.

## Phase 5: Documentation (PR 2)

- [x] T016 Create `docs/architecture/agent-work-sessions-cache.md`: session lifecycle, wake/sleep, cache usage, prompt structure, experience recording, Cortex connection, cost calculation, approval safety, account isolation. ~100 lines.
- [x] T017 Update `docs/audits/account-assets-memory-addendum-2026-07.md`: add "Gaps this PR resolves" and "Pending" sections (CEO dashboard, compare_account_assets, multi-bot, provider smoke). ~30 lines.
