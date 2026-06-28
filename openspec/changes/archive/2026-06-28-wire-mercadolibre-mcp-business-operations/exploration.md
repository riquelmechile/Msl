## Exploration: Wire MercadoLibre MCP business operations

### Current State
MSL already has a project-owned MCP server in `@msl/mcp`, a direct MercadoLibre API package in `@msl/mercadolibre`, and safe tool boundaries in `@msl/tools`. The official MercadoLibre MCP remains documentation lookup only; seller reads and operations must route through project-owned direct API tooling.

After PR #18, the MCP runtime can expose OAuth-backed safe reads for listings, orders, messages, reputation, category attributes, and category technical specs when MercadoLibre OAuth config is complete. The runtime also registers `prepare_mercadolibre_write`, which stores approval-required prepared actions but does not execute mutations. Stubbed business tools still exist: `sync_product` in `packages/mcp/src/index.ts` returns `{ status: "ok", tool: "sync_product" }` without calling the sync engine, approval queue, or direct APIs.

The smallest production-safe next slice is not direct mutation execution. It is replacing the `sync_product` MCP stub with a prepare-only business-operation proposal that validates the Plasticov -> Maustian direction and writes an approval-required prepared action for a single listing sync/publication intent. This makes the MCP surface real enough to create auditable business work, while preserving the existing no-execution boundary.

### Affected Areas
- `packages/mcp/src/index.ts` — currently exposes the stubbed `sync_product` MCP tool and already has helpers for API-key validation, JSON MCP responses, and `prepare_mercadolibre_write` registration.
- `packages/mcp/src/runtimeDependencies.ts` — currently wires OAuth-backed reads plus an in-memory approval queue into the MCP runtime; it can keep the first slice prepare-only without adding a direct sync executor.
- `packages/tools/src/index.ts` — owns `createPreparedActionTool`, `PREPARED_WRITE_KINDS`, approval repository types, and the no-execution prepared-write boundary.
- `packages/domain/src/preparedAction.ts` — defines available write kinds and risk levels; a single-product sync likely maps to `listing-edit`/`creative-publication` unless a dedicated sync kind is added later.
- `packages/mercadolibre/src/accountRoles.ts` — enforces configured source and target seller IDs and blocks reverse Maustian -> Plasticov direction.
- `packages/mercadolibre/src/sync/syncEngine.ts` — already contains real publish behavior and direction validation, but should remain out of the first MCP slice because direct execution would be too risky.
- `packages/agent/src/conversation/syncTools.ts` — shows the safer existing pattern: sync tools block unless `approvedExecution` is explicitly enabled and validate sync direction.
- `openspec/specs/custom-business-mcp-tools/spec.md` — already requires project-owned safe reads, prepared writes, and no official MCP execution.
- `openspec/specs/action-approval-safety/spec.md` — requires approval/audit controls for listing edits, publication, price, stock, messages, refunds, cancellations, and sync-like mutations.

### Approaches
1. **Prepare-only single-product sync proposal** — Change MCP `sync_product` from a fake success stub into an approval-required prepared action for one Plasticov -> Maustian listing sync/publication intent, with API-key auth, configured account direction validation, exact requested target, rationale, expiry, and no execution.
   - Pros: smallest real business-operation wiring; aligns with existing approval queue; preserves no mutation execution; reviewable under the 400-line budget with focused tests.
   - Cons: does not calculate final transformed listing payload yet; generic prepared-action kinds may not perfectly express "sync product" without a future domain kind.
   - Effort: Low/Medium

2. **Safe-read sync planning preview** — Add a new MCP read/planning tool that reads the source listing and maybe target state, then returns a non-mutating sync preview with freshness/confidence metadata.
   - Pros: more precise before approval; no writes; improves seller trust by showing likely changes.
   - Cons: needs additional `MlcApiClient` support for item detail or reuse/consolidation with legacy `MlClient`; likely larger than a first safe slice.
   - Effort: Medium

3. **Approval-gated execution path** — Add MCP approval plus execution for `sync_product`, calling `ProductSyncEngine` only after recorded approval and writing audit results.
   - Pros: end-to-end production operation; highest business impact.
   - Cons: crosses mutation, approval, executor, audit, OAuth, sync, rollback, and TOS boundaries; too large and risky for the next slice.
   - Effort: High

### Recommendation
Proceed with Approach 1. The next proposal should wire only `sync_product` as a prepare-only MCP business operation: validate MCP auth, require configured Plasticov -> Maustian account roles, reject arbitrary or reversed seller IDs, create an approval-required prepared action, and return metadata showing `requiresApproval: true`. Do not execute `ProductSyncEngine`, do not expose `sync_all`, and do not add raw write APIs in this slice.

For review-size control, keep the first PR to one behavior: `sync_product` no longer returns fake success; it produces a persisted approval proposal or a controlled blocked response. Put tests with the MCP change. Defer sync preview, dedicated sync action kinds, persistent approval storage, execution, and audit replay to later work units.

### Risks
- Mapping product sync to an existing prepared-action kind may be semantically imprecise; a later spec may need a dedicated `product-sync` prepared action kind.
- The current runtime approval queue is in-memory, so prepared MCP proposals will not survive process restart until a persistent repository slice is added.
- Accidentally calling `ProductSyncEngine` from MCP would publish items; the first slice must explicitly prove no mutation execution tools or direct sync execution are exposed.
- The generic `prepare_mercadolibre_write` tool currently accepts caller-supplied seller IDs; the new `sync_product` wiring must be stricter and derive/validate the configured Plasticov -> Maustian roles.

### Ready for Proposal
Yes — tell the user the next safe slice should convert the MCP `sync_product` stub into a real prepare-only, approval-required single-product sync proposal. This moves from fake-compatible surface to production business-operation wiring without crossing into mutation execution.
