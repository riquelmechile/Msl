## Exploration: sync-product-execution-contract

### Current State

The `sync_product` pipeline runs through three existing phases, each with a completed implementation slice:

1. **Prepare** (`sync_product` in `packages/mcp/src/index.ts`): validates MCP auth, Plasticov→Maustian seller roles, one MLC item ID, `risk: "high"`, and `requiresApproval: true`; optionally computes read-only preview evidence via `buildSyncProductPreview` (which uses `assertCompleteMlcItem` + `previewStrategyChanges`); creates a `PreparedAction` with `approvalStatus: "pending"` and stores it via the `ApprovalQueueRepository`; returns `noMutationExecuted: true`.

2. **Approve** (`approve_sync_product_proposal`): records seller approval for one exact stored pending sync proposal. Creates an `ApprovalRecord` with `executionStatus: "not-executed"` and `exactChangeAccepted`. Does NOT execute mutations.

3. **Readiness** (`read_sync_product_execution_readiness`): evaluates one approved proposal through: approval binding checks, preview drift detection, seller/account scope, target availability, idempotency candidate derivation, rollback strategy evidence, and API capability evidence. Returns `eligible | blocked | degraded` with `noMutationExecuted: true`. Currently both `readApiCapabilityEvidence` and `readRollbackStrategyPresent` default to `"missing"` / `false` respectively in `runtimeDependencies.ts`.

The underlying MercadoLibre package (`packages/mercadolibre/src/index.ts`) has mutation-capable `MlClient` methods (`publishItem`, `updateItem`, `changeItemStatus`) and a full `ProductSyncEngine` (`packages/mercadolibre/src/sync/syncEngine.ts`) that calls `publishItem` directly — without approval checks, readiness gates, or execution audit contracts. The MCP runtime intentionally does NOT import `ProductSyncEngine` and enforces `noMutationExecuted: true`.

The domain layer (`packages/domain/src/approval.ts`) provides `canExecutePreparedAction` which validates basic approval status, expiry, and exact-change matching — but it is a generic write guard, not a MercadoLibre-specific sync execution contract.

**Real API evidence is now available** (retrieved via official MercadoLibre MCP docs):
- **POST /items** creates new items (required: title, category_id, price, currency_id, available_quantity, buying_mode, listing_type_id, condition, pictures).
- **PUT /items/{id}** updates existing items (title only when sold_quantity=0; price blocked if auto-pricing active since Mar 2026; stock; status active/paused/closed; description; images).
- **Status flow**: `active ↔ paused (out_of_stock) → closed` (final, not reversible).
- Used items in fashion/sports: max qty=1, closes after sale.
- **No built-in undo**: closed items can be republished via relist. Delete requires close first then delete.
- **listing_type**: `free`, `gold_special`, `gold_pro` (varies by site/seller).

### Affected Areas

- `openspec/specs/ml-api-integration/spec.md` — has write operations spec (`publishItem`, `updateItem`, `ProductSyncEngine`) but lacks an execution contract linking approval→readiness→execution with real API semantics.
- `openspec/specs/custom-business-mcp-tools/spec.md` — defines prepare/status/approval/readiness MCP tools; needs execution contract requirements specifying what the next MCP operation layer looks like.
- `openspec/specs/action-approval-safety/spec.md` — has `Product Sync Proposals Remain Pending` and `Sync Product Readiness Approval Boundary` requirements; needs execution eligibility and audit requirements once readiness gate passes.
- `packages/mcp/src/index.ts` — houses all sync_product tools; will eventually host execution-related MCP operations that sit behind the contract gates.
- `packages/mcp/src/runtimeDependencies.ts` — currently hardcodes `readApiCapabilityEvidence: () => "missing"` and `readRollbackStrategyPresent: () => false`; the contract defines what providers must produce.
- `packages/mercadolibre/src/index.ts` — `MlClient` has `publishItem`, `updateItem`; the contract defines what shape these calls take in execution vs. the current ad-hoc sync engine.
- `packages/mercadolibre/src/sync/syncEngine.ts` — `ProductSyncEngine` calls `publishItem` directly without approval; the contract defines how future execution differs from this engine.
- `packages/tools/src/index.ts` — has `ApprovalQueueRepository`, `executePreparedAction`, `DirectWriteExecutor`; the contract defines whether sync execution uses these paths or a different seam.
- `packages/domain/src/approval.ts` — `canExecutePreparedAction` is generic; the contract defines MercadoLibre-specific execution guards (idempotency, create-vs-update, rollback strategy).

### Approaches

1. **Spec+design execution contract only (no runtime code)** — Create OpenSpec delta specs and a design document that formalizes the execution model using real API evidence WITHOUT implementing any runtime code. The contract defines:
   - Execution eligibility gates (approved + readiness-evaluated + idempotency-keyed).
   - Create vs. update semantics using real API distinction (POST for new, PUT for existing).
   - Rollback model reflecting real API constraints (no undo, closed=final, republish via relist only for closed items, pause for active items).
   - Idempotency model using per-listing execution candidate keys (`sync-product:MLC{id}:{timestamp}` with create-once and update-by-id semantics).
   - Audit model (what gets recorded at each step, KPI snapshots, rollback evidence).
   - Package boundary: what stays in MCP vs. mercadolibre vs. tools vs. domain.
   - MercadoLibre capability matrix updates for create/update/status/rollback areas with real evidence.
   - **Pros**: zero risk of accidental mutation, preserves all existing safety boundaries, gives downstream phases a concrete contract to implement, validates the execution model against real API constraints before any code runs.
   - **Cons**: does not produce executable behavior, may feel like another process artifact.
   - **Effort**: Medium

