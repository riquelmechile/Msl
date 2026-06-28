# Design: Wire MercadoLibre MCP Business Operations

## Technical Approach

Replace the MCP `sync_product` fake success path with a prepare-only proposal path inside `@msl/mcp`. The tool validates MCP auth, configured MLC account direction, request shape, approval metadata, explicit `risk: "high"`, and expiry before saving a pending prepared action through the existing `@msl/tools` approval queue. This slice intentionally does not import or call `ProductSyncEngine`, does not expose `sync_all`, and does not calculate a sync preview.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Prepare-only boundary | Implement `sync_product` as an MCP wrapper around the existing prepared-action queue. | Call `ProductSyncEngine`; add a sync preview tool. | Existing approval tooling already returns `requiresApproval: true`; execution and preview would cross the scoped safety boundary. |
| Account direction | Validate only configured Plasticov source -> Maustian target using `assertPlasticovToMaustianDirection`. | Accept arbitrary seller IDs; infer sellers from caller input. | Prevents reversed syncs and cross-seller access while preserving the MLC-only role contract. |
| Prepared action kind | Use current `listing-edit` prepared action kind with sync-specific rationale and exact-change placeholders. | Add `product-sync` kind now. | Keeps this slice small; a dedicated kind is deferred because it touches domain unions, risk mapping, and downstream specs. |
| Risk validation | Require caller metadata `risk: "high"` before save and block missing or other values. | Make risk optional; infer risk only from `listing-edit`. | The proposal explicitly requires risk metadata validation; this approval-required sync proposal must prove caller intent matches the high-risk prepared action boundary. |
| Runtime dependencies | Extend MCP config with role validation data/env access only; keep approval repository in-memory. | Add persistent approval storage. | Persistence is explicitly deferred; no migration should be introduced in this slice. |

## Data Flow

```text
MCP client
  -> sync_product({ sourceSellerId, targetSellerId, itemId, rationale, expiresAt, requiresApproval, risk, msl_api_key })
  -> validateApiKey
  -> validate source/target via @msl/mercadolibre account roles
  -> require requiresApproval=true and risk="high"
  -> parse strict ISO expiresAt and require future expiry
  -> createPreparedActionTool(...).execute({ kind: "listing-edit", target: { type: "listing", listingId: itemId }, ... })
  -> in-memory ApprovalQueueRepository.save
  -> JSON response with metadata.requiresApproval=true and pending action data
```

Blocked validation returns controlled JSON errors and must not call repository save.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/mcp/src/index.ts` | Modify | Replace `sync_product` stub with prepare-only validation and proposal creation. Add a focused schema/helper for sync proposal input and controlled blocked responses. |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | Ensure role config is available for MCP sync preparation without adding sync executor dependencies. |
| `packages/mcp/src/mcp.test.ts` | Modify | Add behavior tests for proposal creation, blocked auth/direction/expiry/missing approval metadata, missing/invalid risk, no execution tools, and no sync engine imports. |
| `packages/mercadolibre/src/accountRoles.ts` | Modify | Reuse or expose a non-throwing validation helper only if needed by MCP response shaping; keep current strict direction behavior. |
| `packages/tools/src/index.ts` | Modify | Only if needed, add a narrow helper/type for prepared sync proposal creation; do not add execution APIs. |

## Interfaces / Contracts

`sync_product` input should require:

```ts
{
  sourceSellerId: string;
  targetSellerId: string;
  itemId: string; // MLC listing id
  rationale: string;
  expiresAt: string; // strict ISO 8601 UTC
  requiresApproval: true;
  risk: "high";
  msl_api_key?: string;
}
```

`risk` is required input metadata for `sync_product`; missing risk or any value other than `"high"` is a blocked validation failure and MUST occur before repository save.

Success response: existing `BusinessToolResponse<ApprovalQueueEntry>` serialized through `jsonResult`, with `metadata.requiresApproval: true`, `metadata.source: "seller-input"`, `data.status: "pending"`, and `data.action.approvalStatus: "pending"`.

Blocked response: JSON with `{ status: "blocked", reason, message }` and `isError: true` for auth/validation failures. Messages must not include raw token, client secret, or OAuth values.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `sync_product` saves a pending proposal with target listing and `requiresApproval: true`. | Extend `packages/mcp/src/mcp.test.ts` using mocked registered tools and approval repository. |
| Unit | Invalid API key, reversed direction, arbitrary seller IDs, invalid expiry, missing `requiresApproval: true`, missing/invalid `risk: "high"`, or missing rationale are blocked before save. | Assert controlled JSON response and `save` not called, with explicit cases for missing risk and risk values other than `"high"`. |
| Regression | No mutation execution is exposed. | Assert MCP tool names exclude `sync_all`, `execute_mercadolibre_write`, `executePreparedAction`; grep/import assertion in tests or code review for no `ProductSyncEngine` import in `packages/mcp/src`. |
| Integration | Runtime builds prepare-only dependencies without OAuth read config. | Keep existing runtime dependency tests and add role-config coverage if helper changes. |
| E2E | Not required for this backend MCP slice. | Covered by Vitest and typecheck. |

## Migration / Rollout

No migration required. Roll out by replacing the stub; rollback is reverting MCP wiring/tests to the previous fake success response. Because no MercadoLibre mutations or persistent approval data are introduced, rollback does not require external cleanup.

## Risks and Deferred Work

- Existing `listing-edit` kind is semantically imprecise for product sync; defer a dedicated `product-sync` kind.
- In-memory proposals disappear on restart; defer persistent approval repository migration.
- No sync preview is calculated; sellers approve intent metadata, not computed listing diffs.
- Execution remains deferred: no `ProductSyncEngine`, `sync_all`, audit replay, or write API call path in this slice.

## Open Questions

- [ ] None blocking.
