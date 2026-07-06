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

- [x] 2.1 Extend `packages/ecommerce-medusa/src/index.ts` `MedusaWriteBoundary` with `publish()` and `activateCheckout()` plus fail-closed env/config defaults.
- [x] 2.2 Create `packages/agent/src/runtime/ownedEcommerceExecutor.ts` to coordinate store reads, exact approval, readiness, claims, rollback, idempotency, audit, and write calls.
- [x] 2.3 In `packages/agent/src/runtime/ownedEcommerceExecutor.ts`, block missing credentials, stale readiness, guardrail failures, approval mismatch, duplicate keys, and missing audit/rollback before writes.
- [x] 2.4 Harden `packages/agent/src/conversation/ownedEcommerceTools.ts` so approval claims are ignored and `noMutationExecuted: true` remains enforced.

## Phase 3: Tests Mapped to Specs (PR 3 Broad Regression Matrix)

> **PR 3 review (2026-07-06)**: All Phase 3 scenarios (3.1–3.4) are already covered by the comprehensive tests added during PR 1 domain/store work and PR 2 runtime/boundary work. Each task is marked complete with a brief coverage note below.

- [x] 3.1 PR 3 broad matrix: `packages/domain/src/domain.test.ts` — exact approval binding pass, deterministic property-order target matching, projection ID/version/operation/risk/rationale mismatch, exact-boundary expiry, invalid-date expiry, and approval-without-binding (user-claim-not-proof) scenarios are all covered (61 tests).
- [x] 3.2 PR 3 broad matrix: `packages/memory/src/memory.test.ts` — projection-version persistence across revisions, immutable audit/rollback evidence with collision detection, duplicate idempotency reservation with context-mismatch rejection, and final evidence preservation across non-terminal retries are all covered (24 tests in memory.test.ts alone, plus 80 across domain+memory from PR 1).
- [x] 3.3 PR 3 broad matrix: `packages/ecommerce-medusa/src/index.test.ts` — missing credentials fail-closed, no-fake-success for configured-without-writer, injected publish/checkout success paths, publish-only boundary, and preview adapter fail-closed are all covered (7 tests).
- [x] 3.4 PR 3 broad matrix: `packages/agent/src/agent.test.ts` — approved backend publish and checkout execution, safe duplicate idempotency without second write, stale readiness / missing credentials / approval mismatch / missing rollback / missing audit blocking before write, public-publish-without-checkout, checkout activation approved, LLM prepare-only enforcement with ignored conversational claims, write-boundary rejection/throw, post-write persistence failure, store-read resilience, and redacted observability are all covered (68 tests).

## Phase 4: Verification and Cleanup

- [x] 4.1 Run `npm test` — 47 files / 1348 tests pass with zero failures.
- [x] 4.2 Run quality gates — `npm run typecheck` (clean), `npm run lint` (clean), `npm run format:check` (clean after Prettier fix on memory.test.ts).
