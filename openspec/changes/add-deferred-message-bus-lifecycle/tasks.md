# Tasks: Add Deferred Message Bus Lifecycle

## Workload Forecast

Four stacked-to-main slices: ~790 authored + ~50 generated = ~840; each <400 TOTAL lines. No exception.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

| Unit | Goal | Focused test command | Harness | Rollback boundary |
|------|------|----------------------|---------|-------------------|
| 1 (~190) | V3/API | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` | Fresh/v2/rerun/failure/flag DBs | Revert v3/types/barrel/mocks; v2/data stay |
| 2 (~250) | JCS/vectors | `npx vitest run packages/agent/tests/conversation/jcsCanonicalize.test.ts` | Load vectors; assert digest/errors | Remove canonicalizer/test/vectors/wiring |
| 3 (~200) | Defer/resume | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` | In-memory SQLite CAS | Revert defer/resume/tests; v3 stays |
| 4 (~200) | Settle/query | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` | SQLite races/keyset/audit/restart | Revert settle/query/tests; v3/defer stay |

## Phase 1: Schema and API (PR 1)
- [x] 1.1 In `packages/agent/tests/conversation/agentMessageBusStore.test.ts`, RED fresh, v2, rerun, injected rollback/version=2, both flags, and unrelated-v3 cases; compare ordered 33/12 `(name,type,notnull,pk,dflt_value)` tuples exactly.
- [x] 1.2 In `packages/agent/src/conversation/agentMessageBusStore.ts`, preserve v2; add guarded v3 and `isApplied` proving ten exact bus additions plus exact audit schema. Legacy runs base -> v2 -> v3.
- [x] 1.3 Define and export unchanged through `packages/agent/src/index.ts`:

```ts
export type SellerScope={kind:"seller";sellerId:string};
export type SystemScope={kind:"system";operationId:string;reason:string;evidenceRef:string};
export type MutationScope=SellerScope|SystemScope;
export type DeferOptions={deferralId:string;deferralGeneration:number;deferredUntil?:string|null;reason:string;detail?:string|null;evidenceRef?:string|null;scope:MutationScope};
export type ResumeDeferredOptions={deferralId:string;deferralGeneration:number;scope:MutationScope};
export type SettlementOutcome="resolved"|"failed"|"cancelled";
export type ResolvedSettlementOptions={settlementId:string;scope:MutationScope;evidence?:unknown;result?:unknown};
export type FailedSettlementOptions={settlementId:string;scope:MutationScope;evidence?:unknown;error?:unknown};
export type CancelledSettlementOptions={settlementId:string;scope:MutationScope;evidence?:unknown;reason?:string};
export type SettlementOptions=ResolvedSettlementOptions|FailedSettlementOptions|CancelledSettlementOptions;
export type ExpiredDeferralsOptions={scope:MutationScope;limit?:number;cursor?:DeferralCursor|null};
export type DeferralCursor={deferredUntil:string;createdAt:string;messageId:string};
export type ExpiredDeferralsResult={messages:AgentMessage[];queryAsOf:string;nextCursor:DeferralCursor|null};
defer(messageId:string,options:DeferOptions):AgentMessage;
resumeDeferred(messageId:string,options:ResumeDeferredOptions):AgentMessage;
settle(messageId:string,outcome:SettlementOutcome,options:SettlementOptions):AgentMessage;
getExpiredDeferrals(options:ExpiredDeferralsOptions):ExpiredDeferralsResult;
```

- [x] 1.4 Extend row/mapping and structural fixtures: `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.test.ts`, `packages/agent/src/sessions/AgentWorkSessionRunner.test.ts`, `packages/agent/src/workers/daemonScheduler-sessions.test.ts`, `packages/agent/src/workers/productLaunchCoordinator.test.ts`, `tests/integration/product-launch-pipeline.test.ts`. RED scope/detail/evidence/limit/pre-TX validation.

## Phase 2: JCS and Digests (PR 2)
- [ ] 2.1 Create `packages/agent/tests/conversation/fixtures/deferral-digest-vectors.json` and `packages/agent/tests/conversation/jcsCanonicalize.test.ts`; cover three outcomes, nested/null/absent/numbers/escapes/UTF-8, lone-surrogate no-digest errors.
- [ ] 2.2 Create `packages/agent/src/conversation/jcsCanonicalize.ts`; implement approved JCS/domain-tagged digests without changing envelopes, nulls, projection, or exclusions.

## Phase 3: Defer and Resume (PR 3)
- [ ] 3.1 RED classifications, retained rejection, two races, claim exclusion, audit failure/fields, seller zero.
- [ ] 3.2 Implement CAS/classification/audit/row returns in `agentMessageBusStore.ts` with exact signatures/barrel.

## Phase 4: Settle, Query, Rollback (PR 4)
- [ ] 4.1 RED each selected write, non-selected SQL NULLs, JSON-null, timestamps, lock, attempts, terminal ID/digest, persisted-row retry mapping, conflicts, six races, audit rollback.
- [ ] 4.2 RED snapshot/keyset/equal timestamps/indefinite exclusion, audit JSON/NULLs, fixed-clock retry, duplicate rollback, scope/limits.
- [ ] 4.3 Implement settle/query/audit. Drain via unique operation IDs; preserve attempts; require zero deferred before restart; abort nonzero; never DROP.
- [ ] 4.4 Run focused commands, then regression-only `npm test`; record assertion counts and keep slices <400 total lines.
