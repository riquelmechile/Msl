# creative-budget-reservations Specification

## Purpose

Durable budget admission.

## Requirements

### Requirement: Atomic Reservation Admission

The system MUST admit via `BEGIN IMMEDIATE`. Both caps aggregate `committed + active non-expired held + requested` micros: daily scope is seller/currency/UTC-day; job scope is seller/job/currency. Success inserts `held` and updates totals atomically. Failure MUST NOT charge or leave partial state.

#### Scenario: Admission within caps

- GIVEN seller S committed 5,000, held 4,000 (non-expired), daily cap 50,000, per-job 10,000
- WHEN admission requests 5,000 micros
- THEN aggregate 14,000 ≤ 50,000; reservation inserted `held`

#### Scenario: Held aggregate blocks admission

- GIVEN committed 5,000, held 45,000, daily cap 50,000
- WHEN admission requests 1,000
- THEN aggregate 51,000 > 50,000; rejected

#### Scenario: Per-job cap rejects

- GIVEN job J has committed 6,000 and active held 3,000; per-job cap 10,000
- WHEN J requests 2,000 micros
- THEN aggregate 11,000 exceeds cap; rejected with no row

### Requirement: Reservation Lifecycle

Reservations MUST transition `held → committed | released | expired`; terminal rows MUST NOT transition. Release and expiry reclaim capacity. Reaper expires after TTL. Commit SHALL reconcile actual micros: actual ≤ reserved commits actual and releases excess; actual > reserved rejects. Identity mismatch SHALL conflict.

#### Scenario: Commit with exact reserved

- GIVEN R `held` with 5,000 reserved
- WHEN commit called with 5,000 same identity
- THEN R `committed` at 5,000

#### Scenario: Commit releases excess

- GIVEN R `held` 10,000 reserved, daily total 20,000
- WHEN commit called with 7,000 same identity
- THEN R `committed` at 7,000; 3,000 released

#### Scenario: Commit overage rejected

- GIVEN R `held` with 5,000 reserved
- WHEN commit called with 8,000 same identity
- THEN rejected; R stays `held`

#### Scenario: Identity mismatch conflict

- GIVEN R for seller S1, attempt A1
- WHEN commit called for seller S2
- THEN conflict; R unchanged

### Requirement: Idempotency Keys

Admission MUST key `(seller_id, job_id, attempt_id)`. A duplicate is idempotent only when seller, job, attempt, currency, and requested micros match exactly; it returns the row without charging. Mismatch SHALL conflict. Terminal transitions are idempotent only for exact identity, state, and amount; divergence SHALL conflict.

#### Scenario: Duplicate admission returns existing

- GIVEN `held` reservation for (S,J,A1,USD,5,000)
- WHEN admission repeats (S,J,A1,USD,5,000)
- THEN existing returned; no new row

#### Scenario: Divergent duplicate conflicts

- GIVEN reservation for (S,J,A1,USD,5,000)
- WHEN admission repeats its key with EUR or 6,000
- THEN conflict; existing row and totals unchanged

#### Scenario: Terminal idempotent

- GIVEN reservation `committed` with 5,000
- WHEN commit called same identity+amount
- THEN idempotent; no change

#### Scenario: Divergent terminal conflicts

- GIVEN reservation `committed`
- WHEN release called
- THEN conflict; terminal immutable

### Requirement: UTC Day Boundary

Daily caps MUST use UTC midnight. A new UTC day SHALL reset the total. Daily totals are scoped by seller, currency, and UTC date.

#### Scenario: Cap resets at midnight

- GIVEN seller spent 49,000 on 2026-07-19
- WHEN admission requests 2,000 after UTC midnight 2026-07-20
- THEN succeeds; daily total = 2,000 for new day

### Requirement: Decimal-to-Micros Rounding

Amounts MUST be integer micros; fractional or unsafe integers SHALL be rejected. Float USD MUST use `Math.round(usd × 1_000_000)`.

#### Scenario: Fractional micros rejected

- GIVEN 5.3 micros
- WHEN admission receives it
- THEN rejected; integer required

#### Scenario: Float-to-micros rounding

- GIVEN USD 0.0000155
- WHEN converted
- THEN `Math.round(0.0000155 × 1_000_000)` = 16 micros

### Requirement: Concurrency and Crash Safety

Admission MUST serialize with `BEGIN IMMEDIATE`. Holds MUST survive restart. Rollback MUST NOT leave partial rows or corrupt totals.

#### Scenario: Concurrent workers serialize

- GIVEN two workers admit different keys simultaneously
- WHEN both touch same seller daily total
- THEN `BEGIN IMMEDIATE` serializes; each sees consistent state

#### Scenario: Crash mid-transaction

- GIVEN worker crashes during `BEGIN IMMEDIATE`
- WHEN SQLite rolls back
- THEN no reservation row; daily total unchanged
