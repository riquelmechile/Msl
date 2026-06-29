## Exploration: Persist MCP Approval Proposals

### Current State
PR #20 changed MCP `sync_product` from fake success into a prepare-only, approval-required proposal. `packages/mcp/src/index.ts` validates API key, single-item intent, Plasticov -> Maustian MLC direction, `requiresApproval: true`, `risk: "high"`, rationale, and strict future expiry before saving a pending `listing-edit` prepared action through `createPreparedActionTool`.

The current MCP runtime dependency builder in `packages/mcp/src/runtimeDependencies.ts` always wires `prepareWrite.repository` to `createInMemoryApprovalQueueRepository()`. `packages/tools/src/index.ts` defines the repository contract and in-memory implementation for prepared entries, approvals, and audits. The persistence patterns already in the repo use `better-sqlite3` with local schema setup, WAL pragmas, prepared statements, ISO timestamp strings, and explicit `close()` methods (`packages/mercadolibre/src/oauth/tokenStore.ts`, `packages/mercadolibre/src/sync/syncStore.ts`, `packages/memory/src/connectionPool.ts`, `packages/agent/src/conversation/sessionStore.ts`).

Existing specs intentionally say the previous product-sync slice does not persist approvals. The next logical safe slice is to make prepared proposals durable across MCP process restarts while preserving the same no-execution boundary: no `ProductSyncEngine`, no `sync_all`, no MercadoLibre mutation execution, no arbitrary seller direction, and no raw token leakage.

### Affected Areas
- `packages/tools/src/index.ts` — owns `ApprovalQueueRepository`, `ApprovalQueueEntry`, in-memory storage, and prepared/approval/audit helpers; likely home for a SQLite-backed repository factory or a new sibling module export.
- `packages/mcp/src/runtimeDependencies.ts` — currently constructs the in-memory repository; should select SQLite persistence when configured and close the persistent handle.
- `packages/mcp/src/index.ts` — success metadata currently discloses `approvalPersistence: "in-memory-only"`, `auditReplay: "not-available"`, and `persistentApprovalStorage: false`; this must change only for durable proposal storage, not execution.
- `packages/mcp/src/mcp.test.ts` and `packages/mcp/src/mcp.integration.test.ts` — contain current safety regression tests for validation, no execution tools, no `ProductSyncEngine`, repository failure redaction, and in-memory-only disclosure.
- `tests/tools/tools.integration.test.ts` / `packages/tools/src/index.test.ts` — appropriate places for repository contract tests proving save/find survives a fresh repository instance.
- `openspec/specs/action-approval-safety/spec.md` — currently states product sync proposals do not persist approvals; will need a focused delta to allow persistent prepared proposal storage while still forbidding execution/audit replay.
- `openspec/specs/custom-business-mcp-tools/spec.md` — prepare-only product sync requirement should be extended to report durable proposal storage when configured.

### Approaches
1. **SQLite-backed `ApprovalQueueRepository` in `@msl/tools`** — Add a repository implementation that persists prepared entries, approvals, and audits with JSON payload columns and ISO timestamps, then wire MCP runtime to use it when `MSL_APPROVAL_QUEUE_DB_PATH` (or similar) is set.
   - Pros: Directly preserves the existing repository boundary; `createPreparedActionTool`, `approvePreparedAction`, and `executePreparedAction` need no behavior rewrite; easy restart test by closing and reopening; aligns with repo SQLite patterns.
   - Cons: Adds serialization/deserialization for Dates and domain payloads; if approvals/audits are stored too, reviewers must verify this still does not expose execution from MCP.
   - Effort: Medium

2. **MCP-only proposal store wrapper** — Keep `ApprovalQueueRepository` in memory for generic tools but add a narrow MCP `sync_product` persistent proposal table used only by the MCP handler.
   - Pros: Smallest surface for product-sync persistence only; avoids touching approval execution helpers.
   - Cons: Duplicates approval queue semantics; `prepare_mercadolibre_write` remains non-durable; future approval/execution work would need a migration from MCP-specific records back into the repository contract.
   - Effort: Low/Medium

3. **Reuse an existing SQLite store/database package** — Store approval proposals through an existing memory/session/shared DB path and add approval tables there.
   - Pros: Reuses established connection pooling or session persistence patterns.
   - Cons: Couples approval safety storage to unrelated memory/session domains; increases migration and ownership ambiguity for a safety-critical queue.
   - Effort: Medium/High

### Recommendation
Proceed with Approach 1, but keep the implementation slice deliberately narrow: add a SQLite-backed `ApprovalQueueRepository` factory in `@msl/tools`, cover its repository contract with Vitest, and make MCP runtime choose it only when an approval DB path env var is configured. Continue defaulting to in-memory storage for local/test unless configured.

The first production-safe persistence slice should persist pending prepared actions well enough that a `sync_product` proposal can be found after an MCP process restart. It MAY persist approvals and audits because they are already part of the existing repository interface, but MCP must still not expose approval or execution tools beyond preparation. `sync_product` response metadata should change from `persistentApprovalStorage: false` to true only when the configured repository is durable, and it should keep `noMutationExecuted: true` and `auditReplay: "not-available"` unless audit replay is explicitly implemented later.

For review-size awareness, split work if needed: PR 1 should be only the SQLite repository plus contract tests; PR 2 should be MCP runtime wiring and response/spec updates. If kept as one PR, watch the 400-line budget because serialization tests plus MCP integration coverage can grow quickly.

### Risks
- Date and JSON deserialization bugs could make stored proposals fail approval matching after restart; tests must assert restored `expiresAt`, `requestedAt`, `exactChange`, and risk/status values.
- Updating the repository interface for durability metadata could cascade across tests; prefer a narrow optional capability/metadata field or runtime-owned flag over broad API churn.
- Persisting approvals/audits may look like enabling execution; tests and specs must keep proving MCP exposes no `execute_mercadolibre_write`, no `executePreparedAction`, no `sync_all`, and no `ProductSyncEngine` import.
- Storing proposal payloads must not include OAuth tokens, API keys, or raw client secrets; repository failures returned through MCP must remain controlled and redacted.

### Ready for Proposal
Yes — tell the user the next safe proposal is durable approval proposal storage behind the existing `ApprovalQueueRepository`, configured for MCP runtime, with restart-survival tests and unchanged no-mutation boundaries. Do not include sync preview or execution in this change.
