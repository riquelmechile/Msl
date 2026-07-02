# Apply Progress: Operational Returns Ingestion — Cumulative (PR1 + PR2)

## Mode
Standard (strict_tdd: false)

## PR Boundary
- **Unit**: 1 + 2 — Typed ML return safe reads + Auth-gated MCP return tools
- **Base**: `main`
- **Strategy**: stacked-to-main
- **Scope**: MercadoLibre client types, normalizers, methods, MCP tool registrations, auth gating, and all tests
- **PR2 Unit**: 2 — Auth-gated MCP return tools + MCP tests (applied after PR 1)

## Completed Tasks (12 of 12)

### PR1 — MercadoLibre Client Foundation + Client Tests
- [x] 1.1 Add return detail, review, and return-cost summary/snapshot types using `MlcSingleReadSnapshot` metadata.
- [x] 1.2 Add normalizers and degraded snapshot helper with `siteSupport: "MLC-to-confirm"` and `noMutationExecuted: true`.
- [x] 1.3 Add `MlcApiClient` methods for three documented GET paths only.
- [x] 3.1 Add mercadolibre test snapshots for return detail, reviews, and return-cost typed safe-read metadata.
- [x] 3.2 Add mercadolibre test cases for unavailable, unauthorized, not-found, and unsupported MLC degraded snapshots.
- [x] 3.4 Client-side: absence assertions for no return-review POST, upload, refund/dispute/action, durable ingestion, lane evidence, or AI image generation.
- [x] 4.1 Run focused mercadolibre tests (125 passed, 0 failed).

### PR2 — MCP Read Tool Wiring + MCP Tests
- [x] 2.1 Register `read_claim_return`, `read_return_reviews`, and `read_claim_return_cost` in `packages/mcp/src/index.ts` following existing direct claim read-tool patterns (`read_claim_detail`, `read_claim_messages`, etc.).
- [x] 2.2 Gate each return tool with MCP API-key auth (`validateApiKey`) before seller OAuth resolution or MercadoLibre client calls.
- [x] 2.3 Return seller scope, freshness, confidence, `siteSupport`, `requiresApproval: false`, and `noMutationExecuted: true` from each MCP tool (inherited from snapshot types returned by `jsonResult`).
- [x] 3.3 Add MCP test cases for tool registration, valid-auth delegation, and invalid-auth blocking.
- [x] 3.4 MCP-side: absence assertions for no return-review POST, upload, refund/dispute/action, durable ingestion, lane evidence, or AI image generation tools.
- [x] 4.1 Run focused MCP + mercadolibre tests (143 + 125 = 268 passed).
- [x] 4.2 Run `npm test` — 1104 tests passed across 41 test files, 0 failures.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `packages/mercadolibre/src/index.ts` | Modified | Added `MlcReturnSnapshotBase<TData>`, `MlcReturnSummary`, `MlcClaimReturnSummary`, `MlcReturnReview`, `MlcReturnReviewsSummary`, `MlcReturnCostCharge`, `MlcClaimReturnCostSummary` types. Added `MlcClaimReturnSnapshot`, `MlcReturnReviewsSnapshot`, `MlcClaimReturnCostSnapshot` snapshot types. Added `degradedReturnSnapshot` helper, `normalizeClaimReturn`, `normalizeReturnReviews`, `normalizeClaimReturnCost` normalizers. Added `getClaimReturn`, `getReturnReviews`, `getClaimReturnCost` to `MlcApiClient` interface and `createMlcReadMethods`. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modified | Added 12 tests across 4 describe blocks: `getClaimReturn` (3 tests), `getReturnReviews` (3 tests), `getClaimReturnCost` (3 tests), `return safe-read absence assertions` (3 tests covering forbidden method keys, GET-only transport calls, and path absence for ingestion/lane/ai). |
| `packages/mcp/src/index.ts` | Modified | Registered 3 new return read tools inside `if (config.mlcClient)` block: `read_claim_return` (calls `getClaimReturn`), `read_return_reviews` (calls `getReturnReviews`), `read_claim_return_cost` (calls `getClaimReturnCost`). Each tool performs `validateApiKey` before delegating to the client method. |
| `packages/mcp/src/mcp.test.ts` | Modified | Updated tool count from 28 to 31 in "registers injected MercadoLibre read tools" test. Added return tool registration assertions. Added 7 new tests: valid-auth delegation tests for each tool (read_claim_return, read_return_reviews, read_claim_return_cost), invalid-auth blocking tests for each tool (3), and a comprehensive absence assertion test for no return mutation/upload/refund/dispute/ingestion/lane/AI tools. |

## Deviations from Design

- **`MlcReturnSnapshotBase` uses `Omit` on `siteSupport` and `sellerScope`**: The domain-level `ReadSnapshot<TData>` already defines `siteSupport?: "MLC-confirmed" | "unknown"` and `sellerScope?: ReadSnapshotSellerScope`. Direct intersection with `"MLC-to-confirm"` created a `never` type. Using `Omit<MlcSingleReadSnapshot<TData>, "siteSupport" | "sellerScope">` before intersection resolves this correctly.
- **MCP `requiresApproval: false`**: The return snapshots don't include a `requiresApproval` field because they are pure read-only tools. The snapshot structure includes `noMutationExecuted: true` directly, and the MCP tool simply passes through the entire snapshot via `jsonResult`. No explicit metadata wrapper was needed since the snapshots already carry `sellerScope`, `siteSupport`, `freshness`, `confidence`, and `noMutationExecuted`. This matches the existing claim read-tool pattern (e.g., `read_claim_detail`).

## Issues Found

None.

## Workload / PR Boundary

- **Mode**: stacked-to-main (auto-chain)
- **PR 1 Unit**: Typed ML return safe reads + client tests (~650 lines in `packages/mercadolibre/`)
- **PR 2 Unit**: Auth-gated MCP return tools + MCP tests (~350 lines in `packages/mcp/`)
- **PR 3 Remaining**: Capability/out-of-scope guards (spec updates, no-code delta in matrix specs)
- **Total lines changed across PR1+PR2**: ~1000 (split across two stacked PRs)

## Test Results

```
# Focused run (PR2 batch):
npm test -- packages/mcp/src/mcp.test.ts
→ 143 tests passed, 0 failed

npm test -- packages/mercadolibre/src/mercadolibre.test.ts
→ 125 tests passed, 0 failed

# Full suite:
npm test
→ 1104 tests passed, 0 failed (41 test files)
```

## Commands Run

```bash
npx tsc -b packages/mercadolibre                         # rebuild dist types
npx tsc --noEmit --project packages/mcp/tsconfig.json    # clean
npm test -- packages/mcp/src/mcp.test.ts                 # 143 passed
npm test -- packages/mercadolibre/src/mercadolibre.test.ts # 125 passed
npm test                                                  # 1104 passed, 0 failed
```
