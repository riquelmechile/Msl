# Design: Agent Consensus Review

## Architecture Decision

**Decision**: New standalone SQLite store (`agentConsensusStore.ts`) following the exact same factory pattern as `agentMessageBusStore.ts` and `companyAgentSkillStore.ts`.

**Rationale**: The existing 7 stores in `packages/agent/src/conversation/` all follow the same contract: import `better-sqlite3`, define `SCHEMA_SQL`, implement `createXxxStore(db): XxxStore`. Adding a new table and store for consensus is the lowest-friction path and matches codebase conventions exactly.

**Tradeoff considered**: Could embed reviews in the existing `agent_message_bus` table as a JSON column. Rejected because reviews are a distinct lifecycle from messages — they need their own indices, their own query patterns, and their own validation logic. Normalizing into a separate table avoids column bloat on the message bus.

## Data Model

```sql
CREATE TABLE IF NOT EXISTS agent_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  reviewer_agent_id TEXT NOT NULL,
  verdict TEXT NOT NULL,  -- approve | reject | needs_more_evidence | risk_warning
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

No foreign keys. `proposal_id` references a logical proposal identifier (free text), not a row in another table. This keeps the consensus store decoupled from the message bus.

## API Surface

```typescript
type ReviewVerdict = "approve" | "reject" | "needs_more_evidence" | "risk_warning";

type HighRiskProposalKind =
  | "price-change"    // when riskDelta > 0.20
  | "publish-product"
  | "pause-listing"
  | "close-listing"
  | "product-ads-budget"
  | "sync-product"
  | "claim-response";

type AgentConsensusStore = {
  submitReview(input: SubmitReviewInput): AgentReview;
  getConsensus(proposalId: string): readonly AgentReview[];
  requiresConsensus(proposalKind: string, riskDelta?: number): boolean;
};
```

## Risk Classification Logic

`requiresConsensus()` uses a set-based lookup:

```
HIGH_RISK_KINDS = { publish-product, pause-listing, close-listing, product-ads-budget, sync-product, claim-response }
LOW_RISK_KINDS  = { info-report, catalog-health, restock-signal }

For "price-change": requiresConsensus iff riskDelta > 0.20
For anything not in HIGH_RISK_KINDS: false
```

## CEO Flow Integration

```
Daemon enqueues proposal → includes { kind, riskDelta } in payload
CEO lane claims message → calls requiresConsensus(kind, riskDelta)
  ├─ false → present normally with "dale" prompt
  └─ true  → calls getConsensus(proposalId)
              ├─ presents consensus summary
              └─ shows "dale" prompt below consensus
```

## File Layout

```
packages/agent/src/conversation/agentConsensusStore.ts   (new, ~110 lines)
packages/agent/src/index.ts                               (modified, +3 exports)
packages/agent/tests/conversation/agentConsensusStore.test.ts (new, ~170 lines)
```

## Sequence

```
Daemon        ConsensusStore      CEO Lane (agentLoop)
  │                │                    │
  │── enqueue ────►│                    │
  │  (kind=price,  │                    │
  │   delta=0.25)  │                    │
  │                │                    │
  │                │◄── claimNext ──────│
  │                │── proposal msg ───►│
  │                │                    │
  │                │◄── requiresConsensus("price-change", 0.25) ──│
  │                │── true ───────────►│
  │                │                    │
  │                │◄── getConsensus(propId) ─────────────────────│
  │                │── [reviews...] ───►│
  │                │                    │
  │                │                    │── present to CEO ──────►
  │                │                    │   consensus: 2 approve,
  │                │                    │   1 risk_warning
  │                │                    │   ¿dale?
```
