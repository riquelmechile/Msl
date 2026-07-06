# Apply Progress: Medusa Runtime Approval Execution

## Mode

Standard Mode. Strict TDD is not active in `openspec/config.yaml` (`strict_tdd: false`, `rules.apply.tdd: false`). Targeted tests were added with the PR 1 domain/store boundary.

## Workload / PR Boundary

- Delivery strategy: chained PR slice.
- Chain strategy: stacked-to-main.
- Current work unit: PR 1 / Durable domain/store contracts.
- Target branch: `main` for PR 1.
- Scope boundary: domain contracts, SQLite store schema/methods, and directly necessary domain/store tests only. Runtime executor and Medusa write boundary remain out of scope for later PRs.

## Completed Tasks

- [x] 1.1 Updated `packages/domain/src/ownedEcommerce.ts` with `projectionVersion`, execution request/result, gate reason, audit summary, and rollback contracts.
- [x] 1.2 Updated `packages/domain/src/approval.ts` with exact owned ecommerce execution approval binding for action, projection ID/version, target, operation, approver, risk, rationale, and expiry.
- [x] 1.3 Updated `packages/memory/src/ownedEcommerceStore.ts` schema for `projection_version`, execution, idempotency, audit, and rollback records.
- [x] 1.4 Added store methods in `packages/memory/src/ownedEcommerceStore.ts` to load exact projection revisions, reserve idempotency, persist redacted audit, and resolve rollback refs.

## Evidence

| Area | Evidence |
|------|----------|
| Domain approval binding | `packages/domain/src/domain.test.ts` covers exact binding success, projection revision mismatch, and expired approval binding. |
| Projection revisions | `packages/memory/src/memory.test.ts` covers exact revision lookup and missing revision behavior. |
| Idempotency/audit/rollback | `packages/memory/src/memory.test.ts` covers durable idempotency reservation/duplicate behavior, final idempotency result preservation after later non-terminal writes, redacted audit persistence, execution record storage, rollback ref resolution, rollback evidence immutability, and fail-closed execution when rollback evidence is missing. |

These direct PR 1 tests intentionally cover the domain/store portions needed to prove the durable evidence slice. They are support coverage for tasks 1.1-1.4, not completion of the broader Phase 3 checklist: tasks 3.1 and 3.2 remain unchecked until PR 3 adds the full regression matrix across the finished runtime executor, write boundary, and agent flows.

## PR 1 Pre-PR Review Fixes

- Fixed immutable projection revision storage: `upsertProjection()` now treats `(projectionId, projectionVersion)` as append-only. Repeated identical writes are idempotent; differing content for the same revision rejects fail-closed.
- Fixed durable audit/rollback immutability: `recordExecutionAudit()` and `recordRollbackRef()` now allow identical duplicate evidence only and reject differing evidence on ID/ref collision.
- Fixed idempotency completion evidence: `recordExecution()` now updates the reserved idempotency row with final status, audit ID, and result JSON so duplicate idempotency can return final safe evidence after execution.
- Fixed property-order-sensitive approval target comparison: owned ecommerce target matching is now deterministic by target type and fields rather than `JSON.stringify()`.
- Strengthened domain test evidence: approval-binding tests now split exact authorization from deterministic target matching and explicitly assert mismatches for projection ID/version, target, operation, risk, rationale, and expiry.
- Reduced type drift safely within PR 1: `OwnedEcommercePreparedAction.target` now aliases `OwnedEcommerceExecutionTarget`.

## PR 1 Targeted Re-Review Fixes

- Fixed final idempotency evidence preservation: `recordExecution()` now leaves an existing final idempotency result/audit intact when a later retry writes a non-terminal or null-result execution for the same idempotency key.
- Fixed rollback evidence enforcement: `recordExecution()` now rejects executed evidence whose rollback reference is absent from `owned_ecommerce_rollback_refs` or belongs to a different projection version/operation.
- Fixed result-optional executed evidence handling: `recordExecution()` now treats `status: "executed"` plus audit/rollback evidence as terminal idempotency evidence even when `result` is omitted, and preserves that final evidence across later non-terminal/null-result writes.
- Strengthened rollback/idempotency tests: `packages/memory/src/memory.test.ts` now proves final duplicate evidence survives a later `started` write and that missing rollback evidence fails closed before execution evidence is accepted.
- Strengthened exact binding tests: `packages/domain/src/domain.test.ts` now explicitly covers mismatched `ownedEcommerceBinding.actionId`.
- Clarified this progress artifact so PR 1 evidence, support-only fixture updates, and remaining PR 2/PR 3 tasks are unambiguous.

### Fix Verification

