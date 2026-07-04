# Design: Jinpeng Supplier Runtime Enablement

## Technical Approach

Add an admin-only bootstrap/dry-run path around the existing Supplier Mirror store, MercadoLibre source adapter, XKP enrichment adapter, and CEO tools. The bootstrap seeds safe Jinpeng defaults, validates source access read-only, records ledger evidence, and returns a CEO-readable readiness report. Runtime ingestion remains disabled unless both config and stored supplier state explicitly enable it.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|----------|--------|-------------------------|-----------|
| Entry point | Add `scripts/supplier-mirror-jinpeng-bootstrap.mjs` plus `packages/workers/src/supplierMirror/jinpengBootstrap.ts`; expose root script `supplier-mirror:jinpeng:dry-run`. | Hide bootstrap inside scheduler or MCP tools. | Bootstrap is operator/admin work, not conversation UX or worker selection. A script keeps secrets in env and makes dry-runs repeatable. |
| Config | Use env/CLI runtime config: `MSL_SUPPLIER_MIRROR_DB_PATH`, `MSL_JINPENG_ML_SELLER_ID`, `MSL_JINPENG_ML_NICKNAME`, `MSL_JINPENG_XKP_URL`, `MSL_MAUSTIAN_SELLER_ID`, `MSL_PLASTICOV_SELLER_ID`, OAuth env already used by MCP. | Commit JSON config with account IDs. | Avoid secrets and avoid stale account identity in repo; docs can show names without values. |
| Target defaults | Upsert supplier-scope target membership with both target seller IDs, `autoPauseAllowed: false`, default low-stock threshold 2; store Maustian x2.5 owned-content and Plasticov x2 proposals as proposed learned fallback policies/metadata, not approved operational pricing. | Put both prices in one `target_policies.pricingPolicy`. | Current `target_policies` has one pricing policy per supplier scope, so per-target pricing belongs in proposal metadata until confirmed. |
| Pricing type | Extend `SupplierPricingPolicy.multiplier` from `2 | 3 | 4` to finite positive `number`; update parser/tests for `x2.5`. | Round Maustian to x3. | User explicitly chose x2.5; rounding would encode a wrong business decision. |
| CEO report | Add `review_supplier_mirror_readiness` in `packages/agent/src/conversation/supplierMirrorTools.ts`. | Ask user to choose worker/run script manually. | CEO gets validation, missing decisions, and ledger evidence through existing CEO-only tool pattern; no direct worker selection is exposed. |

## Data Flow

```text
CLI dry-run/config
  -> Jinpeng bootstrap service
  -> SupplierMirrorStore upserts + ledger
  -> ML adapter read validation / XKP enrichment validation
  -> readiness report in store metadata + CEO readiness tool
  -> worker stays disabled unless explicit enable flag + validated supplier.enabled
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `scripts/supplier-mirror-jinpeng-bootstrap.mjs` | Create | Admin CLI wrapper; defaults to `--dry-run`, loads env only. |
| `package.json` | Modify | Add `supplier-mirror:jinpeng:dry-run` script. |
| `packages/workers/src/supplierMirror/jinpengBootstrap.ts` | Create | Seed/validate/report orchestration with stable idempotency keys. |
| `packages/workers/src/supplierMirror/index.ts` | Modify | Export bootstrap types/service; keep scheduler disabled by default. |
| `packages/domain/src/supplierMirror.ts` | Modify | Allow decimal pricing multiplier and optional readiness/report metadata types if useful. |
| `packages/memory/src/supplierMirrorStore.ts` | Modify | Add ledger listing/report helpers only if CEO tool cannot read required evidence from supplier metadata. |
| `packages/agent/src/conversation/supplierMirrorTools.ts` | Modify | Add CEO readiness review tool; no mutations and no worker selection. |
| `docs/supplier-mirror.md` | Modify | Document env, dry-run command, missing credential behavior, enablement gate. |

## Interfaces / Contracts

```ts
type JinpengBootstrapMode = "dry-run" | "apply-seed";
type JinpengReadinessReport = {
  supplierId: "jinpeng";
  status: "ready-for-ceo-decision" | "blocked";
  identity: { sellerId?: string; nickname?: string; profileUrl?: string; verified: boolean };
  sources: { mlStockAuthority: "validated" | "missing" | "failed"; xkpEnrichment: "validated" | "missing" | "failed" };
  targetProposals: readonly { sellerId: string; pricing: string; contentPolicy: string; requiresCeoConfirmation: true }[];
  missingDecisions: readonly string[];
  ledgerIds: readonly string[];
  noMutationExecuted: true;
};
```

Missing OAuth/client config MUST return `blocked` with missing env names and ledger `skip/deferred` records; it MUST NOT enable `suppliers.enabled` or call write clients.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Decimal pricing, config parsing, idempotency keys, missing credentials | Vitest in domain/agent/workers. |
| Integration | Store upserts, ledger reuse, dry-run report, XKP stock ignored | SQLite `:memory:` tests. |
| E2E | Operator docs/script smoke | Build then run script against mocked/no-credential env expecting blocked no-mutation report. |

## Migration / Rollout

No destructive migration. Bootstrap is idempotent through store upserts and `sync_ledger.idempotency_key`. Worker remains disabled unless `MSL_SUPPLIER_MIRROR_WORKER_ENABLED=true` and the supplier row is explicitly enabled after CEO confirmation.

## Review Slices

1. Bootstrap domain/config/report + tests.
2. Store/ledger idempotent persistence + tests.
3. CEO readiness tool + pricing parser updates.
4. CLI script/docs/smoke. Each slice should remain below 800 changed lines.

## Open Questions

- [ ] Confirm actual Maustian/Plasticov/Jinpeng seller IDs and OAuth token availability outside git.
- [ ] Confirm low-stock threshold 2 vs 3; design defaults to 2 until CEO changes it.
