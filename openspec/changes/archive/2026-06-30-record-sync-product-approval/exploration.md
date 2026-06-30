## Exploration: record sync_product approval without execution

### Current State
`sync_product` currently prepares one high-risk Plasticov-to-Maustian `MLC` listing-edit proposal after MCP API-key auth, exact single-item validation, approval metadata, future expiry, role-direction checks, and optional read-only preview evidence. `read_sync_product_status` can retrieve one exact stored proposal ID, redacts unavailable/unsupported cases, derives expired status without writes, and does not call approval, audit, MercadoLibre mutation APIs, `ProductSyncEngine`, `sync_all`, or multi-product sync.

The approval repository already supports `findAction`, `saveApproval`, `findApproval`, `save`, and audit methods for memory and SQLite. `approvePreparedAction()` exists in `@msl/tools`, but it is generic and mutates expired actions to `expired`; an MCP approval-recording slice should avoid broad generic approval exposure and should pre-validate that the target is a supported prepared `sync_product` proposal before writing approval state.

### Affected Areas
- `packages/mcp/src/index.ts` — owns MCP tool registration, auth, exact-ID status lookup, sync proposal shape detection, redacted responses, and the no-execution boundary.
- `packages/mcp/src/runtimeDependencies.ts` — currently injects the approval repository and clock; approval IDs may need an MCP-local deterministic/id-generator dependency if not generated inline.
- `packages/tools/src/index.ts` — exposes repository methods and generic approval helper; useful reference, but direct MCP use must avoid approving non-sync proposals.
- `packages/domain/src/approval.ts` — defines `ApprovalRecord` fields and `canExecutePreparedAction()` invariants that approval records should satisfy for future execution slices.
- `packages/mcp/src/mcp.test.ts` — should cover schema, auth-before-lookup, redacted unavailable cases, pending-only approval recording, expiry handling, duplicate/approved handling, and no mutation API/import/tool exposure.
- `packages/mcp/src/mcp.integration.test.ts` — should cover SDK-level approval recording without execution, storage redaction, and repository call boundaries.
- `openspec/specs/custom-business-mcp-tools/spec.md` — should add a narrow approval-recording-only MCP operation for prepared `sync_product` proposals.
- `openspec/specs/action-approval-safety/spec.md` — should clarify that approval may be recorded without execution/audit replay, while execution remains deferred.

### Approaches
1. **Narrow MCP approval-recording tool** — Add a tool such as `approve_sync_product_proposal` that accepts one exact action ID, authenticates first, reads the repository, verifies the stored entry is a supported unexpired pending `sync_product` proposal, saves an approved action plus matching `ApprovalRecord`, and returns sanitized approval metadata with `noMutationExecuted: true`.
   - Pros: Fits the approved slice; reuses existing repository contract; keeps execution out; can preserve anti-enumeration by returning the same unavailable response for missing, unsupported, expired, rejected, or already-finalized records.
   - Cons: Mutates local approval state; must carefully avoid leaking approval IDs, seller IDs, DB paths, source/target seller IDs, or generic prepared-write payloads.
   - Effort: Medium

2. **Expose generic `approvePreparedAction()` through MCP** — Register a generic approval tool backed by the existing helper.
   - Pros: Less new domain code; aligns with existing helper semantics.
   - Cons: Too broad for this slice; may approve non-sync prepared writes; helper mutates expired actions; harder to maintain anti-enumeration and sync-only scope.
   - Effort: Low/Medium

3. **Bundle approval recording with sync execution** — Record approval and immediately execute product sync.
   - Pros: Completes the business workflow sooner.
   - Cons: Explicitly violates this slice boundary by crossing into MercadoLibre mutations, audit execution, `ProductSyncEngine`, rollback, and multi-boundary risk.
   - Effort: High

### Recommendation
Proceed with Approach 1. Specify and implement a sync-only approval-recording MCP tool that authenticates before lookup, accepts only an exact action ID, validates the stored entry with the same `sync_product` support predicate used by status retrieval, records approval state only for pending unexpired proposals, and returns sanitized metadata proving no MercadoLibre mutation, audit replay, `ProductSyncEngine`, `sync_all`, or multi-product sync occurred.

Prefer a local MCP helper over directly exposing generic approval execution. If `approvePreparedAction()` is reused internally, wrap it with strict sync-only prevalidation and consider avoiding its expired-state mutation by handling expired proposals as a redacted unavailable/blocked response before calling it.

### Risks
- Approval recording is a local mutation; tests must prove it only writes approval state and never calls audit, execution, MercadoLibre clients, or sync engines.
- Generic repository records can contain sensitive caller-provided data; the tool must only operate on recognized `sync_product` proposal shape and sanitize responses.
- Missing/unsupported/expired/already-finalized IDs can become enumeration signals unless they share controlled redacted responses.
- Future execution slices may rely on `ApprovalRecord` invariants, so approval records must match action ID, seller ID, exact changes, and high risk exactly.

### Ready for Proposal
Yes — tell the user the next OpenSpec proposal should be approval-recording-only for exact existing prepared `sync_product` proposals. Keep execution, audit replay, MercadoLibre mutations, `ProductSyncEngine`, `sync_all`, and multi-product sync explicitly out of scope.
