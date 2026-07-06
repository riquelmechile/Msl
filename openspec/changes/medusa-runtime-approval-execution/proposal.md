# Proposal: Medusa Runtime Approval Execution

## Intent

Move owned ecommerce from safe preview/preparation to controlled backend runtime execution without exposing mutations to LLM-facing CEO tools. Real Medusa writes must require backend-verified approval, fresh readiness, env-only credentials, auditability, idempotency, and rollback evidence.

## Scope

### In Scope
- Backend-only owned ecommerce runtime executor behind the existing Medusa write boundary.
- Exact approval binding to prepared action, projection, target, approver, risk, and expiry.
- Fail-closed gates for env credentials, public publish, checkout/payment activation, stale readiness, blocked projections, unsafe claims, idempotency, audit, and rollback trail.

### Out of Scope
- LLM/CEO tools executing Medusa mutations or receiving runtime credentials.
- Full live Medusa API depth for catalog/channel/payment synchronization; defer if needed to protect the 800-line review budget.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `owned-ecommerce-agent`: add backend-only runtime execution semantics for approved publish/checkout operations while preserving preview-only public and LLM paths.
- `action-approval-safety`: require exact approval binding, durable redacted audit, idempotency, and rollback evidence before owned ecommerce execution.

## Approach

Add a runtime executor service that loads credentials only from environment/config, fetches stored projection/action/approval records, revalidates readiness freshness and guardrails, then invokes an injected/live Medusa write boundary. `createOwnedEcommerceTools()` remains preparation-only and never accepts approval claims as execution proof.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/domain/src/ownedEcommerce.ts` | Modified | Execution result, gate, rollback, and audit contracts. |
| `packages/domain/src/approval.ts` | Modified | Exact approval binding reuse/extension. |
| `packages/memory/src/ownedEcommerceStore.ts` | Modified | Durable execution, idempotency, audit, rollback records. |
| `packages/ecommerce-medusa/src/index.ts` | Modified | Env-configured live/write boundary, fail-closed defaults. |
| `packages/agent/src/conversation/ownedEcommerceTools.ts` | Modified | Regression boundary: prepare only, no execution. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Approval evidence is too weak | Med | Require backend-verified channel metadata, exact binding, expiry. |
| Accidental public publish/payment activation | Med | Separate explicit gates; fail closed on missing config/readiness. |
| Review size exceeds budget | Med | Implement executor contract and fake boundary first; defer full API depth. |

## Rollback Plan

Disable runtime execution by removing env credentials or runtime registration; Medusa boundary remains fail-closed. Use audit/idempotency records and stored rollback trail to identify and reverse any executed publish/checkout action.

## Dependencies

- Merged PR #104 `owned-ecommerce-agent` preview/preparation seam.
- Existing specs: `owned-ecommerce-agent`, `action-approval-safety`.

## Success Criteria

- [ ] Backend execution succeeds only with exact approved fresh safe projection/action/target binding.
- [ ] Missing credentials, missing/expired approval, stale readiness, blocked projection, unsafe claim, duplicate idempotency key, or missing rollback/audit returns controlled blocked output.
- [ ] LLM-facing CEO tools still report `noMutationExecuted: true` and cannot execute.
