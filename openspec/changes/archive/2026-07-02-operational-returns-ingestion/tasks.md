# Tasks: Operational Returns Ingestion

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 520-720 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 client snapshots → PR 2 MCP tools → PR 3 matrix/out-of-scope guards |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Typed ML return safe reads | PR 1 | Base `main`; include client tests. |
| 2 | Auth-gated MCP return tools | PR 2 | Base updated `main` after PR 1; include MCP tests. |
| 3 | Capability/out-of-scope guards | PR 3 | Base updated `main` after PR 2; verify no mutations, durable ingestion, lane evidence, or AI images. |

## Phase 1: MercadoLibre Client Foundation

- [x] 1.1 Add return detail, review, and return-cost summary/snapshot types in `packages/mercadolibre/src/index.ts` using `MlcSingleReadSnapshot` metadata.
- [x] 1.2 Add normalizers and degraded snapshot helper in `packages/mercadolibre/src/index.ts` with `siteSupport: "MLC-to-confirm"` and `noMutationExecuted: true`.
- [x] 1.3 Add `MlcApiClient` methods for the three documented GET paths only in `packages/mercadolibre/src/index.ts`.

## Phase 2: MCP Read Tool Wiring

- [x] 2.1 Register `read_claim_return`, `read_return_reviews`, and `read_claim_return_cost` in `packages/mcp/src/index.ts` following existing direct claim read-tool patterns.
- [x] 2.2 Gate each return tool with MCP API-key auth before seller OAuth resolution or MercadoLibre client calls in `packages/mcp/src/index.ts`.
- [x] 2.3 Return seller scope, freshness, confidence, `siteSupport`, `requiresApproval: false`, and `noMutationExecuted: true` from each MCP tool.

## Phase 3: Tests and Guardrails

- [x] 3.1 Add `packages/mercadolibre/src/mercadolibre.test.ts` snapshots for return detail, reviews, and return-cost typed safe-read metadata.
- [x] 3.2 Add `packages/mercadolibre/src/mercadolibre.test.ts` cases for unavailable, unauthorized, not-found, and unsupported MLC degraded snapshots.
- [x] 3.3 Add `packages/mcp/src/mcp.test.ts` cases for tool registration, valid-auth delegation, and invalid-auth blocking before client calls.
- [x] 3.4 Add absence assertions in client/MCP tests for no return-review POST, upload, refund/dispute/action, durable ingestion, lane evidence, or AI image generation.

## Phase 4: Verification

- [x] 4.1 Run `npm test -- packages/mercadolibre/src/mercadolibre.test.ts packages/mcp/src/mcp.test.ts` or the closest repo-supported Vitest filter.
- [x] 4.2 Run `npm test` and record any unrelated failures before marking tasks complete.
