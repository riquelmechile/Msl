# Apply Progress: Add Deferred Message Bus Lifecycle

## Status

- Mode: Standard (`strict_tdd=false`)
- Delivery: auto-chain, stacked-to-main
- Completed: 12/12 tasks (`1.1`-`4.4`)
- Current boundary: PR 4 / Work Unit 4, settle/query CAS, audit, remaining races, and rollback drain/restart evidence
- Remaining: None; ready for `sdd-verify`

## Work Unit 1 Evidence

| Evidence | Result |
|---|---|
| Focused tests | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` -> exit 0; 1 file passed; 44/44 tests passed; `rg -o 'expect\(' packages/agent/tests/conversation/agentMessageBusStore.test.ts \| wc -l` -> 132 static expectation sites |
| Runtime harness | Same focused command exercised in-memory SQLite fresh enabled, fresh legacy-flag, v2-to-v3, rerun, injected ownership-proof rollback, and unrelated recorded-v3 scenarios; all 6 migration cases passed |
| Typecheck | `npm run typecheck --workspace @msl/agent` -> exit 0 |
| Formatting | `npx prettier --check packages/agent/src/conversation/agentMessageBusStore.ts packages/agent/tests/conversation/agentMessageBusStore.test.ts packages/agent/src/index.ts packages/agent/src/conversation/tools/productLaunchTools.test.ts packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.test.ts packages/agent/src/sessions/AgentWorkSessionRunner.test.ts packages/agent/src/workers/daemonScheduler-sessions.test.ts packages/agent/src/workers/productLaunchCoordinator.test.ts tests/integration/product-launch-pipeline.test.ts` -> exit 0; all matched files use Prettier style |
| Churn | `git diff --numstat` -> 362 additions + 4 deletions = 366 total tracked churn; below 400 |
| Migration rollback | Malformed pre-existing audit schema makes post-apply ownership proof fail; v3 transaction rolls back all ten bus additions and leaves version 3 absent, with the v2 bus at 23 columns |
| Work-unit rollback | Revert the nine tracked files below to remove v3/types/barrel/mocks/tests; unchanged v2 behavior and existing data remain. Deployed databases are not downgraded or dropped. |

## Work Unit 2 Evidence

| Evidence | Result |
|---|---|
| Focused tests | `npx vitest run packages/agent/tests/conversation/jcsCanonicalize.test.ts` -> exit 0; 1 file passed; 13/13 tests passed; 16 assertion evaluations from 11 static `expect(` sites |
| Golden/runtime harness | `npx tsx -e 'import { readFileSync } from "node:fs"; import { computeDeferralDigest, computeSettlementDigest, jcsCanonicalize } from "./packages/agent/src/index.ts"; const vectors=JSON.parse(readFileSync("packages/agent/tests/conversation/fixtures/deferral-digest-vectors.json","utf8")); let checked=0; for (const vector of vectors.canonical) { if (jcsCanonicalize(vector.input)!==vector.canonical) throw new Error(vector.name); checked++; } for (const vector of vectors.deferrals) { if (computeDeferralDigest(vector.messageId,vector.options)!==vector.digest) throw new Error(vector.name); checked++; } for (const vector of vectors.settlements) { if (computeSettlementDigest(vector.messageId,vector.outcome,vector.options)!==vector.digest) throw new Error(vector.outcome); checked++; } console.log(`golden vectors checked: ${checked}`);'` -> exit 0; 6 pinned vectors checked through public barrel exports |
| Relevant regression | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` -> exit 0; 1 file passed; 44/44 tests passed |
| Lint | `npm run lint` -> exit 0 |
| Typecheck | `npm run typecheck` -> exit 0; root project references and `@msl/web` passed |
| Formatting | `npx prettier --check packages/agent/src/conversation/jcsCanonicalize.ts packages/agent/tests/conversation/jcsCanonicalize.test.ts packages/agent/tests/conversation/fixtures/deferral-digest-vectors.json packages/agent/src/index.ts` -> exit 0; all matched files use Prettier style |
| Churn | 324 additions + 6 deletions = 330 total tracked/untracked PR2 churn; below 400 |
| Work-unit rollback | Remove `jcsCanonicalize.ts`, its focused test and pinned vector fixture, and revert only the three digest exports in `packages/agent/src/index.ts`; PR1 schema/API behavior remains. |

## Work Unit 3 Evidence

| Evidence | Result |
|---|---|
| Focused tests/runtime harness | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts -t "defer and resumeDeferred"` -> exit 0; 1 file passed; 6/6 Slice 3 tests passed (44 unrelated tests skipped). In-memory SQLite exercised CAS transitions/classifications, exact row mapping, claim exclusion, seller/system scopes, audit atomicity, duplicate rollback, fresh-operation retries, and both defer/fail orderings. |
| Assertion evidence | `rg -o 'expect\(' packages/agent/tests/conversation/agentMessageBusStore.test.ts \| wc -l` -> 164 static expectation sites; focused execution ran six tests with nonzero assertions. |
| Prior-slice regression | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts packages/agent/tests/conversation/jcsCanonicalize.test.ts` -> exit 0; 2 files passed; 63/63 tests passed (50 store + 13 JCS). |
| Lint | `npm run lint` -> exit 0. |
| Typecheck | `npm run typecheck` -> exit 0; root project references and `@msl/web` passed. |
| Formatting | `npx prettier --check packages/agent/src/conversation/agentMessageBusStore.ts packages/agent/tests/conversation/agentMessageBusStore.test.ts openspec/changes/add-deferred-message-bus-lifecycle/tasks.md openspec/changes/add-deferred-message-bus-lifecycle/apply-progress.md` -> exit 0; all matched files use Prettier style. |
| Diff check | `git diff --check` — exit 0, no output. |
| Churn | `git diff --numstat` -> 320 additions + 8 deletions = 328 total tracked PR3 churn; below 400. |
| Work-unit rollback | Before runtime use, revert the defer/resume statements, transaction/classification/audit implementation, Slice 3 tests, and these task/progress updates; PR1 v3 schema/API and PR2 JCS/digests remain. After deferred rows exist, source-only rollback is unsafe; the PR4 drain boundary remains required and out of PR3 scope. |

## Work Unit 4 Evidence

| Evidence | Result |
|---|---|
| RED/focused tests | Initial `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts -t "settle and getExpiredDeferrals"` -> exit 1; 4/4 assigned tests failed at runtime stubs. Final command -> exit 0; 1 file passed; 4/4 passed, 50 skipped; 38 assertion evaluations executed. |
| Runtime harness | Same focused command exercised three settlement outcomes, triple retry/conflicts, resume/settle and settle/settle races, fixed-clock seller/system snapshots, equal-key keyset paging, indefinite exclusion, exact audit JSON/SQL NULL, duplicate rollback, and file-backed WAL drain/restart. |
| Regression | `npm test` -> exit 0; 218 files passed, 2 skipped; 3,866 tests passed, 7 skipped. |
| Quality | `npm run lint` -> exit 0 on the 300s retry (the first 120s tool run timed out); `npm run typecheck` -> exit 0. |
| Formatting/diff | `npx prettier --check packages/agent/src/conversation/agentMessageBusStore.ts packages/agent/tests/conversation/agentMessageBusStore.test.ts openspec/changes/add-deferred-message-bus-lifecycle/tasks.md openspec/changes/add-deferred-message-bus-lifecycle/apply-progress.md` and `git diff --check` -> exit 0. |
| Churn | Final `git diff --numstat` -> 359 additions + 15 deletions = 374 total PR4 churn; below 400. |
| Work-unit rollback | Quiesce producers; settle every deferred row through the public API with unique system operation IDs; preserve attempts; abort restart unless `COUNT(status='deferred')=0`; restart only after zero. Never direct-SQL drain, DROP v3 schema, or treat source revert as DB rollback. Revert only PR4 store/tests/task/progress changes after the drain; PR1-PR3 remain. |

## Files

- `packages/agent/src/conversation/agentMessageBusStore.ts`
- `packages/agent/tests/conversation/agentMessageBusStore.test.ts`
- `packages/agent/src/index.ts`
- `packages/agent/src/conversation/tools/productLaunchTools.test.ts`
- `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.test.ts`
- `packages/agent/src/sessions/AgentWorkSessionRunner.test.ts`
- `packages/agent/src/workers/daemonScheduler-sessions.test.ts`
- `packages/agent/src/workers/productLaunchCoordinator.test.ts`
- `tests/integration/product-launch-pipeline.test.ts`

### Work Unit 2 Files

- `packages/agent/src/conversation/jcsCanonicalize.ts`
- `packages/agent/tests/conversation/jcsCanonicalize.test.ts`
- `packages/agent/tests/conversation/fixtures/deferral-digest-vectors.json`
- `packages/agent/src/index.ts`

### Work Unit 3 Files

- `packages/agent/src/conversation/agentMessageBusStore.ts`
- `packages/agent/tests/conversation/agentMessageBusStore.test.ts`
- `openspec/changes/add-deferred-message-bus-lifecycle/tasks.md`
- `openspec/changes/add-deferred-message-bus-lifecycle/apply-progress.md`

## Deviations

- Added the `productLaunchTools.test.ts` structural mock discovered by the required agent typecheck; it is the same PR1 public-interface compatibility work as the five forecast fixtures.
- New deferred fields on the existing exported `AgentMessage` type are optional for source compatibility with existing consumers; rows returned by the SQLite store always map all ten fields to values or `null`.
- PR1 intentionally left settle/query unavailable after pre-transaction validation; PR4 replaces those stubs with the specified runtime behavior.
- PR2 has no design deviations. It adds only canonicalization, digest construction, pinned vectors, tests, and barrel exports; lifecycle runtime methods remain assigned to PR3/PR4.
- PR3 has no design deviations. It leaves settle/query runtime behavior, PR4 races, and rollback drain untouched.
- PR4 has no design deviations; no Creative Studio artifacts were modified.
