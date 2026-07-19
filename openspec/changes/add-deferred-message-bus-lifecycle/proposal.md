# Proposal: Add Deferred Message Bus Lifecycle

## Intent

No pause-until-external-event primitive exists. `fail()` retries (max 3). Add same-row `deferred` with generation CAS, bus-computed JCS+SHA-256 domain-tagged digests, write-only system audit, mandatory `MutationScope`.

## Capabilities

### Modified
- **agent-message-bus**: Schema 23→33 (10 deferral/settlement columns); status union +`deferred`; `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` replaces legacy `IF NOT EXISTS`.

### New
- **deferred-message-bus-lifecycle**: `defer()` (gen CAS + digest), `resumeDeferred()` (exact-tuple CAS), `settle()` (terminal from `processing|deferred`, triple-match), `getExpiredDeferrals()` (keyset cursor, 1..100, lexicographic).
- **deferred-message-bus-audit**: `agent_message_bus_operation_audit` (`operationId` PK). System-scoped mutations+audit same-TX; queries snapshot TX→audit→commit. Seller: zero audit. Duplicate `operationId`→fail closed.

## Key Invariants

- **Idempotency** (domain-API): defer tuple+digest; resume token; settle triple `(status,settlementId,digest)`.
- **Digests** (bus-computed): deferral `{version:1,…,scopeProjection}` where `scopeProjection={kind:"seller",sellerId}|{kind:"system"}` (excl opId/reason/evRef). Settlement `{version:1,messageId,outcome,payload}` per-outcome (resolved/failed/cancelled). One NUL byte separator; SHA-256 hex.
- **Scope**: `SellerScope={kind:"seller",sellerId}`—`(@sellerId IS NULL OR seller_id=@sellerId)`, zero audit. `SystemScope={kind:"system",operationId,reason,evidenceRef}`—all non-empty, globally unique opId.
- **Races**: 6 CAS (defer↔fail, resume↔settle, settle↔settle identical/divergent). SQLite serializes; deterministic winner/loser.
- **Cursor**: `{deferredUntil,createdAt,messageId}`. `ORDER BY deferred_until,created_at,message_id ASC`; strict lexico continuation.
- **Lifecycle**: preserves `pending→cancelled`; backward compat; `deferralGeneration` NULL→1.

## Scope / Non-Goals

**In**: deferred status, 10 cols, 4 APIs, audit table, JCS+SHA-256, explicit scope, keyset, v3 migration, 6-race coverage. **Out**: expiry auto-processing, consumer fields, full history, `cancel()` via existing API, audit replay.

## Migration & Rollback

**v3**: register a new version 3 after existing v2; never change v2. V3 uses `PRAGMA table_info` + plain `ALTER TABLE ADD COLUMN` (bus) and `CREATE TABLE IF NOT EXISTS` (audit). Verify fresh DB, v2→v3, rerun, failure rollback, and both migration-flag paths. **Rollback**: quiesce→drain `settle()` per row (unique opId)→`COUNT(deferred)=0`→restart. No direct SQL; preserve attempts.

## Risks

| Risk | Mitigation |
|------|------------|
| Row leak | `getExpiredDeferrals()`; indefinite OK |
| Digest collision | Domain-tagged JCS+SHA-256; golden vectors |
| `system` misuse | Audit PK `operationId`; dup→fail closed |
| Offset drift | Lexicographic keyset |
| Duplicate opId | PK violation→rollback/no rows |
| Stale deferral token | `deferralGeneration` monotonic; `(messageId,gen)` scoped |

## Success Criteria

- [ ] 4 APIs: CAS correct; digest idemp/conflict; scope enforced; audit same-TX/snapshot.
- [ ] Digests: golden vectors match; `scopeProjection` excludes audit identity; per-outcome payloads.
- [ ] Keyset: lexico continuation, 1..100, full roundtrip, equal-ts no skip/dup.
- [ ] 6 races: exact winner+loser; no duplicate transitions.
- [ ] Migration v3 idempotent; `pending→cancelled` preserved; rollback `COUNT(deferred)=0`; all pre-existing tests pass unchanged.

## Implementation Forecast

Exactly four stacked-to-main slices: ~790 authored + ~50 generated golden-vector lines = ~840 total changed lines. Every slice MUST remain below 400 TOTAL changed lines, including generated lines. Chained PRs: Yes. Chain strategy: stacked-to-main. 400-line budget risk: High. Decision needed before apply: No. Size exception: none.
