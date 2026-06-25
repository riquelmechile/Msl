# Tasks: MLC Read Tools Foundation

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500-750 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 domain/memory contracts → PR 2 MLC normalization → PR 3 tools/integration |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Snapshot contracts and fresh-enough decisions | PR 1 | Base main; includes `packages/domain` and `packages/memory` tests. |
| 2 | Protected MLC read normalization | PR 2 | Depends on PR 1; includes `packages/mercadolibre` tests. |
| 3 | Read tool factory and integration proof | PR 3 | Depends on PR 2; includes `packages/tools` and `tests/tools` tests. |

## Phase 1: Snapshot Contracts

- [x] 1.1 Create `packages/domain/src/readSnapshot.ts` with `ReadSnapshot`, completeness, confidence, source, and kind contracts for listings/orders/messages/reputation.
- [x] 1.2 Export read snapshot contracts from `packages/domain/src/index.ts`.
- [x] 1.3 Add `packages/domain/src/domain.test.ts` cases for fresh metadata, stale metadata, and partial/low-confidence snapshots.
- [x] 1.4 Add `packages/memory/src/index.ts` helper/type to decide whether a `ReadSnapshot` is fresh enough or refresh-required.
- [x] 1.5 Add `packages/memory/src/memory.test.ts` coverage for fresh, stale, and partial snapshot decisions.

## Phase 2: MercadoLibre Read Normalization

- [x] 2.1 Extend `packages/mercadolibre/src/index.ts` with listing/order/message/reputation summary result types and normalized read methods.
- [x] 2.2 Normalize conservative transport payloads in `packages/mercadolibre/src/index.ts`, marking missing evidence as partial or low confidence.
- [x] 2.3 Preserve revoked/expired and seller-mismatch short-circuit behavior before transport in `packages/mercadolibre/src/index.ts`.
- [x] 2.4 Add `packages/mercadolibre/src/mercadolibre.test.ts` cases for normalized snapshots, partial evidence, revoked access, and seller mismatch.

## Phase 3: Tool Integration

- [ ] 3.1 Add `@msl/mercadolibre` to `packages/tools/package.json` dependencies.
- [ ] 3.2 Add `ReadToolBlocked` and `MlcReadTools` exports to `packages/tools/src/index.ts`.
- [ ] 3.3 Add `createMlcReadTools` in `packages/tools/src/index.ts` for listings, orders, messages, and reputation with `requiresApproval: false`.
- [ ] 3.4 Convert MLC reconnect and seller-mismatch errors in `packages/tools/src/index.ts` into blocked read responses with no seller business data.

## Phase 4: Verification

- [ ] 4.1 Extend `tests/tools/tools.integration.test.ts` for authorized read snapshots with source, freshness, confidence, and no approval creation.
- [ ] 4.2 Extend `tests/tools/tools.integration.test.ts` to prove official MercadoLibre MCP remains documentation-only during read execution.
- [ ] 4.3 Run `npm test` and fix failures within the relevant package/test files only.
