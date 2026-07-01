# Proposal: Sync Product Execution Readiness

## Intent

Define a non-mutating readiness gate for already approved `sync_product` proposals so future execution cannot be inferred from approval alone. The gate returns `eligible`, `blocked`, or `degraded` with redacted reasons and `noMutationExecuted: true`.

## Scope

### In Scope
- Add readiness-only contract for exact approved, unexpired `sync_product` proposals.
- Revalidate approval binding, source evidence, preview drift, seller/account roles, idempotency candidate, rollback plan, audit semantics, rate/error behavior, and redaction.
- Preserve hard non-execution: no `ProductSyncEngine`, `sync_all`, mutation APIs, execution replay, or audit replay.

### Out of Scope
- Real MercadoLibre publish/update/status mutations.
- New execution tools, bulk sync, automatic execution, rollback automation, or audit records that imply execution.
- API-specific mutation claims until connected MercadoLibre MCP/API documentation evidence is available.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `custom-business-mcp-tools`: add readiness-only MCP behavior for approved `sync_product` proposals.
- `action-approval-safety`: clarify approval binding, readiness audit semantics, idempotency, and non-execution invariants.
- `ml-api-integration`: capture execution prerequisites without enabling mutation runtime behavior.

## Approach

Add delta specs for a readiness gate that authenticates, loads one exact approved `sync_product` proposal, re-runs read-only validation/preview checks, exposes stable idempotency candidate evidence for future execution, and returns sanitized readiness. Exact redacted reason codes: `approval-unavailable`, `approval-expired`, `approval-binding-mismatch`, `proposal-not-sync-product`, `source-read-failed`, `source-evidence-incomplete`, `preview-drift-detected`, `seller-scope-mismatch`, `target-account-unavailable`, `api-capability-evidence-missing`, `rollback-strategy-missing`, `rate-limited`, `upstream-temporary-failure`, `reconnect-required`, `storage-unavailable`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/custom-business-mcp-tools/spec.md` | Modified | Readiness tool contract and forbidden execution surface. |
| `openspec/specs/action-approval-safety/spec.md` | Modified | Approval binding, audit semantics, idempotency, rollback prerequisites. |
| `openspec/specs/ml-api-integration/spec.md` | Modified | API evidence prerequisite and no mutation claims. |
| `packages/mcp/src/index.ts` | Future | Readiness implementation boundary, without mutation imports/calls. |
| `packages/mcp/src/mcp.test.ts` | Future | Non-mutation and reason-code coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Approval mistaken for execution permission | Med | Block unless readiness is explicit and non-mutating. |
| Missing MercadoLibre mutation docs | High | Return `api-capability-evidence-missing`; require future API-source consultation. |
| Readiness drift hides changed proposal | Med | Block with `preview-drift-detected`. |

## Rollback Plan

Revert this OpenSpec change and any future readiness-only implementation/tests. Since the slice forbids mutations and returns `noMutationExecuted: true`, rollback does not require MercadoLibre compensation.

## Dependencies

- Existing durable proposal/approval storage and read-only item/preview dependencies.
- Future execution slice must consult connected MercadoLibre MCP/API documentation source when available.

## Success Criteria

- [ ] Specs define readiness statuses, exact reason codes, and `noMutationExecuted: true`.
- [ ] Specs forbid `ProductSyncEngine`, `sync_all`, mutation APIs, execution/audit replay.
- [ ] Tests can prove eligible, blocked, degraded, redaction, idempotency, rate/error, and no-mutation paths.
