# Apply Progress: Add Deferred Message Bus Lifecycle

## Status

- Mode: Standard (`strict_tdd=false`)
- Delivery: auto-chain, stacked-to-main
- Completed: 4/12 tasks (`1.1`, `1.2`, `1.3`, `1.4`)
- Current boundary: PR 1 / Work Unit 1, V3 schema and public API foundation only
- Remaining: `2.1`, `2.2`, `3.1`, `3.2`, `4.1`, `4.2`, `4.3`, `4.4`

## Work Unit Evidence

| Evidence | Result |
|---|---|
| Focused tests | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` -> exit 0; 1 file passed; 44/44 tests passed; `rg -o 'expect\(' packages/agent/tests/conversation/agentMessageBusStore.test.ts \| wc -l` -> 132 static expectation sites |
| Runtime harness | Same focused command exercised in-memory SQLite fresh enabled, fresh legacy-flag, v2-to-v3, rerun, injected ownership-proof rollback, and unrelated recorded-v3 scenarios; all 6 migration cases passed |
| Typecheck | `npm run typecheck --workspace @msl/agent` -> exit 0 |
| Formatting | `npx prettier --check packages/agent/src/conversation/agentMessageBusStore.ts packages/agent/tests/conversation/agentMessageBusStore.test.ts packages/agent/src/index.ts packages/agent/src/conversation/tools/productLaunchTools.test.ts packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.test.ts packages/agent/src/sessions/AgentWorkSessionRunner.test.ts packages/agent/src/workers/daemonScheduler-sessions.test.ts packages/agent/src/workers/productLaunchCoordinator.test.ts tests/integration/product-launch-pipeline.test.ts` -> exit 0; all matched files use Prettier style |
| Churn | `git diff --numstat` -> 362 additions + 4 deletions = 366 total tracked churn; below 400 |
| Migration rollback | Malformed pre-existing audit schema makes post-apply ownership proof fail; v3 transaction rolls back all ten bus additions and leaves version 3 absent, with the v2 bus at 23 columns |
| Work-unit rollback | Revert the nine tracked files below to remove v3/types/barrel/mocks/tests; unchanged v2 behavior and existing data remain. Deployed databases are not downgraded or dropped. |

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

## Deviations

- Added the `productLaunchTools.test.ts` structural mock discovered by the required agent typecheck; it is the same PR1 public-interface compatibility work as the five forecast fixtures.
- New deferred fields on the existing exported `AgentMessage` type are optional for source compatibility with existing consumers; rows returned by the SQLite store always map all ten fields to values or `null`.
- Valid deferred lifecycle operations intentionally throw an unavailable error after validation. JCS/digests and defer/resume/settle/query runtime behavior remain assigned to PRs 2-4.
