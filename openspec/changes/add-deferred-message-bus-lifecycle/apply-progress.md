# Apply Progress: Add Deferred Message Bus Lifecycle

## Status

- Mode: Standard (`strict_tdd=false`)
- Delivery: auto-chain, stacked-to-main
- Completed: 6/12 tasks (`1.1`, `1.2`, `1.3`, `1.4`, `2.1`, `2.2`)
- Current boundary: PR 2 / Work Unit 2, RFC 8785 JCS, digest vectors, and public digest exports only
- Remaining: `3.1`, `3.2`, `4.1`, `4.2`, `4.3`, `4.4`

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

## Deviations

- Added the `productLaunchTools.test.ts` structural mock discovered by the required agent typecheck; it is the same PR1 public-interface compatibility work as the five forecast fixtures.
- New deferred fields on the existing exported `AgentMessage` type are optional for source compatibility with existing consumers; rows returned by the SQLite store always map all ten fields to values or `null`.
- Valid deferred lifecycle operations intentionally throw an unavailable error after validation. JCS/digests and defer/resume/settle/query runtime behavior remain assigned to PRs 2-4.
- PR2 has no design deviations. It adds only canonicalization, digest construction, pinned vectors, tests, and barrel exports; lifecycle runtime methods remain assigned to PR3/PR4.