2. **Execution contract + readiness evidence upgrade** — Extend approach 1 by also upgrading the existing `readinessEvidence` providers to return real evidence based on the contract definitions. The readiness gate would actually return `apiCapabilityEvidence: "present"` and `rollbackStrategyPresent: true` for proposals that meet the contract shape.
   - **Pros**: makes readiness evaluation meaningful before execution, proves the contract is wired correctly.
   - **Cons**: introduces runtime behavior for evidence providers (still no actual mutations), blurs the contract-only boundary, adds testing burden for evidence providers that touch real API knowledge.
   - **Effort**: Medium-High

3. **Execution contract with types-only runtime skeleton** — Create the OpenSpec contract plus TypeScript types/interfaces for the future execution surface (execution result types, rollback strategy types, idempotency key types, audit types) without implementing execution logic.
   - **Pros**: gives the codebase a future seam, makes the contract concrete in TypeScript.
   - **Cons**: types without implementation are dead code, increases risk of someone wiring up the execution path prematurely, conflicts with the hard boundary against runtime code.
   - **Effort**: Medium

### Recommendation

Proceed with **Approach 1: Spec+design execution contract only**. This is the correct next slice because:

1. **It addresses the critical gap**: The pipeline has prepare→approve→readiness but no definition of what execution MEANS. The contract formalizes the execution model before any code runs, which is exactly where the project should be.

2. **Real API evidence is now available**: The earlier readiness slice returned `api-capability-evidence-missing` because docs weren't available. Now they are. The contract must incorporate real endpoint semantics (create vs. update, status flow, rollback constraints, idempotency behavior) so downstream phases don't design against assumptions.

3. **It preserves the safety boundary**: No mutation code is generated. The contract is purely specification and design — the hard boundary in the task description is respected.

4. **It enables downstream execution slices**: A well-defined contract lets `sdd-apply` phases wire up real execution safely because the contract answers: what to execute, how, when, what happens on failure, and what audit evidence must exist.

The minimum content the contract must cover:
- **Execution eligibility**: approved + readiness-eligible + idempotency key not previously executed.
- **Create vs. update semantics**: new listings use POST /items (idempotent by proposal actionId, not by ML itemId), existing listings use PUT /items/{id}.
- **Rollback/recovery model**: pause active items (reversible status change), close items with `closed=final` warning, republish via relist for closed items. Define compensating actions, not "undo."
- **Idempotency**: per-listing execution candidate keys derived from proposal actionId, not ML API-side idempotency. Define what "already executed" looks like (audit record exists with status !== blocked).
- **Audit trail**: execution audit records must capture what was sent to ML, what API response came back, the generated itemId, permalink, the pre-execution snapshot KPI, and the rollback path.
- **Package boundary**: 
  - `packages/mercadolibre` — owns the ML API call (POST/PUT via `MlClient`) but does NOT own decision-making, idempotency, or audit.
  - `packages/tools` — owns the `ApprovalQueueRepository` (find action, find approval, save audit) but does NOT own ML API calls.
  - `packages/mcp` — owns the tool surface that orchestrates: validate readiness → check idempotency → resolve create-vs-update → call mercadolibre → record audit. This is the execution boundary.
  - `packages/domain` — `canExecutePreparedAction` must evolve to `canExecuteSyncProduct` with MercadoLibre-specific guards.
- **MercadoLibre capability matrix update**: Add create, update, status-change, and relist entries to the capability classification matrix with real API evidence.
- **Rate/error handling**: retry semantics for 429/5xx, reconnect-required handling, partial execution detection (API succeeded but audit write failed vs. API failed but audit was recorded).

### Risks

- The `ProductSyncEngine` in `syncEngine.ts` does not use approval or readiness; it publishes directly. The contract must explicitly name this engine as obsolete for approved execution and define a different path.
- Rollback is not an "undo" button — MercadoLibre has no built-in rollback. The contract must define compensating actions (pause for active, republish for closed) rather than implying reversibility.
- Idempotency cannot rely on MercadoLibre API-level idempotency keys (those are not exposed in the docs). The contract must define project-own idempotency via audit records.
- `MlClient.publishItem` currently uses POST /items with `NewItem` type. The contract must define whether execution through `MlClient` is acceptable or requires a new client method with better contracts.
- The existing `executePreparedAction` in `packages/tools/src/index.ts` routes through `DirectWriteExecutor` — a generic executor interface. The contract must decide whether sync execution uses this path or a dedicated sync executor seam.
- Listing type (`free`/`gold_special`/`gold_pro`) varies by site/seller; the contract must not assume a default.

### Ready for Proposal

Yes — propose a spec+design OpenSpec change. The orchestrator should tell the user this slice defines the sync product execution contract (eligible gates, create-vs-update semantics, rollback/recovery model using real API constraints, idempotency model, audit model, and package boundary) without producing runtime mutation code. It builds on real MercadoLibre API evidence and bridges the gap between readiness evaluation and future safe execution.
