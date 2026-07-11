# economic-evidence-store Specification

## Purpose

Durable evidence chain-of-custody: persist economic evidence references with provenance, idempotent upsert by composite key, version superseding, and audit queries — without storing PII.

## Requirements

| # | Requirement | Scenarios |
|---|------------|-----------|
| R1 | Evidence reference table | 1 |
| R2 | No PII storage | 1 |
| R3 | Composite idempotency key | 1 |
| R4 | CRUD methods | 3 |
| R5 | Version superseding | 1 |
| R6 | inspect CLI command | 1 |
| R7 | Query filters | 2 |
| R8 | Cross-seller isolation | 1 |

### R1: Evidence reference table

The system MUST create `economic_evidence_references` with columns: `evidence_id TEXT PK`, `ingestion_run_id TEXT NOT NULL`, `seller_id TEXT NOT NULL`, `source_system TEXT NOT NULL`, `source_entity_type TEXT NOT NULL`, `source_record_id TEXT NOT NULL`, `source_field TEXT`, `observed_at INTEGER NOT NULL`, `occurred_at INTEGER`, `source_version TEXT`, `checksum TEXT NOT NULL`, `verification TEXT`, `confidence REAL`, `superseded_by TEXT`, `created_at INTEGER NOT NULL`.

#### Scenario: Table created on init

- GIVEN a fresh SQLite database
- WHEN `EconomicEvidenceStore.initialize()` runs
- THEN `economic_evidence_references` MUST exist with all columns AND indexes on `(ingestion_run_id)`, `(seller_id)`, `(source_record_id)`

### R2: No PII

The evidence store MUST NOT persist raw payloads, buyer data, emails, phones, addresses, document IDs, tokens, `Authorization` headers, or signed URLs.

#### Scenario: PII fields rejected

- GIVEN an insert with a `rawPayload` containing buyer PII
- WHEN the insert is attempted
- THEN it MUST be rejected OR the PII field MUST be stripped before storage

### R3: Composite idempotency key

The system SHALL enforce uniqueness on `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)`.

#### Scenario: Duplicate key upsert is idempotent

- GIVEN evidence E1 already stored with a given composite key
- WHEN `upsertEvidence` is called with the same key
- THEN no new row SHALL be created AND E1 SHALL remain unchanged

### R4: CRUD methods

The store MUST provide: `insertEvidence`, `upsertEvidence`, `getEvidence`, `listBySeller`, `listByRun`, `listBySourceRecord`, `markSuperseded`, `countByRun`.

#### Scenario: listByRun returns run-scoped evidence

- GIVEN runs R1 and R2 each produced 3 refs
- WHEN `listByRun('R1')` is called
- THEN exactly 3 refs MUST be returned AND all MUST have `ingestion_run_id = 'R1'`

#### Scenario: countByRun aggregates

- GIVEN run R1 with 5 evidence refs
- WHEN `countByRun('R1')` is called
- THEN 5 MUST be returned

#### Scenario: markSuperseded links replacement

- GIVEN evidence E1 (v1) superseded by E2 (v2)
- WHEN `markSuperseded('E1', 'E2')` is called
- THEN `superseded_by` = `'E2'` AND E1 MUST remain queryable

### R5: Version superseding

New versions SHALL supersede older ones via `superseded_by` without deleting the original.

#### Scenario: Old version preserved after supersede

- GIVEN E1 superseded by E2
- WHEN `getEvidence('E1')` is called
- THEN `superseded_by = 'E2'` AND E2 MUST be independently queryable

### R6: inspect CLI command

`inspect_evidence_references` MUST query the real evidence store (not reconstruct from components) and require `sellerId`.

#### Scenario: inspect queries live store

- GIVEN the store has 3 refs for seller X
- WHEN `inspect_evidence_references` is called with `sellerId = 'X'`
- THEN results MUST come from `economic_evidence_references` queries, not computed data

### R7: Query filters

List/inspect methods SHALL support: `sellerId` (required), `ingestionRunId`, `sourceRecordId`, `verification`, `limit` (default 20).

#### Scenario: Filter by verification

- GIVEN refs with mixed verification values
- WHEN listing with `verification = 'verified'`
- THEN only verified refs MUST be returned

#### Scenario: Limit enforces cap

- GIVEN 100 evidence refs for a seller
- WHEN listing with no explicit `limit`
- THEN at most 20 refs MUST be returned

### R8: Cross-seller isolation

All queries MUST scope to the provided `sellerId`. No query SHALL return evidence from a different seller.

#### Scenario: Cross-seller query returns empty

- GIVEN evidence for sellers X and Y
- WHEN querying with `sellerId = 'X'`
- THEN no evidence from seller Y SHALL appear
