# Design: Deferred Message Bus Lifecycle

## Decisions

Extend the existing factory (80 callers); use an in-repo RFC 8785 canonicalizer plus `node:crypto` (no dependency; golden-pinned); keep audit in the bus DB for atomic rollback. V2 remains byte-for-byte unchanged. Four stacked-to-main slices remain below 400 total changed lines each.

## Schema V3 and Ownership

In `packages/agent/src/conversation/agentMessageBusStore.ts`, register `{version:3,name:"agent_message_bus_deferred_lifecycle",isApplied:isDeferredLifecycleV3Applied,up:migrateDeferredLifecycleV3}` after v2. `isApplied` reads both PRAGMAs and returns true only when all ten additions have exact `(type,notnull,pk,dflt_value)` tuples and `agent_message_bus_operation_audit` has the exact 12-column schema below. Therefore a shared, unrelated version-3 row cannot suppress `up`; registry post-apply proof and transaction rollback remain active.

The authoritative ordered bus contract is the spec's exact 33 tuples: current 14 base columns, current v2 order `result_json,error_json,cancel_reason,correlation_id,parent_message_id,seller_id,learned_at,outcome_score,action_id`, then:

```text
deferral_id TEXT; deferral_generation INTEGER; deferred_until TEXT; deferred_at TEXT;
defer_reason TEXT; defer_reason_detail TEXT; defer_evidence_ref TEXT; settlement_id TEXT;
settlement_digest TEXT; deferral_digest TEXT
```

All ten are nullable, non-PK, default NULL. V3 uses guarded plain `ALTER TABLE ... ADD COLUMN` and creates:

```sql
CREATE TABLE IF NOT EXISTS agent_message_bus_operation_audit (
 operationId TEXT PRIMARY KEY NOT NULL, operation TEXT NOT NULL, scopeJson TEXT NOT NULL,
 reason TEXT NOT NULL, evidenceRef TEXT NOT NULL, messageId TEXT, queryAsOf TEXT,
 queryCursorJson TEXT, queryLimit INTEGER, resultMessageIdsJson TEXT,
 nextCursorJson TEXT, createdAt TEXT NOT NULL);
```

The flag-disabled initializer runs base, unchanged v2, then the same guarded v3 helper. Tests assert full ordered `PRAGMA table_info` equality for name/type/notnull/pk/default: fresh DB, v2 DB, rerun, injected v3 DDL failure (schema and version rollback, version remains 2), enabled/legacy paths, and an unrelated existing version-3 row.

## Public Contract

Define in `agentMessageBusStore.ts` and export unchanged through `packages/agent/src/index.ts`:

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

Runtime validation accepts JSON values only for settlement result/error/evidence; scopes are non-empty, detail <=1000, evidenceRef opaque, and limit is integer 1..100. Rejection precedes transactions.

## Digests and CAS

Preserve the approved contract: RFC 8785 JCS; UTF-16 key ordering; finite JSON values; ECMA-262 serialization; lone-surrogate rejection; `sha256(utf8(tag) + NUL + utf8(JCS))`, lowercase hex. Deferral and settlement envelopes, present JSON-null optional keys, scope projection, domain tags, and exclusions remain unchanged.

Preserve exact CAS classifications, keyset query, six races, scope, and audit contracts from the specs. Settlement phase one sets terminal status/ID/digest, `resolved_at=updated_at=datetime('now')`, `locked_at=NULL`, preserves attempts, writes only selected outcome (`result_json=JSON.stringify(result)`; `error_json=JSON.stringify(error)`; `cancel_reason=reason`), maps null/undefined to SQL NULL, and sets both non-selected columns NULL. Exact triple retry performs no write and returns `rowToAgentMessage` of the persisted row; ID/digest/status conflicts throw.

## Files and Verification

Modify `packages/agent/src/conversation/agentMessageBusStore.ts`, its test, and `packages/agent/src/index.ts`. Create `packages/agent/src/conversation/jcsCanonicalize.ts`, `packages/agent/tests/conversation/jcsCanonicalize.test.ts`, and `packages/agent/tests/conversation/fixtures/deferral-digest-vectors.json`. Update structural fixtures in `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.test.ts`, `packages/agent/src/sessions/AgentWorkSessionRunner.test.ts`, `packages/agent/src/workers/daemonScheduler-sessions.test.ts`, `packages/agent/src/workers/productLaunchCoordinator.test.ts`, and `tests/integration/product-launch-pipeline.test.ts`.

Focused tests name exact cases and assert at least one expectation; `npm test` is regression only. Rollback remains quiesce -> drain by `settle()` with unique operation IDs and preserved attempts -> require `COUNT(status='deferred')=0` -> restart; nonzero aborts. Never DROP v3 schema or use direct SQL; source revert is not DB rollback; WAL safety remains required.

## Threat Matrix

N/A: no routing, shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary.
