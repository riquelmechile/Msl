# creative-cost-ledger Specification

## Purpose

Durable daily budget ledger with two-phase `awaiting-budget-approval`: pre-dispatch (zero messages) and runtime (one existing message retained in durable nonterminal `deferred`). SQLite-backed, restart-safe, seller-scoped.

## Requirements

### Requirement: Atomic Budget Gate (Both Phases)

**Pre-dispatch**: `canAfford()` returns true → atomically create one durable row + enqueue one message → `provider-routing`. Returns false → one row in `awaiting-budget-approval` (phase=pre-dispatch); ZERO messages; ZERO provider calls.

**Runtime**: job in `running` with one existing bus message; `canAfford()` returns false → transition `running → awaiting-budget-approval` (phase=runtime); retain existing message in durable nonterminal `deferred`; ZERO NEW messages; ZERO NEW provider calls. Polling already-paid video tasks SHALL NOT be a new charge. Daily cap: `MSL_CREATIVE_STUDIO_MAX_DAILY_USD`, UTC calendar day.

#### Scenario: Pre-dispatch allowed

- GIVEN daily $1.00/$5.00; job estimated cost $0.02
- WHEN gate executes
- THEN one row + one message → `provider-routing`

#### Scenario: Pre-dispatch exhausted

- GIVEN daily $4.99/$5.00; job estimated cost $0.02
- WHEN gate executes
- THEN one row in `awaiting-budget-approval`; phase=pre-dispatch; zero messages; zero calls

#### Scenario: Runtime exhausted

- GIVEN job `running` with one existing message; daily cap hit
- WHEN gate executes
- THEN `awaiting-budget-approval`; phase=runtime; existing message retained `deferred`; zero NEW calls

#### Scenario: Polling is not a charge

- GIVEN video job with existing paid task being polled
- WHEN budget gate evaluates
- THEN polling passes without charge

#### Scenario: Restart-safe

- GIVEN $3.50 spent in current UTC day; daemon restarts
- WHEN ledger queried
- THEN daily spend reads $3.50 from durable store

### Requirement: CEO Single-Job Exception (Both Phases)

CEO MAY approve one job from `awaiting-budget-approval`. SHALL re-check seller identity, policy compliance, and authorization before acting.
- **Pre-dispatch**: atomically enqueue one message → `provider-routing`.
- **Runtime**: transition same job/message to `running`; ZERO new messages.
Both: never raise daily cap; audited; 24h expiry from entry. No CEO response within 24h: pre-dispatch → `failed` (zero messages); runtime → `failed` (resolve existing message once). `budgetWaitPhase` SHALL be persisted for audit.

#### Scenario: Pre-dispatch CEO approval

- GIVEN row in `awaiting-budget-approval` (phase=pre-dispatch); re-checks pass
- WHEN CEO approves
- THEN atomic one message → `provider-routing`; cap unchanged; audited

#### Scenario: Runtime CEO approval

- GIVEN row in `awaiting-budget-approval` (phase=runtime); one message `deferred`; re-checks pass
- WHEN CEO approves
- THEN same message `deferred → pending`; → `running`; cap unchanged; audited

#### Scenario: Re-check fails

- GIVEN seller invalid or policy violated since entry
- WHEN CEO approves
- THEN rejected; stays `awaiting-budget-approval`

#### Scenario: Pre-dispatch 24h timeout

- GIVEN phase=pre-dispatch; 24h elapsed; no CEO response
- WHEN timeout triggers
- THEN job → `failed`; zero messages

#### Scenario: Runtime 24h timeout

- GIVEN phase=runtime; 24h elapsed; no CEO response; one existing message
- WHEN timeout triggers
- THEN job → `failed`; resolve existing message once

### Requirement: State-Aware Idempotent Identity

SHALL use stable seller-scoped idempotency key for every job. Retry behavior branches on current state:
- `provider-routing` or later → return existing row; zero new messages/calls.
- Pre-enqueue (row created, message not yet sent) → resume enqueue exactly once; advance state.
- Post-enqueue crash (message sent, status not yet advanced) → discover deduped message; advance to `provider-routing`; no second message.
- `awaiting-budget-approval` → return existing row; zero messages until valid CEO approval.
One `jobId` spans all artifacts for the request.

#### Scenario: Dispatched row retry

- GIVEN row at `provider-routing`; same idempotency key retried
- WHEN gate evaluates
- THEN existing row returned; zero new messages/calls

#### Scenario: Pre-enqueue retry

- GIVEN row created; message not yet enqueued
- WHEN gate evaluates with same key
- THEN enqueue exactly once; advance state

#### Scenario: Post-enqueue crash recovery

- GIVEN message enqueued; crash before status update
- WHEN restart; same key retried
- THEN message discovered via dedup; state advanced to `provider-routing`; no second message

#### Scenario: Awaiting-budget retry

- GIVEN row in `awaiting-budget-approval`; same key retried
- WHEN gate evaluates
- THEN existing row returned; zero messages until CEO approval

### Requirement: Audit Trail

Every budget event SHALL log: `jobId`, idempotency key, `budgetWaitPhase` (`pre-dispatch` | `runtime`), `estimatedCostUsd`, `actualCostUsd`, timestamp, action. Actions include: `budget-allowed`, `awaiting-budget-approval`, `exception-approved`, `exception-expired`, `incurred`, `budget-exhausted`. Audit SHALL be durable and restart-safe.

#### Scenario: Full pre-dispatch chain

- GIVEN exhausted → CEO approved → $0.015 incurred
- WHEN each event occurs
- THEN audit entries recorded per transition with `jobId` and `budgetWaitPhase`

#### Scenario: Full runtime chain

- GIVEN `running` → exhausted → CEO approved → resumed
- WHEN each event occurs
- THEN phase=runtime persisted; same message identity retained throughout
