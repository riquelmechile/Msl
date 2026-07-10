# Finance Director Assessment Store Specification

## Purpose

SQLite persistence for `FinancialAssessment` records. Seller-scoped isolation, idempotent upserts, and structured query methods.

## Requirements

### Requirement: Assessment Persistence

The store MUST persist `FinancialAssessment` with: `assessmentId`, `sellerId`, `type` (question/health/outcome/proposal), `outcome`, `confidence`, `completeness`, `evidenceIds`, `gaps`, `reasoningTrace`, `source`, `correlationId`, `sessionId`, `createdAt`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Insert | Valid FinancialAssessment with all fields | `insert(assessment)` | Record persisted, retrievable by `assessmentId` |
| Idempotency | Same `assessmentId` inserted twice | `insert(assessment)` | Record updated in-place, no duplicate |
| Corrupt data rejection | Missing required field `sellerId` | `insert(assessment)` | Error thrown, no write |

### Requirement: Seller Isolation

All query methods MUST scope by `sellerId`. Queries without seller filter SHALL return empty or throw.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seller A queries own | Seller A with 3 assessments | `listBySeller("A")` | 3 records returned |
| Seller A queries seller B | Seller B with 5 assessments | `listBySeller("B")` called for A's store | 0 records (seller-scoped) |

### Requirement: Query Methods

The store MUST support `getAssessment(id, sellerId)`, `listBySeller(sellerId, opts)`, `listByOutcome(sellerId, outcome)`, `listByProposal(sellerId, proposalId)`, `listBySession(sellerId, sessionId)`, `listByCorrelationId(sellerId, correlationId)`, `latestByType(sellerId, type)`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| List by outcome | 2 profitable, 3 unprofitable assessments | `listByOutcome("S", "profitable")` | 2 records returned |
| List by proposal | 4 assessments referencing proposal P | `listByProposal("S", "P")` | 4 records, ordered by `createdAt` desc |
| List by session | 7 assessments in session X | `listBySession("S", "X")` | 7 records returned |
| List by correlation | 2 assessments sharing correlation C | `listByCorrelationId("S", "C")` | 2 records returned |
| Latest by type | 10 health assessments over time | `latestByType("S", "health")` | Most recent 1 record |

### Requirement: Storage Restrictions

The store MUST NOT persist: API keys, full LLM prompts, raw provider responses, sensitive tool arguments, cross-account data, or raw evidence dumps (store evidence IDs, not evidence bodies).

### Requirement: Limit Enforcement

Queries SHALL default to limit=50. No query SHALL return more than `limit` rows regardless of input.
