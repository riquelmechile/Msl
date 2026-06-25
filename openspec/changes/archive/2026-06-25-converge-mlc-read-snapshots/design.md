# Design: Converge MLC Read Snapshots

## Technical Approach

Make `@msl/mercadolibre` consume canonical read-snapshot vocabulary from `@msl/domain` without changing runtime reads. The MLC package keeps exported names such as `MlcReadSnapshot`, `MlcListingsSnapshot`, and `MlcReadSnapshotFreshness`, but those types become narrowed aliases of domain `ReadSnapshot`, `CacheFreshness`, and related fields. The local freshness helper delegates to domain `evaluateFreshness` with `source: "mercadolibre-api"` so listing/order/message/reputation freshness windows stay behavior-compatible while policy duplication disappears.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Dependency direction | Add `@msl/domain` as a one-way dependency/reference of `@msl/mercadolibre`. | Keep structural duplication; expose only domain types from tools. | Domain already owns `ReadSnapshot`/freshness and is dependency-free. Importing inward resolves drift with minimal public API churn. |
| Public API compatibility | Preserve MLC-specific exported names as type aliases/intersections. | Rename callers to `ReadSnapshot` only; remove aliases. | Existing `@msl/tools` and tests import MLC names. Aliases give convergence without source-breaking callers. |
| Source narrowing | Keep MLC snapshots constrained to `source: "mercadolibre-api"`. | Accept every domain `ReadSnapshotSource`. | MLC client returns direct API reads; widening to `local-cache` or `seller-input` would hide boundary errors. |
| Freshness policy | Replace local max-age/risk constants with `evaluateFreshness`. | Keep `createFreshness` logic duplicated. | Domain already maps listing to medium and order/message/reputation to critical, matching current behavior. |

## Data Flow

```text
MercadoLibre transport payload
  -> normalizeListings/orders/messages/reputation
  -> createMlcFreshness(kind, now)
  -> domain evaluateFreshness(source: mercadolibre-api)
  -> MLC alias of domain ReadSnapshot
  -> @msl/tools metadata passthrough
```

No OAuth, approval, write, persistence, or UI path is in scope.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/mercadolibre/package.json` | Modify | Add `@msl/domain` workspace dependency. |
| `packages/mercadolibre/tsconfig.json` | Modify | Add project reference to `../domain` for `tsc -b` ordering. |
| `packages/mercadolibre/src/index.ts` | Modify | Import domain types/helpers; redefine MLC snapshot/freshness exports from domain vocabulary; delegate freshness creation to `evaluateFreshness`; keep normalizers and API client behavior unchanged. |
| `packages/mercadolibre/src/mercadolibre.test.ts` | Modify | Add focused checks that normalized snapshots still expose current metadata and alias compatibility with domain `ReadSnapshot`/freshness. |
| `packages/tools/src/index.ts` | Modify if needed | Keep current imports unless TypeScript requires minor alias adjustments; no behavior changes. |
| `tests/tools/tools.integration.test.ts` | Modify | Optionally type the fixture through exported MLC alias and/or domain `ReadSnapshot` to prove cross-package compatibility. |
| `package-lock.json` | Modify | Reflect the new workspace dependency metadata. |

## Interfaces / Contracts

```ts
type MlcReadSnapshotFreshness = CacheFreshness & {
  source: "mercadolibre-api";
  signalKind: MlcReadSnapshotKind;
  risk: "medium" | "critical";
};

type MlcReadSnapshot<TData> = ReadSnapshot<TData> & {
  source: "mercadolibre-api";
  kind: MlcReadSnapshotKind;
  freshness: MlcReadSnapshotFreshness;
};
```

`MlcReadSnapshotKind`, completeness, and confidence should derive from domain field types where practical, with MLC narrowing applied only for API-source constraints.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | MLC normalization still emits listing/order/message/reputation metadata, freshness risk/status, completeness, and confidence. | Extend `packages/mercadolibre/src/mercadolibre.test.ts`; use compile-time assignments plus runtime metadata assertions. |
| Integration | `@msl/tools` read tools still pass snapshot freshness/confidence through unchanged and blocked reads stay blocked. | Keep/adjust `tests/tools/tools.integration.test.ts`; avoid write/OAuth behavior edits. |
| Build/Quality | Package graph and public exports remain valid. | Run `npm run typecheck`, `npm test`, `npm run lint`, and `npm run format:check`. |

## Migration / Rollout

No migration required. This is a behavior-neutral type/helper refactor. Rollback is a straight revert of MLC dependency metadata, type aliases, and freshness helper delegation.

## Open Questions

None.
