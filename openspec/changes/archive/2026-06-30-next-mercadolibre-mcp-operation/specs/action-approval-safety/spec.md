# Delta for Action Approval Safety

## ADDED Requirements

### Requirement: Non-Mutating Product Sync Proposal Retrieval

The approval safety boundary MUST allow authenticated, exact-ID, read-only retrieval of stored `sync_product` proposal status. Retrieval MUST preserve pending/no-execution semantics and MUST NOT record approval, execute actions, replay audits, mutate stored proposal state, persist new proposal data, or expand approval/execution APIs.

#### Scenario: Pending proposal is retrieved for review

- GIVEN a pending stored `sync_product` proposal exists and auth is valid
- WHEN its exact action ID is retrieved for status review
- THEN the response MUST report pending approval requirements and safe review metadata
- AND it MUST preserve the proposal as non-executed and approval-required

#### Scenario: Expired status is derived safely

- GIVEN a stored `sync_product` proposal expiry is in the past
- WHEN its exact action ID is retrieved
- THEN the response MUST indicate an expired-style status derived from stored timestamps
- AND it MUST NOT update approval status, write audit records, or mutate expiry fields

#### Scenario: Non-sync or missing action is requested

- GIVEN auth is valid
- WHEN retrieval targets a missing action, non-`sync_product` action, or unsupported stored proposal
- THEN the system MUST return a controlled redacted response
- AND it MUST NOT reveal sensitive record contents, credentials, storage paths, or action enumeration signals

#### Scenario: Retrieval cannot become execution

- GIVEN a stored `sync_product` proposal is available
- WHEN read-only retrieval is requested
- THEN the system MUST NOT call mutation APIs, `ProductSyncEngine`, approval recording, audit replay, `sync_all`, or multi-product sync behavior
- AND it MUST only return sanitized status derived from existing stored proposal data
