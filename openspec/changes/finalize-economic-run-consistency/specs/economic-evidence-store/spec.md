# Delta for economic-evidence-store

## MODIFIED Requirements

### R3: Composite idempotency key
The system SHALL enforce uniqueness on `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)`. A changed source version, including a refund revision, MUST be retained as distinct evidence and MUST retain an auditable predecessor/successor relationship. (Previously: the key was specified without changed-version/refund semantics.)

#### Scenario: Duplicate key upsert is idempotent
- GIVEN evidence E1 already has a composite key
- WHEN it is upserted with the same key
- THEN no row SHALL be created and E1 SHALL remain unchanged

#### Scenario: Refund version changes
- GIVEN a refund evidence reference at v1
- WHEN an authoritative v2 reference arrives
- THEN v2 MUST be queryable and v1 MUST remain auditable

### R4: CRUD methods
The store MUST provide seller-scoped `listByRun(sellerId, runId)` and `countByRun(sellerId, runId)` as well as its existing CRUD operations; every run query MUST require seller scope. (Previously: run list/count accepted only a run ID.)

#### Scenario: listByRun returns run-scoped evidence
- GIVEN two sellers have evidence for distinct runs
- WHEN one seller lists its run
- THEN only that seller's matching references MUST return

#### Scenario: countByRun aggregates
- GIVEN a seller run has five references
- WHEN its seller-scoped count is requested
- THEN five MUST be returned

#### Scenario: seller-safe supersession
- GIVEN original and replacement evidence IDs
- WHEN supersession is requested for a seller
- THEN one transaction MUST prove both rows belong to that seller, reject self-links and detectable cycles, and update exactly the original row

#### Scenario: markSuperseded links replacement
- GIVEN E1 is superseded by E2
- WHEN it is marked superseded
- THEN E1 MUST remain queryable with `superseded_by = E2`

#### Scenario: seller-safe exact update
- GIVEN seller X owns E1 and E2
- WHEN `markSuperseded(X, E1, E2)` runs
- THEN exactly one E1 row MUST change

### R7: Query filters
List and inspect methods SHALL require `sellerId` and support `ingestionRunId`, `sourceRecordId`, `verification`, and a default limit of 20. CLI `--run` MUST apply the same seller-scoped filter. (Previously: the CLI filter contract was not explicit.)

#### Scenario: Filter by verification
- GIVEN mixed verification values
- WHEN a seller filters `verified`
- THEN only verified references MUST return

#### Scenario: Run filter isolation
- GIVEN seller X and Y have references
- WHEN X uses `--run`
- THEN Y evidence SHALL NOT appear
