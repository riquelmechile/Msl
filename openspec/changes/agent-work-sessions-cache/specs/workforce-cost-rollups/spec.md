# Delta for workforce-cost-rollups

## ADDED Requirements

### Requirement: seller_id Column Migration

`workforce_cost_cache_ledger_entries` SHALL gain `seller_id TEXT` via idempotent `columnExists()` migration. Existing rows default to NULL. Migration MUST be re-runnable without error.

#### Scenario: Migration adds column

- GIVEN ledger table without `seller_id`
- WHEN migration runs
- THEN column exists, existing rows NULL

#### Scenario: Migration idempotent

- GIVEN column already exists
- WHEN migration re-runs
- THEN no error

### Requirement: Session Attribution Fields

`insertEntry()` SHALL accept optional fields: `sellerId`, `sessionId`, `stablePromptHash`, `evidenceHash`. When provided, these fields persist with the entry.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Session attribution | LLM call from work session runner | `insertEntry({ sellerId: "plasticov", sessionId, stablePromptHash, ... })` | Fields persisted alongside token counts |
| Backward compatible | Existing caller omits new fields | `insertEntry({ laneId, ... })` | Entry stored; new fields NULL |

### Requirement: Per-Seller Cost Aggregation

`aggregateCostByAgentAndSeller(sellerId, since)` MUST return cost breakdown by agent within a seller account using `seller_id` column on ledger entries.

#### Scenario: Cost by seller

- GIVEN Plasticov: 500K tokens, Maustian: 300K tokens
- WHEN `aggregateCostByAgentAndSeller("plasticov")` called
- THEN returns 500K, no Maustian data

### Requirement: Cache Efficiency by Seller

`aggregateCacheEfficiencyBySeller(sellerId)` MUST compute cache-hit ratio per seller from ledger entries with `seller_id` populated.

#### Scenario: Cache efficiency per seller

- GIVEN Plasticov: 80% cache hits, Maustian: 40%
- WHEN `aggregateCacheEfficiencyBySeller("plasticov")` called
- THEN returns ~0.8 ratio

### Requirement: Agent Loop Includes sessionId

`recordLlmUsage()` in agentLoop SHALL pass `sessionId` when available. Daemon work sessions SHALL set `sessionId` on every ledger entry.

## MODIFIED Requirements

### Requirement: Dual-Table Cost Ledger

The system SHALL maintain `workforce_cost_cache_ledger_entries` (raw, pruned at 5,000 entries) with `seller_id TEXT`, `session_id TEXT`, `stable_prompt_hash TEXT`, `evidence_hash TEXT` columns added via idempotent migration.
(Previously: table had no `seller_id`, `session_id`, or prompt hash columns.)

## REMOVED Requirements

_None._
