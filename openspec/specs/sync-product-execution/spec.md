# sync-product-execution Specification

## Purpose

Execution contract bridging `sync_product` readiness eligibility to safe MercadoLibre mutation. Contract-only — no runtime mutation code.

## Requirements

### Requirement: Execution Eligibility Gate

The system MUST validate four gates before a `sync_product` proposal reaches ML mutation: (1) approval recorded via `Record-Only Product Sync Approval`, (2) readiness evaluated as `eligible`, (3) idempotency candidate key derived from proposal `actionId` with no prior successful execution audit, (4) domain guard `canExecuteSyncProduct` passes. Missing any gate MUST block execution with `noMutationExecuted: true`.

#### Scenario: All gates pass

- GIVEN approved proposal with readiness `eligible`, no prior success audit, and `canExecuteSyncProduct` returns true
- WHEN execution eligibility is evaluated
- THEN execution MAY proceed to create/update resolution

#### Scenario: Prior execution audit blocks duplicate

- GIVEN idempotency candidate key matches a prior successful execution audit
- WHEN eligibility is evaluated
- THEN execution MUST be blocked with reason `already-executed`

### Requirement: Create vs Update Resolution

The system MUST resolve target listing existence on the Maustian account via item lookup (SKU or stable identifier) before calling ML API. New listings (not found) SHALL use POST /items via `publishItem`. Existing listings SHALL use PUT /items/{id} via `updateItem`. Speculative or assumption-based switching MUST NOT occur.

#### Scenario: New listing resolved to POST

- GIVEN target listing is not found on Maustian
- WHEN execution resolves the mutation path
- THEN it MUST select POST /items via `publishItem`

#### Scenario: Existing listing resolved to PUT

- GIVEN target listing exists on Maustian with known itemId
- WHEN execution resolves the mutation path
- THEN it MUST select PUT /items/{id} via `updateItem`

### Requirement: Rollback/Recovery Model

The system MUST define compensating actions as recovery, not undo. Active items: pause via `changeItemStatus` (status=paused). Items needing removal: close via `changeItemStatus` (status=closed). Closed items needing restoration: republish via `relist` as new listing. Rollback path MUST be captured in audit before primary mutation.

#### Scenario: Recovery path captured pre-mutation

- GIVEN execution eligibility is confirmed
- WHEN audit pre-snapshot is recorded
- THEN the rollback path MUST be documented before the ML API call

### Requirement: Idempotency via Audit Records

The system MUST derive per-listing execution candidate keys from the proposal `actionId`. Before mutation, audit records MUST be checked for a prior successful execution matching the candidate key. A match MUST block the operation. Execution MUST NOT reach ML API until this check passes.

#### Scenario: Key derivation per listing

- GIVEN a `sync_product` proposal targets one listing
- WHEN the candidate key is derived
- THEN it MUST incorporate proposal `actionId` and target listing identity

### Requirement: Execution Audit Trail

The system MUST capture: pre-execution snapshot (proposal state, listing data, strategy summary), ML API call evidence (endpoint, payload summary, response itemId/permalink), post-execution status, and rollback path. Audit records MUST be written atomically with API outcome and MUST support future idempotency checks.

#### Scenario: Successful execution audited

- GIVEN a listing is published or updated successfully
- WHEN the ML API returns itemId and permalink
- THEN an audit record MUST capture pre-snapshot, API evidence, post-status, and rollback path

### Requirement: Package Boundary Contract

The execution contract MUST assign: `mercadolibre` owns ML API calls (MlClient.publishItem/updateItem/changeItemStatus), `tools` owns repository/audit persistence, `mcp` orchestrates (readiness → idempotency → resolve → ML API → audit), and `domain` owns the execution guard (`canExecuteSyncProduct` replacing generic `canExecutePreparedAction`).

#### Scenario: MCP orchestrates the flow

- GIVEN an eligible execution request
- WHEN the MCP execution tool processes it
- THEN it MUST sequence readiness → idempotency → resolve → API → audit per package boundaries

### Requirement: ProductSyncEngine Obsolescence

The system MUST treat `ProductSyncEngine` as obsolete for the approved execution path. Execution MUST use the orchestrated flow. The engine SHALL NOT be imported, instantiated, or called by execution tools.

#### Scenario: Execution path bypasses sync engine

- GIVEN an eligible proposal reaches execution
- WHEN the orchestrated flow processes it
- THEN `ProductSyncEngine` MUST NOT be invoked
