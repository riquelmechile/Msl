# creative-generation-attempts Specification

## Purpose

Durable attempt boundary for creative generation calls.

## Requirements

### Requirement: Prepared-Before-POST Contract

An attempt MUST persist `prepared` before provider dispatch with canonical-payload SHA-256 `request_hash`, key `(seller_id, job_id, attempt_id)`, and request evidence. Immediately before/around dispatch it MUST durably transition to `dispatching`; `prepared` proves definitely unsent, while `dispatching` means possibly sent. Persistence failure MUST block dispatch.

#### Scenario: Attempt persisted before call

- GIVEN reservation R admitted for job J
- WHEN daemon creates attempt with key (S, J, A1) and hash H
- THEN `prepared` with H exists before dispatch; `dispatching` persists before bytes may be sent

#### Scenario: Persistence failure blocks call

- GIVEN attempt persistence fails
- WHEN daemon tries to create attempt
- THEN provider call NOT made; reservation released

### Requirement: Attempt State Transitions

Allowed transitions are `prepared → dispatching`; `dispatching → submitted | completed | failed | ambiguous`; `submitted → completed | failed | ambiguous`; and evidence-gated `ambiguous → completed | failed`. Submitted SHALL carry `task_id`; completed SHALL carry result/cost evidence; failed SHALL carry error/no-charge evidence. Terminal rows cannot transition except an exact repeated close, which is idempotent; divergent closure conflicts.

#### Scenario: Happy path

- GIVEN attempt `dispatching`
- WHEN POST succeeds with task_id T and file URLs
- THEN attempt `submitted` then `completed`; evidence carries T

#### Scenario: Provider error

- GIVEN attempt `submitted` with task_id T
- WHEN provider returns permanent error
- THEN `failed` with error reason

#### Scenario: POST crash ambiguous

- GIVEN attempt `dispatching`, POST may have been sent, response is lost
- WHEN system recovers
- THEN attempt becomes `ambiguous`; MUST NOT re-POST

#### Scenario: Terminal immutable

- GIVEN attempt `completed` with evidence E
- WHEN closure repeats E or supplies different evidence/outcome
- THEN exact repeat is idempotent; divergence conflicts

#### Scenario: Ambiguous reconciliation

- GIVEN A `ambiguous`
- WHEN provider evidence proves completion, or definitive failure with no completion/charge
- THEN same A closes `completed` or `failed` respectively with that evidence

### Requirement: Provider Idempotency and Evidence Refs

Each attempt SHALL record `task_id` on submission and file IDs, URLs, and cost on completion. Video polling SHALL reuse its attempt/reservation without a new charge. Close is idempotent only for exact identity, outcome, and evidence; divergence SHALL conflict.

#### Scenario: Task ID recorded

- GIVEN attempt A `prepared`
- WHEN MiniMax returns task_id T
- THEN A `submitted` with task_id=T

#### Scenario: Video poll reuses attempt

- GIVEN A `submitted` with task_id=T, reservation R
- WHEN daemon polls for T
- THEN same A updated; no new reservation

#### Scenario: Duplicate completion idempotent

- GIVEN A already `completed`
- WHEN complete called again same evidence
- THEN idempotent; no change

#### Scenario: Divergent outcome conflict

- GIVEN A `failed`
- WHEN complete called for A
- THEN conflict; terminal immutable

### Requirement: Lease and Recovery

Leased stale `dispatching` or `submitted` attempts SHALL recover on the SAME attempt. Query by task_id when available: proven completion closes `completed`; definitive failure closes `failed`; unknown/unreachable becomes `ambiguous`. Recovery MUST NOT dispatch again.

#### Scenario: Lease completes same attempt

- GIVEN A `submitted` for >TTL, task_id T
- WHEN lease acquired, provider says T completed
- THEN same A → `completed` with evidence

#### Scenario: Unreachable provider

- GIVEN A `submitted` for >TTL, provider unreachable
- WHEN lease query fails
- THEN A stays `ambiguous`; no retry

### Requirement: No Blind Retry

`ambiguous` MUST NOT trigger POST or a new attempt. It cannot return to `prepared`/`dispatching`. Operator reconciliation MAY close the SAME attempt only as specified above, with durable evidence.

#### Scenario: Ambiguous blocks retry

- GIVEN A is `ambiguous`
- WHEN daemon encounters A
- THEN skips A; no new POST; operator alerted
