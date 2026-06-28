# Design: MercadoLibre API Capabilities Refresh

## Technical Approach

Create a project-owned capability matrix and read-first contracts before adding endpoints. The first implementation slice should update OpenSpec/domain contracts only, then later slices can add runtime safe reads behind `@msl/mercadolibre` → `@msl/tools` → `@msl/mcp`. The official Mercado Libre MCP remains documentation lookup only; runtime seller data continues through OAuth-backed direct API clients and project-owned tools.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Capability source of truth | Add the matrix to `openspec/specs/ml-api-integration/spec.md`, with cross-references in MCP tools, account integration, approval safety, and insights specs. | Put the matrix in code first or in official MCP docs only. | Specs are the safest first slice, reviewable under 400 lines, and prevent docs-derived classifications from becoming execution paths. |
| Runtime ownership | Keep docs classification separate from runtime capability execution. `docs-only` never maps to a tool; `safe-read` may map to `MlcApiClient`/`createMlcReadTools`; `prepare-only` maps only to prepared actions; `future-execute-with-approval` stays non-executable until a later approved slice. | Generate tools directly from the docs matrix. | Avoids widening mutation execution and preserves approval/audit boundaries. |
| Data model | Extend existing read snapshot vocabulary rather than introducing a parallel evidence model. | Create a separate capability/evidence package. | `ReadSnapshot`, freshness, confidence, and blocked responses already exist and are tested. |
| Delivery | Chain runtime work after the spec/matrix slice. | Implement specs plus endpoints/tools in one PR. | Endpoint DTOs, normalizers, MCP registrations, and tests will likely exceed the 400-line review budget. |

## Data Flow

```text
Official ML MCP/docs ──reference only──> capability matrix/specs
                                             │
safe-read classification ────────────────────┘
                                             ↓
@msl/mercadolibre OAuth read client ─→ @msl/tools read tools ─→ @msl/mcp read_* tools
                                             │
prepare-only classification ────────────────→ prepared action tool ─→ approval/audit only
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/mercadolibre-api-capabilities-refresh/design.md` | Create | This design artifact. |
| `openspec/changes/mercadolibre-api-capabilities-refresh/specs/ml-api-integration/spec.md` | Create later | Delta spec defining the capability matrix and classification semantics. |
| `openspec/changes/mercadolibre-api-capabilities-refresh/specs/custom-business-mcp-tools/spec.md` | Create later | Delta spec for exposing only project-owned safe reads/prepared actions. |
| `openspec/changes/mercadolibre-api-capabilities-refresh/specs/mercadolibre-account-integration/spec.md` | Create later | Delta spec preserving OAuth, MLC seller, and mismatch protections. |
| `openspec/changes/mercadolibre-api-capabilities-refresh/specs/action-approval-safety/spec.md` | Create later | Delta spec locking mutation/public actions behind approval and audit. |
| `openspec/changes/mercadolibre-api-capabilities-refresh/specs/seller-business-insights/spec.md` | Create later | Delta spec requiring freshness/confidence metadata in recommendations. |
| `packages/domain/src/readSnapshot.ts` | Modify in follow-up | Add read kinds such as `listing-quality`, `category-attributes`, `pictures`, `shipping`, and `visits`. |
| `packages/mercadolibre/src/index.ts` | Modify in follow-up | Add OAuth-backed GET endpoints and normalizers only for approved `safe-read` entries. |
| `packages/tools/src/index.ts` | Modify in follow-up | Add read tool wrappers and blocked-result handling for new safe reads. |
| `packages/mcp/src/index.ts` | Modify in follow-up | Register new `read_mercadolibre_*` tools only; no execute tools. |

## Interfaces / Contracts

The matrix contract should be spec-first:

```ts
type MlCapabilityClass = "docs-only" | "safe-read" | "prepare-only" | "future-execute-with-approval";
type MlCapabilityMatrixEntry = {
  area: string;
  classification: MlCapabilityClass;
  runtimeSurface: "none" | "read-tool" | "prepared-action";
  siteSupport: "MLC-confirmed" | "unknown";
  confidence: "low" | "medium" | "high";
};
```

Runtime safe reads must return existing `MlcReadSnapshot<T> | ReadToolBlocked` metadata. Prepared actions must keep `requiresApproval: true` and no direct MCP execution.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Spec | Matrix classification and no mutation widening | OpenSpec review plus delta requirement scenarios. |
| Unit | New read kinds, normalizers, blocked access, metadata | Vitest in `packages/mercadolibre` and `packages/tools`. |
| Integration | MCP registration/auth and prepare-only separation | Vitest in `packages/mcp`; assert no execute mutation tool appears. |
| E2E | Not required for first slice | Defer until UI/runtime behavior changes. |

## Migration / Rollout

No data migration required. Roll back by reverting this change folder and later delta specs. Runtime follow-ups should be chained: PR1 specs/matrix, PR2 safe read DTO/client methods, PR3 tool/MCP exposure, PR4 prepared-action expansions.

## Open Questions

- [ ] Which documented areas are MLC-confirmed versus only inferred from non-MLC examples?
