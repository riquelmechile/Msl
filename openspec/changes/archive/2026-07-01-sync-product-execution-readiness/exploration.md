## Exploration: sync-product-execution-readiness

### Current State
`sync_product` in `packages/mcp/src/index.ts` is prepare-only: it authenticates MCP calls, validates one MLC item, enforces Plasticov source → Maustian target roles, requires `requiresApproval: true` and `risk: "high"`, records a prepared `listing-edit` proposal, attaches optional read-only preview evidence, and reports `noMutationExecuted: true`. `read_sync_product_status` is exact-ID/read-only, and `approve_sync_product_proposal` records seller approval only; it persists an `ApprovalRecord` with `executionStatus: "not-executed"` and does not write audits or call `ProductSyncEngine`.

The underlying MercadoLibre package has mutation-capable pieces (`createMlClient.publishItem`, `updateItem`, `ProductSyncEngine.syncProduct`) and retry/backoff for 429/5xx, but the MCP runtime intentionally does not import `ProductSyncEngine` or expose execution tools. Existing specs require product sync proposals to remain pending unless a future approved execution slice adds explicit execution, approval, and audit behavior. The generic MCP resource/template list exposed no MercadoLibre documentation resources in this session, so direct external API capability evidence was unavailable through the environment.

### Affected Areas
- `openspec/specs/custom-business-mcp-tools/spec.md` — defines current prepare/status/approval-only MCP surface and must receive readiness-only requirements before execution.
- `openspec/specs/action-approval-safety/spec.md` — defines approval/audit invariants and must clarify execution eligibility, approval binding, idempotency, dry-run/revalidation, and audit semantics.
- `openspec/specs/ml-api-integration/spec.md` — contains write-capable client and sync engine contracts but lacks execution-readiness gates for API evidence, rollback, and mutation safety.
- `packages/mcp/src/index.ts` — current MCP boundary for `sync_product`, status, and approval recording; future readiness tooling would live here without calling mutation APIs.
- `packages/mcp/src/runtimeDependencies.ts` — currently wires approval storage, optional read client, account roles, and preview strategies; readiness checks may need injected read-only dependencies.
- `packages/tools/src/index.ts` — approval repository persists actions, approvals, and audits; readiness must define whether audit records are only planned or can record blocked readiness evaluations.
- `packages/mercadolibre/src/index.ts` — has direct API transport, OAuth-bound reads, and stub write methods; future execution needs documented API support and safer write contracts.
- `packages/mercadolibre/src/sync/syncEngine.ts` — can publish transformed listings and update sync state, but lacks rollback/idempotency contracts suitable for approved proposal execution.
- `packages/mcp/src/mcp.test.ts` and `packages/mercadolibre/src/sync/sync.test.ts` — existing tests prove non-execution and sync engine behavior; readiness tests should preserve those boundaries.

### Approaches
1. **Readiness-only contract slice** — add an OpenSpec proposal/spec for a non-mutating execution-readiness evaluation for approved `sync_product` proposals.
   - Pros: preserves the current safety boundary, creates explicit gates before real mutations, can test approval binding, revalidation, stale/expired/changed evidence, seller roles, idempotency keys, and documentation-evidence absence without touching MercadoLibre state.
   - Cons: does not execute seller mutations yet; may feel like another process layer if not kept narrow.
   - Effort: Medium

2. **Execution skeleton behind a disabled gate** — add hidden execution interfaces and keep them disabled until API evidence is complete.
   - Pros: starts shaping the future execution seam and may reveal integration gaps earlier.
   - Cons: increases risk of accidental mutation surface, conflicts with current specs forbidding execution tools, and lacks enough external API evidence/rollback semantics today.
   - Effort: High

### Recommendation
Proceed with **readiness-only contract slice**. The repo is not ready for real MercadoLibre mutation execution because the MCP runtime intentionally excludes execution surfaces, the current official/API documentation source was not available via MCP resources, and the sync engine lacks explicit rollback, idempotency, dry-run/revalidation, and execution audit contracts. The next proposal should define a non-mutating readiness gate for approved `sync_product` proposals that returns eligible/blocked/degraded readiness with exact reasons and `noMutationExecuted: true`.

Minimum prerequisites to capture in the proposal/spec:
- API capability evidence: document exact MLC item publish/update behavior and required fields before any execution slice.
- Approval binding: readiness MUST require one exact approved, unexpired `sync_product` proposal and prove approval/action/rationale/risk linkage.
- Dry-run/revalidation: readiness MUST re-read source item evidence, re-run completeness validation and strategy preview, and detect drift from the approved proposal.
- Seller/account safeguards: source/target roles MUST still be Plasticov → Maustian on MLC and token scope must not cross accounts.
- Idempotency: readiness MUST define a stable execution candidate key and block duplicate/ambiguous execution attempts.
- Rollback strategy: before execution, define whether rollback is pause/delete/update/compensating action, what evidence is needed, and what is not reversible.
- Audit semantics: readiness MAY record non-mutating readiness audits only if clearly distinct from execution audits; otherwise it should return evidence without writing audits.
- Rate/error handling: readiness MUST account for 429/5xx retry/backoff, reconnect-required, seller mismatch, partial reads, and redacted failures.
- Tests: preserve no `ProductSyncEngine`, no `sync_all`, no mutation API calls, no audit replay, and no credential/raw storage leakage from readiness responses.

### Risks
- Treating approval as permission to execute would bypass missing readiness contracts.
- Product publication/update rollback may not be fully reversible; compensation must be specified before mutation.
- Readiness revalidation can drift from the approved preview and must block rather than silently update the approved action.
- Existing `ProductSyncEngine` publishes and marks sync state but does not model execution candidates, rollback, or idempotency.
- External MercadoLibre API evidence was unavailable through MCP resources in this session, so API-specific mutation claims must not be assumed.

### Ready for Proposal
Yes — propose a readiness-only OpenSpec change. The orchestrator should tell the user this slice should define and test execution-readiness gates for approved `sync_product` proposals while explicitly forbidding real MercadoLibre mutations, `ProductSyncEngine` calls, `sync_all`, and execution/audit replay.
