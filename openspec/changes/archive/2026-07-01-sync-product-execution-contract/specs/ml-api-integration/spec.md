# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Create vs Update API Semantics

`publishItem` SHALL call POST /items for listings not yet on target account; `updateItem` SHALL call PUT /items/{id} for existing listings. Callers MUST resolve existence before selecting endpoint. Speculative fallback MUST NOT occur.

#### Scenario: Publish resolves to POST

- GIVEN target listing is absent from Maustian
- WHEN `publishItem` is called
- THEN it MUST POST to /items with full payload

#### Scenario: Update resolves to PUT

- GIVEN target exists with known Maustian itemId
- WHEN `updateItem` is called
- THEN it MUST PUT to /items/{id} with delta payload

### Requirement: Capability Matrix — Mutation Entries

The matrix MUST include create, update, status-change, and relist rows backed by real API evidence with confirmed MLC site support.

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|-------------|-----------------|
| Create listing | `future-execute-with-approval` | POST /items | MLC-confirmed | Orchestrated flow |
| Update listing | `future-execute-with-approval` | PUT /items/{id} | MLC-confirmed | Orchestrated flow |
| Status change | `future-execute-with-approval` | PUT /items/{id} (status body) | MLC-confirmed | Recovery-only |
| Relist | `future-execute-with-approval` | POST /items/{id}/relist | MLC-confirmed | Recovery-only |

#### Scenario: Mutation entries reference real endpoints

- GIVEN a mutation entry in the matrix
- WHEN classified
- THEN it MUST reference documented ML endpoint with MLC-confirmed site support

## MODIFIED Requirements

### Requirement: ML API Write Operations

The system MUST expose `publishItem` (POST /items for new listings), `updateItem` (PUT /items/{id} for existing), `changeItemStatus` (PUT /items/{id} with status body). Callers MUST resolve create-vs-update before invoking. Writes SHALL return snapshots with id, permalink, freshness metadata.
(Previously: no explicit create-vs-update resolution contract.)

#### Scenario: Publish to Maustian

- GIVEN valid Maustian OAuth and listing absence confirmed
- WHEN `publishItem` is called with payload
- THEN it MUST POST to /items and return itemId and permalink

#### Scenario: Update existing listing

- GIVEN valid Maustian OAuth and known itemId
- WHEN `updateItem` is called
- THEN it MUST PUT to /items/{id} and return updated itemId and permalink

#### Scenario: Write fails on token mismatch

- GIVEN Plasticov token is active
- WHEN write targets Maustian sellerId
- THEN the system MUST reject with `seller-access-mismatch`

### Requirement: Product Sync Engine

The system SHALL provide `ProductSyncEngine` for bulk/differential sync. For the approved execution path, the engine is OBSOLETE: execution MUST use the orchestrated flow (readiness → idempotency → resolve → ML API → audit). Execution tools SHALL NOT import, instantiate, or call `ProductSyncEngine`.
(Previously: ProductSyncEngine was the only defined sync path.)

#### Scenario: Full sync publishes listing batch

- GIVEN Plasticov has listings and Maustian is empty
- WHEN `syncProducts` runs with margin strategy
- THEN listings MUST be extracted, priced, published, and mapped in sync state

#### Scenario: Differential sync skips unchanged

- GIVEN prior sync published 40 products
- WHEN only 5 listings changed
- THEN `syncProducts` MUST detect changed set and SHALL NOT republish unchanged

#### Scenario: Engine bypassed for approved execution

- GIVEN an approved proposal reaches execution
- WHEN the orchestrated flow processes it
- THEN `ProductSyncEngine` MUST NOT be invoked

### Requirement: Non-Mutating ML Execution Readiness Evidence

Readiness MUST require API capability evidence, source completeness, dry-run/revalidation, seller/account safeguards, target availability, idempotency candidate, rollback plan, rate/error handling, and redaction. Missing mutation evidence MUST return `api-capability-evidence-missing`. API evidence MUST reference a matrix entry with MLC-confirmed site support.
(Previously: no explicit matrix tie for capability evidence.)

#### Scenario: API evidence is unavailable

- GIVEN ML docs lack mutation evidence for target behavior
- WHEN readiness evaluates prerequisites
- THEN result MUST be `blocked`/`degraded` with `api-capability-evidence-missing`

#### Scenario: Mutation runtime remains forbidden

- GIVEN any readiness path runs
- WHEN ML integration code is selected
- THEN it MUST NOT call publishItem, updateItem, changeItemStatus, ProductSyncEngine, sync_all, or audit replay
