# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Non-Mutating ML Execution Readiness Evidence

The ML integration boundary MUST support readiness evidence for a future `sync_product` execution slice without enabling runtime mutations. Readiness MUST require API capability evidence, source item completeness, read-only dry-run/revalidation, seller/account safeguards, target availability, idempotency candidate, rollback plan, rate/error handling, and redaction; missing API mutation evidence MUST return `api-capability-evidence-missing`.

#### Scenario: API capability evidence is unavailable

- GIVEN connected MercadoLibre MCP/API documentation is unavailable or lacks mutation evidence for the target behavior
- WHEN readiness evaluates execution prerequisites
- THEN the result MUST be `blocked` or `degraded` with `api-capability-evidence-missing`
- AND it MUST NOT make API-specific mutation claims.

#### Scenario: Read-only API checks degrade safely

- GIVEN source reads, account checks, rate limits, upstream failures, reconnect needs, or storage dependencies are unavailable
- WHEN readiness validates prerequisites
- THEN the response MUST use `source-read-failed`, `source-evidence-incomplete`, `target-account-unavailable`, `rate-limited`, `upstream-temporary-failure`, `reconnect-required`, or `storage-unavailable`
- AND it MUST include `noMutationExecuted: true`.

#### Scenario: Mutation runtime remains forbidden

- GIVEN any readiness path runs
- WHEN ML integration code is selected
- THEN it MUST NOT call `publishItem`, `updateItem`, `changeItemStatus`, `ProductSyncEngine`, `sync_all`, execution replay, audit replay, rollback automation, or bulk sync
- AND future execution MUST consult connected MercadoLibre MCP/API documentation when available before claiming mutation capability.
