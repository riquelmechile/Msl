## Exploration: next safest MercadoLibre MCP operation

### Current State
The MercadoLibre MCP surface is now stronger than the original stub. `sync_product` in `packages/mcp/src/index.ts` validates MCP auth, configured Plasticov-to-Maustian `MLC` direction, single `MLC` item IDs, required approval metadata, high risk, future expiry, and then stores a pending `listing-edit` proposal through the approval queue. It may attach read-only preview evidence, but it still reports `noMutationExecuted: true`, keeps `approvalStatus: "pending"`, avoids `ProductSyncEngine`, and exposes no approval/execution tools.

Durable approval storage exists behind `MSL_APPROVAL_QUEUE_DB_PATH` in `packages/tools/src/index.ts` and `packages/mcp/src/runtimeDependencies.ts`, and the repository already supports `findAction`, `saveApproval`, `findApproval`, and audits. However, the MCP runtime currently only prepares proposals; it does not expose a read-only way to retrieve a stored prepared proposal by ID after restart, nor an approval-recording or execution surface. Existing specs explicitly preserve prepare-only product sync behavior and forbid mutation execution, audit replay, `sync_all`, and separate sync preview tools.

### Affected Areas
- `packages/mcp/src/index.ts` — owns MCP tool registration, API-key checks, `sync_product` response metadata, and the safest place to add a read-only proposal inspection tool without execution.
- `packages/mcp/src/runtimeDependencies.ts` — already wires memory/SQLite approval repositories and can pass the same repository to a read-only inspection path.
- `packages/tools/src/index.ts` — owns `ApprovalQueueRepository.findAction()` and the persisted proposal shape that a status/inspection tool would read.
- `packages/mcp/src/mcp.test.ts` — contains safety regression tests for tool surface, no execution tools, durable metadata, preview degradation, and storage redaction.
- `packages/mcp/src/mcp.integration.test.ts` — verifies SDK-level `sync_product` behavior and should cover read-only proposal inspection through the MCP SDK if added.
- `openspec/specs/custom-business-mcp-tools/spec.md` — should define that stored proposal inspection is read-only and must not approve, execute, or replay audits.
- `openspec/specs/action-approval-safety/spec.md` — should preserve pending product sync proposal safety while allowing non-mutating status retrieval.

### Approaches
1. **Read-only prepared proposal inspection** — Add an MCP tool that accepts a prepared action ID, reads the approval repository, and returns sanitized proposal status/metadata for existing product-sync proposals only.
   - Pros: Highest safety; directly makes durable storage useful after restart; no MercadoLibre mutation; no approval state change; likely reviewable under the 400-line budget.
   - Cons: Requires careful anti-enumeration and redaction rules; generic prepared writes may contain sensitive historical payloads unless the tool is scoped tightly to sync proposals.
   - Effort: Low/Medium

2. **Approval-recording only** — Add a tool that records seller approval for an existing prepared proposal but still does not execute MercadoLibre mutations.
   - Pros: Moves the approval workflow forward and uses existing `approvePreparedAction()` support.
   - Cons: Mutates approval state; needs stronger seller identity/confirmation semantics; increases risk before read-only retrieval exists.
   - Effort: Medium

3. **Approval-gated sync execution** — Add execution for approved product sync proposals through the sync engine and audit trail.
   - Pros: Highest business impact.
   - Cons: Crosses mutation, audit, rollback, OAuth, sync-engine, and TOS boundaries; too risky as the immediate next slice.
   - Effort: High

4. **Add another MercadoLibre safe-read capability** — Expand runtime reads to a new area such as listing quality, visits, or questions.
   - Pros: Useful business evidence and still read-first.
   - Cons: Current capability matrix marks several of these as low-confidence or unknown for MLC runtime support; needs documentation/site-support refresh before implementation.
   - Effort: Medium

### Recommendation
Proceed with Approach 1: add a read-only `sync_product` proposal inspection/status slice. The proposal should expose a narrowly scoped MCP read operation for a known prepared sync proposal ID, return pending/approved/expired-style status and non-sensitive preview/exact-change metadata, disclose storage durability/degradation where relevant, and prove it does not approve, execute, replay audits, expose `ProductSyncEngine`, expose `sync_all`, or leak database paths/secrets.

This is the safest high-value next step because the last slices made proposals durable and preview-rich, but operators still need a way to retrieve and inspect them after process restart before any approval or execution phase is considered. Defer approval-recording and execution until after read-only proposal retrieval is specified, tested, and archived.

### Risks
- A proposal inspection tool can become an enumeration or leakage vector unless it requires MCP auth, exact action ID, sync-proposal scoping, and redacted responses.
- Reading generic prepared actions may expose caller-provided historical payloads; the first slice should inspect only `sync_product`-shaped proposals or sanitize aggressively.
- Returning expired status without mutating repository state must be specified clearly, or the tool may accidentally become a state-changing workflow.
- Adding approval or execution in the same slice would break the current safety boundary and likely exceed the review budget.

### Ready for Proposal
Yes — tell the user the next safe OpenSpec proposal should be a read-only MCP proposal inspection/status tool for prepared `sync_product` actions. It should build on durable approval storage and preview evidence while explicitly keeping approval recording, execution, audit replay, `sync_all`, and `ProductSyncEngine` coupling out of scope.
