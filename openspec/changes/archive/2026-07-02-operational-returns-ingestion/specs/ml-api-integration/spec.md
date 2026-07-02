# Delta for ml-api-integration

## ADDED Requirements

### Requirement: Capability Matrix — Return Safe Reads

Three return read entries SHALL be added to the MercadoLibre capability matrix. They MUST be classified as safe reads, use project-owned runtime surfaces only, and preserve explicit MLC uncertainty.

| Area | Classification | Endpoint | Site support | Runtime surface |
|------|----------------|----------|--------------|-----------------|
| Claim return detail | `safe-read` | `GET /post-purchase/v2/claims/{claim_id}/returns` | `MLC-to-confirm` | `read-tool` |
| Return reviews | `safe-read` | `GET /post-purchase/v1/returns/{return_id}/reviews` | `MLC-to-confirm` | `read-tool` |
| Claim return cost | `safe-read` | `GET /post-purchase/v1/claims/{claim_id}/charges/return-cost` | `MLC-to-confirm` | `read-tool` |

#### Scenario: Return safe reads are classified

- GIVEN return GET endpoints are added to the matrix
- WHEN runtime behavior is evaluated
- THEN each entry MUST declare `safe-read`, `MLC-to-confirm`, confidence metadata, and `read-tool`
- AND implementation MUST preserve `noMutationExecuted: true`

#### Scenario: Return reads degrade when unavailable

- GIVEN MLC support is unconfirmed or upstream returns unavailable, unauthorized, or not-found
- WHEN a return read is attempted
- THEN the integration MUST return controlled degraded metadata
- AND it MUST NOT infer execution support from documentation

### Requirement: Capability Matrix — Return Non-Executable Actions

Return-review POST, attachment upload, refund, dispute, and return action endpoints MUST be classified as non-executable for this slice. They SHALL NOT map to runtime tools, approvals, prepared actions, or direct API calls in `operational-returns-ingestion`.

| Area | Classification | Runtime surface |
|------|----------------|-----------------|
| Return-review POST | non-executable | None |
| Return attachments/upload | non-executable | None |
| Refund/dispute/return actions | non-executable | None |

#### Scenario: Mutation-like return endpoint is requested

- GIVEN a caller requests return-review POST, attachment upload, refund, dispute, or return action execution
- WHEN the capability matrix is consulted
- THEN the request MUST be blocked as non-executable in this slice
- AND no approval, prepared action, or ML mutation call MUST be created