- ✅ `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts` — 2 files / 80 tests passed.
- ✅ `npm run typecheck`.
- ✅ `npx eslint "packages/domain/src/approval.ts" "packages/domain/src/ownedEcommerce.ts" "packages/domain/src/domain.test.ts" "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `npx prettier --check "packages/domain/src/approval.ts" "packages/domain/src/ownedEcommerce.ts" "packages/domain/src/domain.test.ts" "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts" "openspec/changes/medusa-runtime-approval-execution/apply-progress.md"`.

### Targeted Re-Review Fix Verification

- ✅ `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts` — 2 files / 80 tests passed.
- ✅ `./node_modules/.bin/eslint "packages/domain/src/domain.test.ts" "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/domain/src/domain.test.ts" "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts" "openspec/changes/medusa-runtime-approval-execution/apply-progress.md"`.

### Final PR 1 Re-Review Fix Verification

- ✅ `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts` — 2 files / 80 tests passed.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts" "openspec/changes/medusa-runtime-approval-execution/apply-progress.md"`.

### Final PR 1 Audit Evidence Fix Verification

- Fixed audit evidence enforcement: `recordExecution()` now requires executed evidence to reference an existing `owned_ecommerce_execution_audits` row whose projection ID/version, action ID, approval ID, and operation match the execution request before persisting execution or idempotency evidence.
- Strengthened audit/idempotency tests: `packages/memory/src/memory.test.ts` now proves executed evidence fails closed when the audit row is missing or belongs to a different operation.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

### Final PR 1 Idempotency Reservation Evidence Fix Verification

- Fixed final idempotency reservation evidence enforcement: `reserveExecutionIdempotency()` now validates executed reservation audit/rollback evidence against the same persisted audit and rollback tables used by `recordExecution()` before inserting final idempotency evidence.
- Prevented poisoned final reservations: rejected executed reservations are not inserted, so the same idempotency key can later be reserved with valid matching evidence.
- Strengthened idempotency reservation tests: `packages/memory/src/memory.test.ts` now proves missing/mismatched audit rows and missing/mismatched rollback refs fail closed for executed idempotency reservations.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

### Final PR 1 Critical Re-Review Fix Verification

- Fixed executed record/result consistency: `recordExecution()` now rejects `status: "executed"` records whose result is non-executed and still requires complete audit/rollback evidence before persisting execution or idempotency state.
- Fixed invalid approval expiry handling: `canExecuteOwnedEcommerceAction()` now treats invalid owned ecommerce binding expiry dates as expired and fails closed.
- Strengthened regression tests: `packages/memory/src/memory.test.ts` covers executed records with blocked/duplicate results, and `packages/domain/src/domain.test.ts` covers invalid approval expiry dates.
- ✅ `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts` — 2 files / 80 tests passed.
- ✅ `./node_modules/.bin/eslint "packages/domain/src/approval.ts" "packages/domain/src/domain.test.ts" "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/domain/src/approval.ts" "packages/domain/src/domain.test.ts" "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts" "openspec/changes/medusa-runtime-approval-execution/apply-progress.md"`.

### Final PR 1 Review Finding Fix Verification

- Fixed invalid gate reason fixture: `packages/memory/src/memory.test.ts` now uses the public `"missing-audit-storage"` reason code instead of the invalid `"missing-audit"` string.
- Fixed execution/idempotency reservation ordering: `recordExecution()` now fails closed before persisting execution rows unless a matching `owned_ecommerce_execution_idempotency` reservation already exists.
- Strengthened regression tests: `packages/memory/src/memory.test.ts` proves recording execution without a prior reservation rejects and leaves no execution row behind.
- ✅ `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts` — 2 files / 80 tests passed.
- ✅ `npm run typecheck`.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

### Latest Final PR 1 Critical Review Fix Verification

- Fixed bidirectional execution status/result consistency: `recordExecution()` now rejects non-executed record statuses (`started`, `failed`, `blocked`, `duplicate`) carrying an executed result, so idempotency cannot be finalized as executed from an inconsistent record.
- Fixed audit summary semantic enforcement: executed execution/idempotency evidence now requires the referenced audit summary to be `status: "executed"` and to carry the same `rollbackRef` as the executed result/evidence.
- Strengthened regression tests: `packages/memory/src/memory.test.ts` covers all non-executed record statuses with executed results, non-executed audit summaries, and rollback-inconsistent audit summaries for both execution records and final idempotency reservations.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `npm run typecheck`.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts" "openspec/changes/medusa-runtime-approval-execution/apply-progress.md"`.

### Latest Two PR 1 Critical Finding Fix Verification

- Fixed non-executed execution status/result divergence: `executionResultForIdempotency()` now rejects any present `record.result` whose `status` does not exactly match `record.status`, including non-executed mismatches such as `failed` with `blocked` or `blocked` with `duplicate`.
- Fixed duplicate idempotency reservation context mismatch: `reserveExecutionIdempotency()` now validates an existing idempotency row against the incoming projection ID/version, action ID, approval ID, and operation before returning duplicate evidence; mismatches fail closed with a controlled reservation mismatch error.
- Strengthened regression tests: `packages/memory/src/memory.test.ts` covers mismatched non-executed record/result pairs and duplicate idempotency reservations reused with different projection version, action, approval, or operation context.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `npm run typecheck`.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

