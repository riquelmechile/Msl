# Proposal: Jinpeng Supplier Runtime Enablement

## Intent

Production-enable the existing Supplier Mirror foundation for the first real supplier, Jinpeng/XKP. This is not new architecture: it safely wires archived capabilities so MSL can validate supplier identity, stock evidence, account defaults, and CEO-confirmed decisions before autonomy.

## Proposal Question Round

Assumptions needing review: confirm seller IDs/credentials outside git, use stable supplier ID `jinpeng`, and choose low-stock threshold 2 or 3.

## Scope

### In Scope
- CLI/admin bootstrap to register Jinpeng, source refs, enrichment URL, target defaults, and pricing.
- Read-only MercadoLibre validation/dry-run using MCP/API-first docs and existing client patterns.
- Seed defaults: Maustian x2.5 with owned/improved titles/descriptions; Plasticov x2; both require CEO confirmation before publish/automation.
- Safety defaults: no secrets, publishing, price updates, unsafe auto-pause, or enabled worker during bootstrap.

### Out of Scope
- Real autonomous publish/pause/price mutation execution.
- WhatsApp catalog automation; manual/future enrichment only.
- Treating XKP website as stock authority.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `supplier-mirror`: add production bootstrap, Jinpeng policy defaults, ML validation, CEO confirmation gates, and XKP enrichment boundaries.

## Approach

Add a small Node/TypeScript bootstrap around existing Supplier Mirror store/adapters. It upserts Jinpeng metadata, source refs, target policy defaults, and runs bounded read-only validation. MercadoLibre identification uses nickname/profile/seller-id discovery where docs/API support it, reports missing access, and avoids persisting secrets.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/workers/src/supplierMirror` | Modified | Bootstrap/validation entrypoint and disabled execution defaults. |
| `packages/memory/src/supplierMirrorStore.ts` | Modified | Seed supplier, source refs, target policies. |
| `packages/mercadolibre/src/*supplier*` | Modified | ML seller/profile validation. |
| `docs/supplier-mirror.md` | Modified | Operator bootstrap and safety docs. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Wrong supplier identity | Med | Require API/MCP validation or explicit operator seller ID. |
| Unsafe execution | Med | Dry-run by default; worker and mutations require explicit enablement. |
| Overlarge PR | Med | Phase into review slices under 800 changed lines. |

## Rollback Plan

Revert bootstrap code/docs and delete seeded Supplier Mirror rows from the configured DB. External ML listing state should not change because bootstrap is read-only.

## Dependencies

- MercadoLibre credentials supplied via environment; MCP/API docs for item search, stock/price constraints, and notifications.
- XKP products URL for enrichment metadata only.

## Success Criteria

- [ ] Jinpeng bootstrap validates or reports missing ML access without secrets in repo.
- [ ] Both account defaults are seeded as proposals, not autonomous commands.
- [ ] XKP enrichment stores specs/photos/descriptions only, never stock authority.
- [ ] Implementation plan is sliceable under the 800-line review budget.
