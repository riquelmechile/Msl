# Design: Sync Product Execution Contract

## Technical Approach

The execution contract bridges readiness eligibility (`read_sync_product_execution_readiness` returns `eligible`) to safe ML API mutation. MCP orchestrates the sequence: readiness gate → idempotency guard → create/update resolution → ML API call → audit. No runtime code — this is a contract-only artifact defining boundaries, types, and flow that future implementation slices reference.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Execution guard | `domain.canExecuteSyncProduct`: checks `approved` + `readiness-eligible` + not previously executed | Extend `canExecutePreparedAction` | Sync-product needs additional readiness/idempotency gates beyond generic approval; separate guard keeps concerns isolated |
| Existence resolution | Query `SyncStore.listSynced` for existing target listing map; fallback to ML `getItems` on target | Blind POST with upsert; always query API | Sync store already maps source→target from prior syncs; avoids unnecessary API calls; API fallback covers non-synced listings |
| Idempotency candidate key | `execution:{actionId}` — keyed on proposal actionId, checked via `ApprovalQueueRepository.listAudits` | Timestamp-based; content-hash | actionId is already unique per proposal; audit existence check is O(1) with SQLite primary key |
| Audit execution fields | Extend `AuditRecord` with optional `mlEndpoint`, `mlItemId`, `mlPermalink`, `preSnapshot`, `postSnapshot`, `rollbackPath` | Separate `ExecutionAudit` type | Co-locating in existing `AuditRecord` avoids type proliferation; optional fields keep non-sync audits unaffected |
| Rollback model | Strategy specification: `{ type: "pause" \| "close" \| "relist"; itemId: string; note: string }[]` — stored in audit, not auto-executed | Auto-rollback on failure | Compensating actions need seller awareness; spec-only ensures rollback path is documented without risky automation |
| `listing_type_id` | Variable from seller config, passed through proposal evidence field `listingTypeId` | Default to `gold_special` | Different seller tiers have different listing types; hardcoding would produce wrong listings |

## Data Flow

```
MCP Tool (future: execute_sync_product)
  │
  ├─1─→ domain.canExecuteSyncProduct(action, approval, auditRepo)
  │      └─ checks: approved, readiness-eligible, not yet executed
  │
  ├─2─→ tools idempotency: repository.listAudits(actionId)
  │      └─ returns "already-executed" if audit with status "executed" exists
  │
  ├─3─→ mercadolibre resolve: SyncStore.listSynced(source, target)
  │      └─ maps source itemId → existing target itemId (or null = new)
  │
  ├─4─→ mercadolibre execute:
  │      ├─ new → mlClient.publishItem(targetSellerId, payload)
  │      └─ existing → mlClient.updateItem(targetSellerId, itemId, payload)
  │
  └─5─→ tools audit: repository.saveAudit(executionRecord)
         └─ pre/post snapshots, ML evidence, rollback path
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/approval.ts` | Modify | Add `canExecuteSyncProduct` guard with readiness + idempotency gates |
| `packages/mercadolibre/src/sync/syncEngine.ts` | Modify | Annotate `ProductSyncEngine` as obsolete for approved execution path |
| `packages/tools/src/index.ts` | Modify | Extend `AuditRecord` with execution fields; define `ExecutionCandidateKey` |
| `packages/mercadolibre/src/types.ts` | Modify | Add `listing_type_id` to `NewItem` as optional variable field |

## Interfaces / Contracts

**Execution eligibility gate** (`domain`):
```typescript
type SyncExecutionDecision =
  | { allowed: true }
  | { allowed: false; reason: "not-approved" | "not-ready" | "already-executed" | "expired" };

function canExecuteSyncProduct(
  action: PreparedAction,
  approval: ApprovalRecord,
  readinessStatus: "eligible" | "blocked" | "degraded",
  priorAudits: readonly AuditRecord[],
  now: Date,
): SyncExecutionDecision;
```

**Execution audit record extension** (`tools`): `AuditRecord` gains optional fields: `mlEndpoint` (string), `mlItemId` (string), `mlPermalink` (string), `preSnapshot` (unknown), `postSnapshot` (unknown), `rollbackPath` ({ type, itemId, note }[]).

**Idempotency candidate key**: `execution:{actionId}` — derived from proposal actionId, checked via `listAudits` filtering for `status: "executed"` with matching `actionId`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `canExecuteSyncProduct` gate combinations | Vitest — all 4 gate branches (not-approved, not-ready, already-executed, allowed) |
| Unit | Idempotency key collision | Vitest — same actionId saved twice, second returns "already-executed" |
| Integration | Audit record round-trip with execution fields | Vitest — SQLite in-memory, save and retrieve with new optional fields |
| Contract | `ProductSyncEngine` obsolescence assertion | TypeScript: ensure approved execution flow cannot import `ProductSyncEngine` at type level |

## Migration / Rollout

No migration required — contract-only artifact. `ProductSyncEngine` remains for bulk/differential sync; obsolescence applies only to the approved execution path.

## Open Questions

- [ ] Should `SyncStore` listing map be the sole existence source, or should execution always re-query ML API for authoritative listing state?
- [ ] Should `listing_type_id` be part of `NewItem` type or carried as a separate parameter in `publishItem`?
