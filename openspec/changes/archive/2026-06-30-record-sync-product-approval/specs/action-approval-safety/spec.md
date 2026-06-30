# Delta for Action Approval Safety

## ADDED Requirements

### Requirement: Record-Only Product Sync Approval

The approval safety boundary MUST allow recording seller approval for an exact stored pending unexpired `sync_product` proposal without executing it. Approval recording MUST validate the stored proposal as sync-only before writing, MUST preserve future execution invariants, and MUST create an approval record that proves consent without claiming completion.

#### Scenario: Seller approval is recorded without execution

- GIVEN an authenticated exact stored pending unexpired `sync_product` proposal exists
- WHEN seller approval is recorded
- THEN the proposal MUST become approved for future execution eligibility only
- AND an approval record MUST capture action ID, approver, timestamp, rationale/risk linkage, and non-executed status

#### Scenario: Non-sync approval is blocked

- GIVEN authentication is valid
- WHEN approval recording targets a missing, malformed, expired, finalized, or non-`sync_product` proposal
- THEN the system MUST return a redacted controlled failure
- AND it MUST NOT write proposal state, approval records, audit records, or enumeration details

#### Scenario: Future execution invariants are preserved

- GIVEN approval has been recorded for a `sync_product` proposal
- WHEN later behavior evaluates the proposal for execution eligibility
- THEN the stored approval MUST be distinguishable from execution, audit replay, and sync completion
- AND it MUST retain approval-required metadata needed by a future approved execution slice

#### Scenario: Approval recording remains non-mutating

- GIVEN approval recording succeeds or fails
- WHEN the operation completes
- THEN it MUST NOT mutate MercadoLibre state, call `ProductSyncEngine`, run `sync_all`, perform multi-product sync, replay audits, or trigger rollback automation
- AND it MUST NOT persist OAuth tokens, API keys, client secrets, raw credentials, database paths, or raw validation errors
