# Delta for action-approval-safety

## ADDED Requirements

### Requirement: Seller-Scoped Approval Schema
`approval_queue_entries`, `approval_records`, `audit_records` MUST gain `seller_id TEXT` via idempotent `ALTER TABLE ADD COLUMN`. Backfill from `action_json.sellerId` where available; default NULL otherwise.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Migration adds columns | Tables without `seller_id` | Migration runs | All three tables gain `seller_id`; backfill succeeds |
| Migration idempotent | Column exists | Re-run | No error |

### Requirement: Per-Account Approval Queue Queries
`listPendingBySeller(sellerId)` MUST return only that account's pending entries. `getEntryForSeller(actionId, sellerId)` MUST verify ownership first.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Filtered queue | 3 Plasticov pending, 2 Maustian | `listPendingBySeller("plasticov")` | 3 entries returned |
| Cross-account blocked | "act-1" belongs to Plasticov | `getEntryForSeller("act-1","maustian")` | Not returned |

### Requirement: Per-Account "dale" Resolution
"dale" MUST resolve against bot's configured `sellerId`. Multi-account ambiguity SHALL reject and ask for account specification.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Ambiguity rejected | Both accounts have pending proposals | User: "dale" | Neither executes; asks "¿dale para cuál cuenta?" |
| "dale la de Maustian" | Both pending | User specifies account | Only Maustian confirmed |
| Single-account bot | Bot bound to Plasticov, only Plasticov pending | User: "dale" | Confirmed normally |

### Requirement: Duplicate Tick Idempotency
Duplicate daemon tick for same `(laneId, sellerId, dedupe_key)` MUST NOT duplicate proposals. Composite `(seller_id, dedupe_key)` uniqueness enforced.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| No duplicate | Tick for market-catalog/plasticov at 10:00 pending | Same tick re-enqueued | No second proposal created |

## MODIFIED Requirements

### Requirement: Conversational Proposal Pipeline
`PreparedAction` MUST carry `sellerId` scoped to active account. "dale" confirms proposals FOR THAT ACCOUNT only. (Previously: global proposal resolution.)

#### Scenario: Agent proposes action scoped to account
- GIVEN agent in Maustian context suggests price change
- WHEN proposal formatted → `PreparedAction` with `sellerId = "maustian"`, pending

### Requirement: Risk Audit Trail
Audit MUST record `seller_id`, who approved, what changed, why, when, risk, proposer type. (Previously: sellerId in JSON only; no column.)

### Requirement: Human Approval for Writes
(Unchanged. Per-account autonomy level gates already covered by autonomy-engine delta.)

## REMOVED Requirements
(None)
