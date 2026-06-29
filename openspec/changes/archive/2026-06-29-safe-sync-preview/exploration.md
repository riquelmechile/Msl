## Exploration: Safe Sync Preview

### Current State
MCP `sync_product` is currently prepare-only. `packages/mcp/src/index.ts` validates MCP API-key auth, single-item intent, configured Plasticov-to-Maustian MLC direction, `requiresApproval: true`, `risk: "high"`, rationale, and future expiry, then saves a pending `listing-edit` prepared action through `createPreparedActionTool`. Responses include durability metadata and `noMutationExecuted: true`.

Durable proposal storage is already available behind `MSL_APPROVAL_QUEUE_DB_PATH` via `packages/mcp/src/runtimeDependencies.ts` and `createSqliteApprovalQueueRepository`. Current specs and tests explicitly forbid sync preview calculation and a `preview_product_sync` tool as part of the prior persistence slice.

The existing production sync engine can fetch a source item, apply strategies, and publish to the target account, but importing `ProductSyncEngine` into MCP is currently a safety regression. A safer next slice is a read-only preview model that computes proposed field changes without publishing, approving, auditing, or adding execution tools.

### Affected Areas
- `openspec/specs/action-approval-safety/spec.md` — currently says product sync proposals MUST NOT calculate sync previews; needs a focused delta allowing read-only preview while still forbidding execution, audit replay, and credentials.
- `openspec/specs/custom-business-mcp-tools/spec.md` — currently requires `sync_product` to remain prepare-only and forbids preview tools; needs a delta for preview metadata on the existing `sync_product` response, not a new executor.
- `openspec/specs/ml-api-integration/spec.md` — defines `ProductSyncEngine` and the MCP no-direct-execution boundary; may need preview language that distinguishes calculation from mutation.
- `packages/mcp/src/index.ts` — likely place to enrich `sync_product` prepared proposal metadata/exact changes with an optional preview while preserving the current blocked-response validation path.
- `packages/mcp/src/runtimeDependencies.ts` — would need explicit injection of any read-only preview dependency if the preview uses live source data; avoid wiring `ProductSyncEngine` directly.
- `packages/mercadolibre/src/sync/strategyApplier.ts` — existing pure strategy application can support deterministic preview calculation without publish behavior.
- `packages/mercadolibre/src/index.ts` — current MCP `MlcApiClient` read interface lacks `getItem`; live preview would require adding a read-only single-item method or using a separate narrow preview reader.
- `packages/mcp/src/mcp.test.ts` and `packages/mcp/src/mcp.integration.test.ts` — current regression tests assert no preview; tests must be updated to allow only the new safe preview shape and keep no mutation/execution assertions.

### Approaches
1. **Inline preview metadata on existing `sync_product`** — Add optional read-only preview details to the existing prepared proposal response and stored exact changes when a preview dependency is available.
   - Pros: Smallest MCP surface; no new tool name; keeps approval and durability behavior unchanged; easiest to keep under the 400-line review budget.
   - Cons: Requires changing prior “no preview” specs/tests; live source-item reads need a narrow dependency that MCP does not currently expose.
   - Effort: Medium

2. **Separate `preview_product_sync` read-only MCP tool** — Add a dedicated preview tool that validates direction and returns proposed changes, while `sync_product` remains proposal-only.
   - Pros: Clear separation between preview and proposal; easy for users to request preview before preparing approval.
   - Cons: Prior safety tests explicitly forbid this tool; larger surface and review scope; introduces another MCP operation before execution controls exist.
   - Effort: Medium/High

3. **Use `ProductSyncEngine` in dry-run mode** — Extend or wrap the sync engine with a no-publish path and call it from MCP before proposal creation.
   - Pros: Reuses the same transformation path intended for execution; best long-term consistency.
   - Cons: Crosses the current MCP boundary by importing sync-engine behavior into MCP; likely larger because the engine has no dry-run contract today; higher risk of accidental publish coupling.
   - Effort: High

### Recommendation
Proceed with Approach 1 as the smallest safe next slice: define a read-only `sync_product` preview that is returned as metadata/preview evidence on the existing prepare-only proposal, not as a new execution or approval tool. The preview should be optional/degraded when source item data or strategies are unavailable, and it must keep `approvalStatus: "pending"`, `requiresApproval: true`, `noMutationExecuted: true`, no audit replay, no `sync_all`, no approval/execution MCP tools, and no `ProductSyncEngine` import in MCP.

For implementation planning, prefer extracting a pure preview helper around existing strategy application and injecting only read-only item access into MCP. Do not call `publishItem`, do not instantiate the sync engine, and do not persist credentials or raw API errors in proposal storage. This should fit a single reviewable PR if scoped to specs, one helper, MCP response wiring, and focused tests.

### Risks
- The existing `MlcApiClient` used by MCP does not expose `getItem`; adding live preview may require read-interface expansion and extra OAuth read tests.
- Specs/tests currently forbid preview calculation, so the proposal must clearly narrow the allowed preview to non-mutating, pre-execution evidence.
- Preview data could be mistaken for approval or execution readiness; response metadata must explicitly state pending approval and no mutation.
- Reusing sync-engine internals could accidentally widen MCP into execution coupling; avoid `ProductSyncEngine` in this slice.

### Ready for Proposal
Yes — the next recommended phase is `propose`. Tell the user the safe next slice is an inline read-only sync preview attached to the existing `sync_product` prepared proposal, preserving the prepare-only boundary and deferring separate preview tools, approval execution, audit replay, and full sync-engine dry-run behavior.
