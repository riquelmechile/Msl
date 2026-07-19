# deferred-message-bus-lifecycle Specification

## Purpose

Same-row defer/resume/settle with CAS, RFC 8785 digests, keyset expiry, six races, required validated scope, and write-only audit.

## Digest Contracts

Caller never supplies digests. `defer` options `deferralId`, `deferralGeneration`, `deferredUntil`, `reason`, `detail`, `evidenceRef` map to identically named envelope fields; `scope` maps to `scopeProjection`. Optional omitted/undefined values normalize to JSON `null`; every key is present. Digest: lowercase SHA-256 of `utf8(tag)\x00utf8(RFC8785-JCS)`. Tag: `msl.agent-message-bus.deferral.v1`; envelope `{version:1,messageId,deferralId,deferralGeneration,deferredUntil,reason,detail,evidenceRef,scopeProjection}`. Projection is `{kind:"seller",sellerId}` or `{kind:"system"}`; only audit identity is excluded, not top-level reason/detail/evidenceRef.

`settle` maps `result|error|reason` and `evidence` to `{version:1,messageId,outcome,payload}`: resolved `{result,evidence}`, failed `{error,evidence}`, cancelled `{reason,evidence}`. Omitted/undefined fields become present JSON `null`. Tag: `msl.agent-message-bus.settlement.v1`; exclude `settlementId`. Inputs are JSON values. A lone surrogate in any key/value MUST error before hashing and produce NO digest.

## Requirements

### Requirement: Defer with Generation CAS

`defer` SHALL transition `processing→deferred`; ID is unique per message/generation; generation is monotonic (>stored, NULL→1). Zero changes MUST classify the scoped row: **already-deferred** only for current `deferred` plus exact ID/generation/digest (idempotent); **stale** for lower generation; **divergent** for other deferred rows; **processing**, **pending**, **terminal**, or missing otherwise. All but already-deferred reject. Retained fields on later states never qualify. Fresh-operation retry of one domain tuple keeps its digest.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| First | processing, gen=NULL | defer with gen=1 | deferred; digest stored |
| Idempotent | deferred, exact id/gen/digest | same request | 0 changes; current row returned |
| Divergent | deferred, id="d1", gen=1 | diff→divergent digest | Error: conflict |
| Stale | deferred, gen=2 | deferralGeneration:1 | Error |
| Retained | pending/terminal keeps tuple | same request | Error |

### Requirement: Resume Deferred with Token CAS

`resumeDeferred` SHALL perform exact-token `deferred→pending`; same-cycle pending exact token is idempotent; stale/divergent/terminal reject.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Resume | deferred, id=d1, gen=1 | resume exact token | pending; lock NULL |
| Idempotent | pending, id="d1", gen=1 | same | 0 changes |
| Stale | deferred, gen=2 | deferralGeneration:1 | Error |

### Requirement: Terminal Settlement

`settle` SHALL atomically bypass retry from `processing|deferred` to a terminal outcome. Exact `(status,settlementId,digest)` is idempotent; divergent ID/digest conflicts; different status rejects. Normalized-null digest rules apply.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| processing→failed | processing, a=0 | settle failed | failed, a=0 |
| deferred→resolved | deferred | settle resolved | resolved |
| Triple match | failed, settlementId="set-1" | same→matching digest | 0 changes |
| Status conflict | resolved | settle('failed',…) | Error |

Six races MUST resolve deterministically: defer→fail gives deferred/mismatch; fail→defer gives pending attempts+1/mismatch; resume→settle gives pending/mismatch; settle→resume gives terminal/mismatch; identical settles give terminal/idempotent; divergent settles give terminal/conflict.

### Requirement: Keyset Expired Deferral Query

`getExpiredDeferrals` SHALL snapshot one start `queryAsOf`; require scope and integer limit 1..100; return non-NULL expired deferred rows ordered/keyset strictly by `(deferred_until,created_at,message_id) ASC`; cursor `{deferredUntil,createdAt,messageId}`; next is last tuple or null. Seller has no audit; system does.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Indefinite excluded | deferred_until=NULL | same | Excluded |
| Keyset roundtrip | 3 rows T1(A,B,C); limit=2 | P1→[A,B](T1,B); P2→[C]; P3→[] | No skip/duplicate |
| Limit 0 | any | limit:0 | Error |

### Requirement: Rollback and Crash Safety

Rollback MUST quiesce→drain via `settle` (unique operation IDs; preserve attempts)→verify zero deferred→restart. Never direct SQL or DROP v3 schema; source revert is not DB rollback; nonzero aborts. Detail ≤1000; evidenceRef opaque; WAL-safe.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Verify zero | drained | COUNT(deferred) | 0 |
| Crash | deferred row | Restart+WAL | Row survives |
