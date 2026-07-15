# Delta for economic-evidence-store

## MODIFIED Requirements

### R4: CRUD methods

The store MUST provide: `insertEvidence`, `upsertEvidence`, `getEvidence`, `listBySeller`, `listByRun`, `listBySourceRecord`, `markSuperseded`, `countByRun`. `markSuperseded` MUST accept an explicit authorized `sellerId` and named `supersedingEvidenceId` only from an approved seller-scoped runtime/store boundary; it MUST NOT derive authorization from a model, external payload, target evidence, or conversational tool. It MUST update a target only where both `evidence_id` and `seller_id` match, and only if the successor exists for that same seller. Rejected calls MUST be deterministic, non-throwing, non-oracular no-ops. They MUST NOT alter any supersession field or unrelated evidence, source-health, checkpoint, run, lease, fence, or epoch state, and outputs, errors, and logs MUST NOT disclose foreign sellers, payloads, emails, tokens, local paths, or internal SQL.

(Previously: `markSuperseded` linked a target and successor by their evidence IDs without explicit seller authorization or same-seller validation.)

#### Scenario: listByRun returns run-scoped evidence

- GIVEN runs R1 and R2 each produced 3 refs
- WHEN `listByRun('R1')` is called
- THEN exactly 3 refs MUST be returned AND all MUST have `ingestion_run_id = 'R1'`

#### Scenario: countByRun aggregates

- GIVEN run R1 with 5 evidence refs
- WHEN `countByRun('R1')` is called
- THEN 5 MUST be returned

#### Scenario: Plasticov same-seller link succeeds

- GIVEN authorized Plasticov and existing Plasticov target E1 and successor E2
- WHEN `markSuperseded(Plasticov, E1, E2)` is called
- THEN E1 `superseded_by` MUST become E2 and E1 MUST remain queryable

#### Scenario: Maustian same-seller link succeeds

- GIVEN authorized Maustian and existing Maustian target E3 and successor E4
- WHEN `markSuperseded(Maustian, E3, E4)` is called
- THEN E3 `superseded_by` MUST become E4 without affecting Plasticov evidence

#### Scenario: Cross-seller target is rejected in either direction

- GIVEN authorized Plasticov with a Maustian target, or authorized Maustian with a Plasticov target
- WHEN either seller attempts supersession using its own valid successor
- THEN no state MUST change and no result MUST reveal target existence or ownership

#### Scenario: Cross-seller successor is rejected in either direction

- GIVEN a Plasticov target with a Maustian successor, or a Maustian target with a Plasticov successor
- WHEN the target owner attempts supersession
- THEN no state MUST change and no result MUST reveal successor existence or ownership

#### Scenario: Missing participants fail closed

- GIVEN an authorized seller and a missing target or missing successor ID
- WHEN supersession is requested
- THEN zero rows and no unrelated state MUST change without sensitive or existence disclosure

#### Scenario: Invalid authorization or identifiers are safe

- GIVEN an empty or malformed seller ID, or missing target or successor IDs
- WHEN supersession is requested
- THEN the call MUST be non-throwing and leave all supersession fields unchanged

#### Scenario: Rejections preserve adjacent state and safe diagnostics

- GIVEN a rejected request and existing evidence, source-health, checkpoint, run, lease, fence, and epoch state
- WHEN the rejection completes
- THEN none of that state MUST change, and logs, errors, and results MUST reveal no foreign seller, payload, email, token, local path, or internal SQL

#### Scenario: Repeated valid call is idempotent

- GIVEN an authorized seller whose E1 is already superseded by E2
- WHEN the same supersession call is repeated
- THEN it MUST remain deterministic and non-throwing with E1 still superseded by E2

#### Scenario: Seller-scoped reads remain isolated

- GIVEN Plasticov and Maustian evidence, including a rejected cross-seller request
- WHEN either seller reads evidence through a seller-scoped method
- THEN no evidence belonging to the other seller SHALL appear

#### Scenario: Concurrent seller operations remain isolated

- GIVEN valid supersession operations for Plasticov and Maustian execute concurrently
- WHEN both operations complete
- THEN each MUST affect only its own seller's target and successor relationship
