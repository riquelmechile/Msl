# Proposal: Creative Budget Reservations and Generation Attempts

## Intent

Replace process-local `CostLedger` with durable authorities so paid work survives restarts and uncertain provider outcomes without overspend or blind retry. This is a prerequisite, not the full Creative runtime.

## Scope

### In Scope
- Micros-based admission/reconciliation; legacy USD is derived output only.
- Prepared-before-send attempts, trusted no-submission proof, 90-second fenced leases renewed every 30 seconds, same-attempt reconciliation, and hold renewal.
- Independent 30-second polling, provenance, bus settlement, recovery, rollback, and alerts.
- Bus v1-v3 then creative v4 ownership/FK validation before workers or dispatch.

### Out of Scope
- `CreativeJobDispatcher`, CEO tooling, provider ownership/selection changes, video-task store, Cortex, unified timeouts, external/non-SQLite stores, or other runtime-contract work.
- Bus schema/digest changes; blind retry of possibly-sent work.

## Capabilities

### New
- `creative-budget-reservations`: Micros authority, aggregate caps, idempotent lifecycle, lease-aware expiry.
- `creative-generation-attempts`: Fenced recovery, evidence-gated ambiguity, same-attempt closure.

### Modified
- `creative-studio-agent`: Dedicated polling; durable ordering, provenance, recovery, rollback.
- `creative-studio-minimax`: Attempt context and trusted send-state evidence; polling reuses one attempt/reservation.

## Approach

One SQLite database owns reservations, attempts, and bus state. Startup is `bus ownership -> creative validation -> stores/readiness -> workers/provider`. Recovery writes are fenced; attempt closure and reservation reconciliation are atomic. Unproven 429/network/timeout is ambiguous, never retried.

## Risks and Rollback

| Risk | Mitigation |
|---|---|
| Lease race/expiry | Mutation fencing; renew holds; exclude active leases from expiry. |
| Shared migration version collision | `isApplied` ownership proof plus exact PRAGMA/schema validation; fail closed. |
| Lost provider response | Trusted evidence only; hold and reconcile the same attempt. |

Rollback quiesces claims, stops workers, reconciles evidence, and releases proven-unsent holds. Ambiguous holds block disable pending operator evidence. Tables remain; no fallback after activation.

## Success Criteria

- [ ] Admission, migration, lease takeover, expiry, and crash points are failure-injection tested.
- [ ] No claim/provider work starts before `ready`; ambiguity cannot retry or disable durability.
- [ ] Results/assets carry attempt, reservation, micros, provider/model, hashes, requester, channel, and job provenance.

## Delivery

Cached auto-chain; stacked-to-main; decision before apply: **No**.

| Slice | Authored | Fixtures/tests | Total |
|---|---:|---:|---:|
| A Types/migration | 220 | 60 | 280 |
| B Reservation store | 250 | 80 | 330 |
| C Attempt store/leases | 260 | 90 | 350 |
| D Transport/send proof | 230 | 80 | 310 |
| E Providers/provenance | 230 | 80 | 310 |
| F Daemon/bus polling | 260 | 90 | 350 |
| G Startup/recovery/ops | 230 | 90 | 320 |
| **Total** | **1,680** | **570** | **2,250** |

Each main-targeting slice is green and under 400 changed lines.
