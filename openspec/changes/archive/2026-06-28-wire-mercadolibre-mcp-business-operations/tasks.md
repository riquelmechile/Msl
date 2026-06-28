# Tasks: Wire MercadoLibre MCP Business Operations

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 500+ actual after integration tests and review fixes |
| 400-line budget risk | High (accepted post-archive corrective scope) |
| Chained PRs recommended | No |
| Suggested split | Single PR with work-unit commits |
| Delivery strategy | auto-forecast |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: High after archive; kept as one corrective pre-commit scope because the change was already archived and uncommitted.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Wire prepare-only `sync_product` validation and proposal save | PR 1 | Include focused tests; stop if diff approaches 400 lines. |
| 2 | Runtime/account-role safety polish if needed | PR 1 | Only expose narrow helpers; no execution APIs. |

## Phase 1: Foundation / Contracts

- [x] 1.1 Update `packages/mcp/src/index.ts` `sync_product` input schema to require `sourceSellerId`, `targetSellerId`, `itemId`, `rationale`, `expiresAt`, `requiresApproval: true`, and `risk: "high"`.
- [x] 1.2 Add controlled blocked response helpers in `packages/mcp/src/index.ts` for auth/validation failures with `{ status: "blocked", reason, message }` and no secret leakage.
- [x] 1.3 Extend `packages/mcp/src/runtimeDependencies.ts` or `McpServerConfig` only as needed to provide MLC role validation data without `ProductSyncEngine` or OAuth write dependencies.

## Phase 2: Core Implementation

- [x] 2.1 Replace the fake `sync_product` success in `packages/mcp/src/index.ts` with API-key, seller direction, target, rationale, strict ISO expiry, `requiresApproval`, and `risk: "high"` validation.
- [x] 2.2 In `packages/mcp/src/index.ts`, call `createPreparedActionTool(config.prepareWrite)` only after all validations pass and save a pending `listing-edit` proposal for target listing `itemId`.
- [x] 2.3 Include source seller, target seller, site, rationale, risk, expiry, and "no mutation executed" metadata in the `sync_product` JSON response.
- [x] 2.4 If needed, expose a narrow non-throwing helper from `packages/mercadolibre/src/accountRoles.ts`; preserve strict Plasticov -> Maustian MLC direction.
- [x] 2.5 Avoid changes that add `sync_all`, `executePreparedAction`, `execute_mercadolibre_write`, persistent approval storage, sync preview calculation, or `ProductSyncEngine` imports.

## Phase 3: Tests

- [x] 3.1 Add `packages/mcp/src/mcp.test.ts` success coverage: valid `sync_product` returns pending proposal, `requiresApproval: true`, `risk: "high"`, target listing, and repository `save` called once.
- [x] 3.2 Add blocked tests in `packages/mcp/src/mcp.test.ts` for invalid API key, reversed direction, arbitrary/missing seller roles, invalid expiry, missing rationale, and missing `requiresApproval: true`.
- [x] 3.3 Add explicit `packages/mcp/src/mcp.test.ts` cases proving missing `risk` and non-`high` risk block before repository `save`.
- [x] 3.4 Add regression assertions in `packages/mcp/src/mcp.test.ts` that MCP tool names exclude mutation/execution tools and `packages/mcp/src` does not import `ProductSyncEngine`.

## Phase 4: Verification / Cleanup

- [x] 4.1 Run `npm test -- packages/mcp/src/mcp.test.ts` or the repository-supported focused Vitest command for MCP tests.
- [x] 4.2 Run `npm test`, `npm run typecheck`, and `npm run lint`; note any pre-existing or environment-gated failures in the apply report.

## Corrective Apply Rerun

- [x] C.1 Loosen the real MCP `sync_product` input boundary so missing or invalid proposal metadata reaches handler-level validation and returns controlled blocked responses.
- [x] C.2 Preserve success validation so only `requiresApproval: true`, `risk: "high"`, strict future expiry, target/rationale, and MLC Plasticov -> Maustian direction can save a proposal.
- [x] C.3 Add SDK integration coverage that calls `sync_product` through `Client` + `InMemoryTransport` and proves missing/invalid approval or risk metadata returns controlled blocked responses before repository save.
- [x] C.4 Re-run focused MCP tests, typecheck, and lint sequentially for the corrective fix.
- [x] C.5 Format MCP implementation and tests with the repository-supported Prettier formatter.
- [x] C.6 Add SDK integration coverage proving prepared `sync_product` responses disclose in-memory-only approval persistence and unavailable audit replay while remaining non-executing.
- [x] C.7 Re-run focused MCP tests, format check, typecheck, lint, and full Vitest sequentially for the verification blockers.
- [x] C.8 Add runtime MLC site validation for injected account roles so non-MLC or incomplete role config blocks before repository save.
- [x] C.9 Wrap approval repository save failures so `sync_product` returns a controlled blocked response without leaking repository error details or claiming success.
- [x] C.10 Add explicit blocked coverage for unsupported bulk or multi-product sync intent.
