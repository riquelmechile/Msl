# Tasks: Medusa Runtime Approval Execution

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900-1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 domain/store evidence → PR 2 Medusa boundary/executor → PR 3 regressions/docs polish |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Durable domain/store contracts | PR 1 | Projection version, approval binding, idempotency/audit/rollback tests. |
| 2 | Runtime execution boundary | PR 2 | Executor plus Medusa boundary; depends on PR 1. |
| 3 | Safety regressions | PR 3 | LLM non-execution, blocked scenarios, final verification. |

## Phase 1: Domain and Persistence Foundation

- [x] 1.1 Update `packages/domain/src/ownedEcommerce.ts` with `projectionVersion`, execution request/result, gate reason, audit summary, and rollback contracts.
- [x] 1.2 Update `packages/domain/src/approval.ts` with exact owned ecommerce execution approval binding for action, projection ID/version, target, operation, approver, risk, rationale, and expiry.
- [x] 1.3 Update `packages/memory/src/ownedEcommerceStore.ts` schema for `projection_version`, execution, idempotency, audit, and rollback records.
- [x] 1.4 Add store methods in `packages/memory/src/ownedEcommerceStore.ts` to load exact projection revisions, reserve idempotency, persist redacted audit, and resolve rollback refs.

## Phase 2: Runtime Boundary and Executor

- [ ] 2.1 Extend `packages/ecommerce-medusa/src/index.ts` `MedusaWriteBoundary` with `publish()` and `activateCheckout()` plus fail-closed env/config defaults.
- [ ] 2.2 Create `packages/agent/src/runtime/ownedEcommerceExecutor.ts` to coordinate store reads, exact approval, readiness, claims, rollback, idempotency, audit, and write calls.
- [ ] 2.3 In `packages/agent/src/runtime/ownedEcommerceExecutor.ts`, block missing credentials, stale readiness, guardrail failures, approval mismatch, duplicate keys, and missing audit/rollback before writes.
- [ ] 2.4 Harden `packages/agent/src/conversation/ownedEcommerceTools.ts` so approval claims are ignored and `noMutationExecuted: true` remains enforced.

## Phase 3: Tests Mapped to Specs

- [ ] 3.1 Update `packages/domain/src/domain.test.ts` for exact approval pass, mismatch, expiry, and user-claim-not-proof scenarios.
- [ ] 3.2 Update `packages/memory/src/memory.test.ts` for projection-version persistence, durable audit/rollback evidence, and duplicate idempotency behavior.
- [ ] 3.3 Update `packages/ecommerce-medusa/src/index.test.ts` for missing credentials fail-closed and injected publish/checkout success paths.
- [ ] 3.4 Update `packages/agent/src/agent.test.ts` for approved backend execution, unsafe runtime blocked without boundary call, public-publish-without-checkout, checkout activation approved, and LLM tool cannot execute.

## Phase 4: Verification and Cleanup

- [ ] 4.1 Run `npm test` and fix only failures tied to the changed runtime approval behavior.
- [ ] 4.2 Run `npm run typecheck`, `npm run lint`, and `npm run format:check`; keep source changes within the selected PR work-unit boundary.
