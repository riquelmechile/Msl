# Tasks: Converge MLC Read Snapshots

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 180-260 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | auto-chain |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Converge MLC read snapshots onto domain types/helpers with focused tests | PR 1 | Single PR under budget; includes dependency metadata, aliases, and verification. |

## Phase 1: Package Graph Foundation

- [x] 1.1 Add `@msl/domain` workspace dependency to `packages/mercadolibre/package.json`.
- [x] 1.2 Add `../domain` project reference to `packages/mercadolibre/tsconfig.json` for `tsc -b` ordering.
- [x] 1.3 Refresh `package-lock.json` so workspace dependency metadata matches `packages/mercadolibre/package.json`.

## Phase 2: Snapshot Type Convergence

- [x] 2.1 In `packages/mercadolibre/src/index.ts`, import domain `ReadSnapshot`, `CacheFreshness`, and `evaluateFreshness`.
- [x] 2.2 Redefine `MlcReadSnapshotKind`, completeness, confidence, and freshness exports from domain field types where practical.
- [x] 2.3 Redefine `MlcReadSnapshot<TData>` and listing/order/message/reputation aliases as domain `ReadSnapshot` intersections constrained to `source: "mercadolibre-api"`.
- [x] 2.4 Replace local freshness constants/risk mapping in `packages/mercadolibre/src/index.ts` with `evaluateFreshness({ source: "mercadolibre-api", signalKind, capturedAt, now })`.

## Phase 3: Integration Compatibility

- [x] 3.1 Adjust `packages/tools/src/index.ts` imports or generic constraints only if TypeScript requires it; preserve read-tool runtime behavior.
- [x] 3.2 Keep OAuth, seller mismatch, transport paths, write approvals, and official-docs adapter code unchanged.

## Phase 4: Focused Tests

- [x] 4.1 Extend `packages/mercadolibre/src/mercadolibre.test.ts` with compile-time assignments from MLC aliases to domain `ReadSnapshot`/`CacheFreshness`.
- [x] 4.2 Assert listing freshness remains `medium`/one hour and order/message/reputation remain `critical`/five minutes in `packages/mercadolibre/src/mercadolibre.test.ts`.
- [x] 4.3 If needed, update `tests/tools/tools.integration.test.ts` fixture typing to prove exported MLC aliases remain compatible with read tools.

## Phase 5: Verification

- [x] 5.1 Run `npm run typecheck` and confirm the package graph accepts the new MLC-to-domain reference.
- [x] 5.2 Run `npm test` and confirm read snapshot metadata and blocked-read scenarios remain unchanged.
- [x] 5.3 Run `npm run lint` and `npm run format:check` before handing off for review.