### Latest PR 1 Resilience Critical Fix Verification

- Fixed final idempotency mutation ordering: `recordExecution()` now returns before any `owned_ecommerce_executions` insert/update when the matching idempotency reservation is already final.
- Strengthened regression coverage: `packages/memory/src/memory.test.ts` now proves a later contradictory blocked record does not overwrite the existing executed history and does not insert a new execution row after final idempotency.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `npm run typecheck`.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

### Latest PR 1 Duplicate Return Critical Fix Verification

- Fixed final idempotency duplicate return safety: `recordExecution()` now returns the stored final execution evidence, or final idempotency evidence when no execution row exists, instead of resolving with a caller-supplied contradictory record after the idempotency key is already final.
- Strengthened regression coverage: `packages/memory/src/memory.test.ts` now proves later `started` or `blocked` duplicate calls for a final idempotency key resolve with the existing executed status/evidence and still do not create contradictory execution rows.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `npm run typecheck`.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

### Latest PR 1 Execution ID Collision Critical Fix Verification

- Fixed execution ID collision safety: `recordExecution()` now checks an existing `owned_ecommerce_executions.id` row against the incoming idempotency key, projection ID/version, action ID, approval ID, and operation before any execution or idempotency update; mismatches fail closed.
- Strengthened regression coverage: `packages/memory/src/memory.test.ts` now proves a reused execution ID with a different valid reservation rejects, preserves the original execution evidence, and leaves the new idempotency reservation unfinalized.
- ✅ `npm test -- packages/memory/src/memory.test.ts` — 1 file / 22 tests passed.
- ✅ `npm run typecheck`.
- ✅ `./node_modules/.bin/eslint "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.
- ✅ `./node_modules/.bin/prettier --check "packages/memory/src/ownedEcommerceStore.ts" "packages/memory/src/memory.test.ts"`.

## Verification

- ✅ `npm test -- packages/domain/src/domain.test.ts packages/memory/src/memory.test.ts`
- ✅ `npm run typecheck`
- ✅ `npm run lint`
- ✅ `npm run format:check`

## Deviations

None — implementation matches the PR 1 design boundary. The following compile-only fixture/support updates outside the main PR 1 files were necessary because `StorefrontProjection.projectionVersion` is now a required domain contract; they do not implement the PR 2 runtime executor or Medusa write boundary:

- `packages/workers/src/ownedEcommerce/index.ts` now emits deterministic projection versions for generated projections.
- `packages/ecommerce-medusa/src/index.test.ts` and `packages/agent/src/agent.test.ts` test fixtures now include projection versions.

## Remaining Tasks

The remaining Phase 3 checkboxes are intentionally still open. PR 1 already added direct `packages/domain/src/domain.test.ts` and `packages/memory/src/memory.test.ts` coverage for the domain/store behaviors that support tasks 3.1 and 3.2, but the formal Phase 3 work remains PR 3 scope for broader end-to-end regression coverage after PR 2 implements the runtime executor and Medusa write boundary.

- [ ] 2.1 Extend `packages/ecommerce-medusa/src/index.ts` `MedusaWriteBoundary` with `publish()` and `activateCheckout()` plus fail-closed env/config defaults.
- [ ] 2.2 Create `packages/agent/src/runtime/ownedEcommerceExecutor.ts` to coordinate store reads, exact approval, readiness, claims, rollback, idempotency, audit, and write calls.
- [ ] 2.3 In `packages/agent/src/runtime/ownedEcommerceExecutor.ts`, block missing credentials, stale readiness, guardrail failures, approval mismatch, duplicate keys, and missing audit/rollback before writes.
- [ ] 2.4 Harden `packages/agent/src/conversation/ownedEcommerceTools.ts` so approval claims are ignored and `noMutationExecuted: true` remains enforced.
- [ ] 3.1 Update `packages/domain/src/domain.test.ts` for exact approval pass, mismatch, expiry, and user-claim-not-proof scenarios.
- [ ] 3.2 Update `packages/memory/src/memory.test.ts` for projection-version persistence, durable audit/rollback evidence, and duplicate idempotency behavior.
- [ ] 3.3 Update `packages/ecommerce-medusa/src/index.test.ts` for missing credentials fail-closed and injected publish/checkout success paths.
- [ ] 3.4 Update `packages/agent/src/agent.test.ts` for approved backend execution, unsafe runtime blocked without boundary call, public-publish-without-checkout, checkout activation approved, and LLM tool cannot execute.
- [ ] 4.1 Run full `npm test` and fix only failures tied to the changed runtime approval behavior.
- [ ] 4.2 Run full quality gates for the final chained slice.
