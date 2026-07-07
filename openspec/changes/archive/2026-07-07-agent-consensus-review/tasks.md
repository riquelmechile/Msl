# Tasks: Agent Consensus Review

## Phase 1: Core Store

### 1.1 Create `agentConsensusStore.ts`
- [ ] Write `SCHEMA_SQL` with `CREATE TABLE IF NOT EXISTS agent_reviews`
- [ ] Define `AgentReview`, `SubmitReviewInput`, `ReviewVerdict`, `AgentConsensusStore` types
- [ ] Implement `createAgentConsensusStore(db)`: migration, prepared statements, returned methods
- [ ] Implement `submitReview(input)`: validate verdict (enum), validate confidence (0-1), validate rationale (non-empty), insert row, return review
- [ ] Implement `getConsensus(proposalId)`: SELECT all rows for proposal, ordered by `created_at ASC`
- [ ] Implement `requiresConsensus(proposalKind, riskDelta?)`: set-based classification with price-change delta threshold
- **Target**: `packages/agent/src/conversation/agentConsensusStore.ts` (~110 lines)

### 1.2 Export from `index.ts`
- [ ] Add `createAgentConsensusStore` export
- [ ] Add `AgentConsensusStore`, `AgentReview`, `SubmitReviewInput`, `ReviewVerdict` type exports
- **Target**: `packages/agent/src/index.ts` (+5 lines)

## Phase 2: Tests

### 2.1 Store unit tests
- [ ] Create `packages/agent/tests/conversation/agentConsensusStore.test.ts`
- [ ] Test: migration is idempotent (run twice, no error)
- [ ] Test: submit valid review persists
- [ ] Test: invalid verdict ("maybe") throws
- [ ] Test: confidence < 0 throws, confidence > 1 throws
- [ ] Test: empty rationale throws
- [ ] Test: getConsensus returns chronological order
- [ ] Test: getConsensus on unknown proposal returns []
- [ ] Test: requiresConsensus — all 6 high-risk kinds return true
- [ ] Test: requiresConsensus — 3 low-risk kinds return false
- [ ] Test: requiresConsensus — price-change at 10% returns false
- [ ] Test: requiresConsensus — price-change at 25% returns true
- [ ] Test: requiresConsensus — unknown kind returns false
- **Target**: `packages/agent/tests/conversation/agentConsensusStore.test.ts` (~170 lines)

### 2.2 Integration smoke
- [ ] Verify store works alongside `agentMessageBusStore` using same `:memory:` DB
- [ ] Confirm `getSharedDb()` connectivity (manual smoke in daemon test harness)
- **Target**: within existing daemon integration test or manual verification

## Phase 3: CEO Flow Wire-In

### 3.1 Wire `requiresConsensus` into CEO proposal presentation
- [ ] In `agentLoop.ts` or daemon proposal formatting, call `requiresConsensus(kind, riskDelta)`
- [ ] If `true`, call `getConsensus(proposalId)` and format consensus summary
- [ ] Append consensus summary to the CEO-facing proposal text
- [ ] If `false`, present normally (no-op)
- **Target**: `packages/agent/src/conversation/agentLoop.ts` (~15 lines added)

## Review Workload Forecast

| Component | Est. Lines | Test Lines | Total |
|-----------|-----------|------------|-------|
| `agentConsensusStore.ts` | 110 | — | 110 |
| `index.ts` exports | 5 | — | 5 |
| Store tests | — | 170 | 170 |
| CEO flow wire-in | 15 | — | 15 |
| **Total** | **130** | **170** | **300** |

- **Decision needed before apply**: No
- **Chained PRs recommended**: No — 300 total lines (~130 implementation, ~170 tests) fits comfortably in a single PR
- **400-line budget risk**: Low
- **Estimated PR diff**: ~305 lines (additions only)
