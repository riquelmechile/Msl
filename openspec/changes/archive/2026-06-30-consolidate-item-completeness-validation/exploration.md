## Exploration: Consolidate Item Completeness Validation

### Current State
MercadoLibre item reads already validate single-item payloads in `packages/mercadolibre/src/index.ts`: `normalizeMlcItemId()` only accepts `MLC` item IDs, `getItem()` reads `/items/{safeItemId}`, and private `normalizeItem()` throws when required `MlItem` fields are missing or invalid. The safe sync preview path in `packages/mcp/src/index.ts` repeats a similar runtime completeness check through private `isCompletePreviewItem()` before calling `previewStrategyChanges()`.

The duplicate MCP check protects injected `SyncPreviewDependency` implementations and tests that can return structurally invalid objects despite the `MlItem` TypeScript type. Runtime production reads are already stricter because `createMcpRuntimeDependencies()` wires `syncPreview.getSourceItem` to `runtimeClient.getItem()`, which normalizes and rejects incomplete payloads in the MercadoLibre package.

### Affected Areas
- `packages/mercadolibre/src/index.ts` — owns MLC item-id validation, single-item reads, private payload normalization, and the best location for shared item completeness semantics.
- `packages/mercadolibre/src/types.ts` — defines `MlItem`; may need exported validation/narrowing helpers without changing the public item shape.
- `packages/mcp/src/index.ts` — currently has duplicate `isCompletePreviewItem()` logic for sync preview dependency output.
- `packages/mcp/src/mcp.test.ts` — covers degraded preview behavior for incomplete source items and crafted item IDs.
- `packages/mcp/src/mcp.integration.test.ts` — covers SDK preview metadata and degraded read errors.
- `packages/mercadolibre/src/mercadolibre.test.ts` — already tests item-read path validation and incomplete source payload rejection.
- `openspec/specs/ml-api-integration/spec.md` — defines MercadoLibre read/sync boundaries and should capture shared item-read completeness behavior if this becomes a change.
- `openspec/specs/action-approval-safety/spec.md` — defines sync preview safety boundaries; should preserve degraded preview behavior for incomplete evidence.

### Approaches
1. **Export a shared MercadoLibre item completeness guard** — Move the duplicated completeness predicate into `@msl/mercadolibre` as a public helper, then use it from both `normalizeItem()` and MCP preview validation.
   - Pros: Single source of truth; keeps business/API payload validity in the MercadoLibre package; preserves MCP defense against malformed injected dependencies; small, reviewable diff.
   - Cons: Exposes a new package API that must stay stable; still leaves private normalization separate from the predicate unless carefully composed.
   - Effort: Low/Medium

2. **Export a shared assertion/normalizer for complete items** — Add an exported function that accepts `unknown`, validates required fields, and returns `MlItem`; use it in `getItem()` and optionally in MCP preview before strategy calculation.
   - Pros: Stronger boundary than a boolean predicate; prevents callers from accidentally ignoring validation; can centralize error wording.
   - Cons: Slightly larger API and tests; MCP may need to avoid leaking assertion error details in degraded preview responses.
   - Effort: Medium

3. **Keep validation local and document the duplication** — Leave `normalizeItem()` private and keep `isCompletePreviewItem()` in MCP as an adapter-level guard.
   - Pros: No public API change; lowest implementation risk.
   - Cons: Duplicated safety logic can drift; future sync preview or sync-engine slices may repeat the same checks again; weakens the intended shared business-logic boundary.
   - Effort: Low

### Recommendation
Proceed with Approach 2 if this becomes a proposal: create a MercadoLibre-owned exported assertion/normalizer for complete MLC item payloads, compose `getItem()` through it, and have MCP preview call it defensively on injected dependency output while mapping validation failures to the existing degraded `source-read-failed` preview reason. This consolidates completeness as business/API boundary logic without widening MCP execution behavior.

Keep the scope narrow: no sync execution, no `ProductSyncEngine` import in MCP, no new preview tool, no behavior change for prepared proposals except relying on the shared validator. If the team wants the smallest possible diff, Approach 1 is acceptable, but an assertion/normalizer is harder to misuse.

### Risks
- Exporting a validation helper creates a package API that future callers may depend on; name it around MLC/MercadoLibre item payload completeness, not generic domain completeness.
- MCP must continue redacting raw read/validation failures and return only `source-read-failed` for degraded preview evidence.
- `normalizeItem()` currently accepts raw MercadoLibre payloads while MCP receives a typed `MlItem`; the shared API must support both without weakening runtime checks.
- Tests should prove the prepared-action safety boundary remains unchanged: pending approval, no mutation, no audit replay, and no sync-engine coupling.

### Ready for Proposal
Yes — tell the user the safe next slice is to consolidate item completeness validation inside `@msl/mercadolibre` and consume it from MCP sync preview as a defensive read-boundary check, preserving the existing prepare-only safety behavior.
