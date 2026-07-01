# Delta for custom-business-mcp-tools

## ADDED Requirements

### Requirement: Sync Product Execution Readiness Tool

The MCP surface MUST expose readiness-only evaluation for one exact approved, unexpired `sync_product` proposal and MUST return `status: "eligible" | "blocked" | "degraded"`, `noMutationExecuted: true`, stable idempotency candidate evidence when derivable, and redacted reason codes only: `approval-unavailable`, `approval-expired`, `approval-binding-mismatch`, `proposal-not-sync-product`, `source-read-failed`, `source-evidence-incomplete`, `preview-drift-detected`, `seller-scope-mismatch`, `target-account-unavailable`, `api-capability-evidence-missing`, `rollback-strategy-missing`, `rate-limited`, `upstream-temporary-failure`, `reconnect-required`, `storage-unavailable`.

#### Scenario: Approved proposal is eligible

- GIVEN MCP auth is valid and an exact approved unexpired `sync_product` proposal passes read-only revalidation
- WHEN readiness is requested for that action ID
- THEN the response MUST be `eligible` with `noMutationExecuted: true`
- AND it MUST include only sanitized prerequisite evidence.

#### Scenario: Proposal is blocked or degraded

- GIVEN approval, proposal type, preview, seller/account, API evidence, rollback, rate, upstream, reconnect, or storage checks fail
- WHEN readiness is requested
- THEN the response MUST be `blocked` or `degraded` with one or more allowed reason codes
- AND it MUST NOT expose raw storage, credential, validation, or upstream details.

#### Scenario: Readiness cannot execute

- GIVEN any readiness request succeeds or fails
- WHEN the MCP operation completes
- THEN it MUST NOT call real MercadoLibre publish/update/status mutations, `ProductSyncEngine`, `sync_all`, execution replay, audit replay, rollback automation, or bulk sync
- AND it MUST always return `noMutationExecuted: true`.
