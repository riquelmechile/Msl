# Delta for action-approval-safety

## ADDED Requirements

### Requirement: Mutation Deferral for Capability Refresh

The system MUST treat seller-impacting MercadoLibre operations discovered during capability refresh as `prepare-only` or `future-execute-with-approval`. This change MUST NOT introduce default mutation execution, public messaging, listing edits, catalog fixes, promotions, or sync execution.

#### Scenario: Prepared action is required

- GIVEN capability evidence identifies a possible seller-impacting action
- WHEN the agent asks to perform that action
- THEN the system MUST produce a prepared action or defer to a future approved slice
- AND it MUST include intended change, rationale, risk, approval need, and audit expectation

#### Scenario: Execution is attempted in first slice

- GIVEN no approved execution slice exists for the capability
- WHEN execution is attempted from refreshed capability metadata
- THEN the system MUST block execution
- AND it MUST preserve existing approval, audit, and autonomy safeguards

## Post-Archive Review-Fix Addendum — 2026-06-28

This addendum records review fixes completed after the archive. It preserves the original delta above rather than rewriting the historical change.

### Requirement: Review Fixes Do Not Widen Execution

Post-archive readability and guardrail fixes MUST NOT introduce mutation execution, unknown-support reads, question answer tools, message reply tools, or mark-read tools.

#### Scenario: Guardrail fix changes runtime validation

- GIVEN a post-archive fix centralizes MLC validation or improves degraded responses
- WHEN the change is exposed through runtime or MCP tools
- THEN it MUST remain read-only and MLC-confirmed
- AND it MUST NOT add seller-impacting execution capability
