# Spec Phase Note: Converge MLC Read Snapshots

No delta specs are created for this change.

## Rationale

The proposal explicitly declares:

- New Capabilities: None
- Modified Capabilities: None

This change is a behavior-neutral refactor/architecture cleanup. Existing source-of-truth requirements for `business-memory-cache`, `custom-business-mcp-tools`, and `mercadolibre-account-integration` remain unchanged.

## Verification Expectation

Implementation should be verified through focused tests, typecheck/build correctness, and design coherence:

- MLC-specific snapshot export names remain source-compatible.
- Snapshot shape and freshness vocabulary derive from canonical domain contracts.
- Read-tool runtime behavior, access checks, approval rules, and API transport behavior remain unchanged.
- The one-way dependency direction is preserved: `@msl/mercadolibre` may depend on `@msl/domain`; `@msl/domain` must not depend on `@msl/mercadolibre`.
