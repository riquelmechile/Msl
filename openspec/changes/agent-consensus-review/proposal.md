# Proposal: Agent Consensus Review

## Intent

Agents can propose actions (price changes, publishing, syncs, claim responses), but there is no multi-agent review mechanism. Dangerous proposals could reach the CEO unilaterally if approved. We need a consensus review layer where at least one peer agent reviews high-risk proposals before they reach the CEO confirmation step.

## Scope

### In Scope
- `agent_reviews` SQLite table with verdicts (`approve | reject | needs_more_evidence | risk_warning`)
- `createAgentConsensusStore(db)` factory following existing patterns (migration, prepared statements)
- `submitReview(proposalId, reviewerAgentId, verdict, rationale, confidence)` API
- `getConsensus(proposalId)` returning all reviews for a proposal
- `requiresConsensus(proposalKind, riskDelta)` classifying proposals as high/low risk
- CEO flow integration: show consensus summary before "dale" confirmation for high-risk proposals

### Out of Scope
- Weighted voting / quorum logic (future)
- Debate threads between agents (future)
- Consensus UI in Telegram (CEO flow integration is a wire-in, not UI redesign)
- Historical consensus analytics dashboard

## Capabilities

### New Capabilities
- `agent-consensus`: Multi-agent peer review of high-risk proposals before CEO confirmation. Stores structured verdicts, exposes consensus summary, and gates high-risk proposals behind at least one peer review.

### Modified Capabilities
- `action-approval-safety`: High-risk proposals classified by `requiresConsensus()` MUST show consensus summary before reaching the CEO "dale" prompt. Low-risk proposals unaffected.
- `multi-agent-orchestration`: Daemons enqueuing high-risk proposals SHALL invoke `requiresConsensus()` and attach consensus requirements to the proposal payload.

## Approach

1. New SQLite table `agent_reviews` with schema from the roadmap document
2. `createAgentConsensusStore(db)` in `packages/agent/src/conversation/agentConsensusStore.ts` following the factory pattern of `agentMessageBusStore.ts`
3. `requiresConsensus()` classifier: maps proposal kinds to risk levels (price >20% → high, publishing → high, pause/close → high, Product Ads budget → high, sync → high, sensitive claims → high; rest → low)
4. CEO flow: when presenting a proposal whose `requiresConsensus()` returns `true`, display aggregated consensus verdicts alongside the proposal before the "dale" prompt
5. Vitest tests with `better-sqlite3` `:memory:` DB

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/agentConsensusStore.ts` | New | Consensus store factory |
| `packages/agent/src/index.ts` | Modified | Export new store + types |
| `packages/agent/src/conversation/agentLoop.ts` | Modified | Wire consensus check into proposal presentation |
| `packages/agent/tests/conversation/agentConsensusStore.test.ts` | New | Vitest suite |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Blocking CEO flow if no reviewers available | Low | `getConsensus()` returns empty array gracefully; consensus is advisory, not blocking |
| Classification boundary disputes | Low | `requiresConsensus()` uses explicit enum mapping; easy to adjust thresholds |

## Rollback Plan

- The `agent_reviews` table is additive only — no mutation of existing data. Remove export from `index.ts`, delete the store file. Existing proposals are unaffected; consensus was never required before.
- If daemon integration was already deployed, revert to enqueuing proposals without consensus metadata. CEO flow degrades to pre-consensus behavior.

## Dependencies

- `@msl/memory` (`getSharedDb`)
- `better-sqlite3` (existing dependency)
- `vitest` (existing dev dependency)

## Success Criteria

- [ ] `createAgentConsensusStore` factory creates table, accepts reviews, returns consensus
- [ ] `requiresConsensus` correctly classifies all 6 high-risk and low-risk proposal kinds
- [ ] Vitest suite passes with `:memory:` DB
- [ ] CEO flow displays consensus summary when required (integration verified manually or via daemon test)
