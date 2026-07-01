# Proposal: Sync Product Execution Contract

## Intent

The sync_product pipeline (prepare→approve→readiness) has no definition of what execution means after readiness declares `eligible`. Formalize the execution model using real MercadoLibre API evidence without writing runtime mutation code.

## Scope

### In Scope
- Execution eligibility contract: approved + readiness-eligible + idempotency-keyed, not previously executed
- Create vs update semantics: POST /items for new listings, PUT /items/{id} for existing
- Rollback model: compensating actions per real API (pause active, close final, republish via relist)
- Idempotency: project-owned via audit records, per-listing candidate keys from proposal actionId
- Audit trail: ML API call payload, response, generated itemId, permalink, KPIs, rollback path
- Package boundary: mercadolibre owns API calls, tools owns repository, MCP orchestrates, domain owns guards
- Declare `ProductSyncEngine` obsolete for approved execution path
- Capability matrix: add create, update, status-change, rollback entries

### Out of Scope
- Runtime mutation code (no publishItem/updateItem calls)
- Readiness evidence provider upgrade
- Execution MCP tool implementation
- TypeScript runtime types or interfaces
- Multi-product/bulk sync execution

## Capabilities

### New Capabilities
- `sync-product-execution`: Execution contract bridging readiness eligibility to safe MercadoLibre mutation — defines eligibility gates, create-vs-update semantics, rollback/recovery model, idempotency, audit trail, and package boundaries

### Modified Capabilities
- `ml-api-integration`: Write Operations refined for create-vs-update contract; Product Sync Engine declared obsolete for approved execution; Capability Classification Matrix extended with create/update/status-change/rollback entries with real API evidence; Readiness Evidence tied to concrete API capability
- `action-approval-safety`: Product Sync Proposals Remain Pending replaced by execution eligibility model; Readiness Approval Boundary extended to execution eligibility; Risk Audit Trail extended with execution audit records
- `custom-business-mcp-tools`: Readiness tool `eligible` status feeds execution contract; future execution tool contract defined

## Approach

Approach 1 from exploration: spec+design contract only. Write delta specs formalizing execution semantics using real POST/PUT /items evidence from official MercadoLibre docs. No runtime code. Package boundary: `mercadolibre` calls APIs, `tools` manages repository, `mcp` orchestrates, `domain` enforces sync-specific guards (`canExecuteSyncProduct` replacing generic `canExecutePreparedAction`).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/specs/ml-api-integration/` | Modified | Write ops, capability matrix, ProductSyncEngine obsolescence |
| `openspec/specs/action-approval-safety/` | Modified | Execution eligibility, audit extension |
| `openspec/specs/custom-business-mcp-tools/` | Modified | Readiness→execution bridge |
| `packages/domain/src/approval.ts` | Design-only | `canExecuteSyncProduct` contract |
| `packages/mercadolibre/src/sync/syncEngine.ts` | Design-only | Obsolete declaration |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Rollback misread as undo | Medium | Define compensating actions explicitly; no undo claim |
| Idempotency leaks across proposals | Low | Per-actionId candidate keys, audit existence check |
| ProductSyncEngine direct use bypasses contract | Low | Explicit obsolescence in spec, safe path in design |
| Listing type assumption (`free`/`gold_special`/`gold_pro`) | Low | Contract references `listing_type_id` as variable |

## Rollback Plan

Delta specs are additive — revert by removing delta files from change folder. No runtime code.

## Dependencies

- MercadoLibre API docs (POST /items, PUT /items/{id}, status flow, relist) — obtained via official MCP

## Success Criteria

- [ ] Execution eligibility gates: approved + readiness-eligible + idempotency-keyed + not-previously-executed
- [ ] Create vs update uses real POST/PUT endpoints with idempotency model
- [ ] Rollback model: pause active → close (final warning) → republish via relist
- [ ] Package boundary assigns API, orchestration, repo, and guards to correct packages
- [ ] ProductSyncEngine declared obsolete for approved execution path
- [ ] Capability matrix extended with create, update, status-change, rollback entries
