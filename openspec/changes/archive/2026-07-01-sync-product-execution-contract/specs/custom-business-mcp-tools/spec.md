# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Sync Product Execution Tool Contract

The MCP surface MUST define a future execution tool contract for approved `sync_product` proposals. The tool MUST sequence: readiness check → idempotency audit check → create/update resolution → ML API call → audit record. It MUST NOT execute bulk sync, call `ProductSyncEngine`, or bypass execution eligibility gates. The contract is specification-only until a future implementation slice adds runtime behavior.

#### Scenario: Execution tool contract defined

- GIVEN the MCP tool surface is evaluated
- WHEN the execution tool contract is referenced
- THEN it MUST declare the sequenced flow without implementing runtime mutations

## MODIFIED Requirements

### Requirement: Sync Product Execution Readiness Tool

The MCP surface MUST expose readiness-only evaluation for one exact approved, unexpired `sync_product` proposal and MUST return `status: "eligible" | "blocked" | "degraded"`, `noMutationExecuted: true`, stable idempotency candidate evidence when derivable, and redacted reason codes only: `approval-unavailable`, `approval-expired`, `approval-binding-mismatch`, `proposal-not-sync-product`, `source-read-failed`, `source-evidence-incomplete`, `preview-drift-detected`, `seller-scope-mismatch`, `target-account-unavailable`, `api-capability-evidence-missing`, `rollback-strategy-missing`, `rate-limited`, `upstream-temporary-failure`, `reconnect-required`, `storage-unavailable`. Readiness `eligible` MUST feed the execution eligibility gate defined in `sync-product-execution`.
(Previously: readiness was standalone; now `eligible` feeds execution eligibility contract.)

#### Scenario: Approved proposal is eligible

- GIVEN MCP auth is valid and an exact approved unexpired `sync_product` proposal passes read-only revalidation
- WHEN readiness is requested for that action ID
- THEN the response MUST be `eligible` with `noMutationExecuted: true`
- AND it MUST include only sanitized prerequisite evidence.

#### Scenario: Eligible status feeds execution contract

- GIVEN readiness returns `eligible` for an approved proposal
- WHEN the execution contract evaluates eligibility per `sync-product-execution`
- THEN `eligible` MUST be consumed as a required gate input

#### Scenario: Readiness cannot execute

- GIVEN any readiness request succeeds or fails
- WHEN the MCP operation completes
- THEN it MUST NOT call real MercadoLibre publish/update/status mutations, `ProductSyncEngine`, `sync_all`, execution replay, audit replay, rollback automation, or bulk sync
- AND it MUST always return `noMutationExecuted: true`.
