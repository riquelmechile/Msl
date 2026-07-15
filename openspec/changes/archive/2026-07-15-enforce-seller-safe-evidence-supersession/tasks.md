# Tasks: Enforce Seller-Safe Evidence Supersession

## Review Workload Forecast

| Field | Value |
|---|---|
| Measured current OpenSpec change | 5 untracked files / 354 reviewable lines |
| Estimated total change | 464–524 lines / 8 files; 9 files if a caller/mock changes |
| 400-line budget risk | High |
| Chained PRs authorized | Yes — two sequential-to-main PRs |
| Suggested split | PR 1: existing OpenSpec artifacts; PR 2: this change's store/tests only |
| Delivery strategy | sequential-to-main |
| Chain strategy | Merge PR 1 after green CI, then create PR 2 from updated `origin/main` in a new branch and new worktree |

Decision needed before apply: No — completed
Chained PRs authorized: Yes — two sequential-to-main PRs
Chain strategy: PR 1 merge → fresh `origin/main` branch/worktree → Draft PR 2
400-line budget risk: High

**Status: APPROVED.** The user explicitly authorized two sequential-to-main PRs. PR 1 contains only the five OpenSpec planning artifacts and may be merged only after green CI. After that merge, fetch updated `origin/main` and create a new branch and new worktree from it for PR 2. PR 2 contains only seller-safe implementation/tests, remains Draft after green CI, and must not be marked Ready or merged. Do not use cumulative branches, rebase, force push, a size exception, or implementation in PR 1. Each PR must remain under 400 reviewable lines; implementation remains capped at 8 files and is expected to use far fewer after the planning artifacts merge.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Preserve the 5 current OpenSpec artifacts (354 lines) | PR 1, base main | N/A — planning artifacts only | N/A — no runtime behavior | `openspec/changes/enforce-seller-safe-evidence-supersession/` artifacts |
| 2 | Seller-safe store mutation and all SQLite proofs | Draft PR 2, new branch/worktree from updated `origin/main` after PR 1 merges | `npm test -- packages/memory/src/economicEvidenceStore.test.ts packages/memory/tests/economicRunProvenanceStore.test.ts` | Temporary SQLite WAL file; concurrent Plasticov/Maustian workers | Three memory files, plus only compiler-required caller/mock if proven; 8 implementation files maximum |

## Phase 1: Gate

- [x] 1.1 User authorized two sequential-to-main PRs under the 400-reviewable-line limit per PR.
- [x] 1.2 Limit PR 1 to the five OpenSpec planning artifacts; include no implementation and merge only after green CI.
- [x] 1.3 After PR 1 merges, fetch updated `origin/main` and create a new branch and new worktree from it for PR 2; do not use a cumulative branch, rebase, or force push.
- [x] 1.4 Limit PR 2 to seller-safe implementation/tests with at most 8 implementation files; keep it Draft after green CI and do not mark it Ready or merge it.
- [x] 1.5 Do not use a size exception; implementation is expected to require far fewer files after the planning artifacts merge.

## Phase 2: PR 2 — RED SQLite Proofs

- [x] 2.1 In `packages/memory/src/economicEvidenceStore.test.ts`, write RED cases for Plasticov and Maustian valid links; both foreign-target directions; both foreign-successor directions; missing target; missing successor.
- [x] 2.2 Add RED cases for malformed seller, malformed/runtime-missing IDs, unchanged supersession plus source-health/checkpoint/run/lease/fence/epoch state, and non-disclosing void/errors/logs.
- [x] 2.3 Add RED cases for repeated valid calls and seller-scoped read isolation in `packages/memory/src/economicEvidenceStore.test.ts`.
- [x] 2.4 In `packages/memory/tests/economicRunProvenanceStore.test.ts`, add the RED temporary-WAL two-worker case proving concurrent Plasticov/Maustian links remain isolated.

## Phase 3: PR 2 — Atomic Boundary and Verification

- [x] 3.1 In `packages/memory/src/economicEvidenceStore.ts`, change `markSuperseded` to `(sellerId, evidenceId, supersedingEvidenceId): void`; update only compiler-required local callers/mocks.
- [x] 3.2 Add the non-empty/non-whitespace/no-NUL guard and one seller-scoped conditional `UPDATE ... EXISTS`; bind five values and ignore `.run()` output.
- [x] 3.3 Run focused Vitest and `npm run typecheck`; validate the WAL harness and inspect that no migration, external call, other R6–R8 work, or unrelated file entered PR 2.
