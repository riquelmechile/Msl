# Tasks: Sync Product Execution Contract

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~50 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | auto-chain |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Validate deltas + verify coverage + archive prep | PR 1 | Contract-only; no runtime code |

## Phase 1: Delta Spec Validation

- [x] 1.1 Validate `openspec/changes/sync-product-execution-contract/specs/ml-api-integration/spec.md` — check ADDED/MODIFIED sections, RFC 2119 keywords, Given/When/Then scenarios
- [x] 1.2 Validate `openspec/changes/sync-product-execution-contract/specs/action-approval-safety/spec.md` — verify MODIFIED blocks include full requirement text with preserved scenarios
- [x] 1.3 Validate `openspec/changes/sync-product-execution-contract/specs/custom-business-mcp-tools/spec.md` — confirm ADDED/MODIFIED sections, scenario coverage, redacted reason codes enum

## Phase 2: Contract Coverage Verification

- [x] 2.1 Cross-reference execution eligibility gates across all three delta specs and `openspec/specs/sync-product-execution/spec.md` — verify no gaps in gate model
- [x] 2.2 Verify create-vs-update semantics (POST/PUT) match design decisions in `design.md` and cap-matrix entries
- [x] 2.3 Verify rollback model: pause→close→relist compensating actions present in audit spec and readiness boundary
- [x] 2.4 Verify idempotency model consistency — `execution:{actionId}` key across action-approval-safety, ml-api-integration, and design
- [x] 2.5 Verify ProductSyncEngine obsolescence declared in all three delta specs and design
- [x] 2.6 Verify package boundary contract assigns mercadolibre/tools/mcp/domain correctly per design data flow (Section 4)

## Phase 3: Archive Preparation

- [x] 3.1 Verify delta specs are mergeable into main specs at `openspec/specs/ml-api-integration/`, `openspec/specs/action-approval-safety/`, `openspec/specs/custom-business-mcp-tools/`
- [x] 3.2 Confirm no destructive REMOVED deltas without `(Reason:)` and `(Migration:)` annotations
- [x] 3.3 Verify archive target `openspec/changes/archive/` exists and change folder is ready for relocation
