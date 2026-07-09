# Proposal: Supplier → Cortex → Owned Ecommerce Bridge

## Intent

Connect three existing systems — Supplier Mirror, Cortex neural memory, and Owned Ecommerce — so the agent can reason on supplier data, learn patterns, and propose niche storefront candidates. Domain types already define the bridge interface (`CandidateProvenance.source = "supplier-mirror"`, `cortexNodeIds`) — but nothing populates them.

## Scope

### In Scope
- Supplier Mirror → Cortex ingestion: supplier profiles, items, stock, mappings, policies, fallback lessons as graph nodes
- Cortex-powered agent reasoning for ecommerce candidate discovery (agent reasons and proposes — not a fixed pipeline)
- Supplier Mirror → Owned Ecommerce candidate provenance: populate `supplierId`, `snapshotIds`, `evidenceIds`
- Agent Message Bus integration: stock-break auto-pause notifications
- Periodic sync (hourly) + reactive triggers on stock/price changes via supplier worker

### Out of Scope
- Fixed pricing or targeting rules (agent learns from CEO iteration)
- Auto-execution of Medusa writes (CEO "dale" gate preserved)
- New daemons or worker types
- ML API mutations from the bridge

## Capabilities

### New Capabilities
- `supplier-cortex-integration`: Bridge module handling Supplier Mirror → Cortex ingestion, metadata queries, node label conventions, and idempotent seed/sync

### Modified Capabilities
- `supplier-mirror`: Cortex ingestion behavior — fallback lessons, approved mappings, and stock observations write to the graph
- `neural-graph-memory`: Supplier concept node types (`supplier_profile`, `supplier_item`, `supplier_stock`, `supplier_mapping`, `supplier_policy`, `supplier_lesson`) with metadata query support
- `owned-ecommerce-agent`: Supplier mirror provenance requirement — populate `CandidateProvenance.supplierId`, `cortexNodeIds` from bridge data

## Approach

Phased, agent-driven:

1. **Bridge module** (`packages/memory/src/supplierMirrorCortexBridge.ts`): reads `SupplierMirrorStore`, seeds Cortex with concept nodes + weighted edges. Uses `getOrCreateNode()` for idempotency.
2. **Agent reasoning**: tools query Cortex via `queryByMetadata` + `spreadActivation` to discover supplier→niche patterns. No hardcoded rules — agent reasons, learns from CEO feedback, proposes.
3. **Ecommerce candidates**: built from approved mappings, enriched with `cortexNodeIds` for graph context.
4. **Wiring**: periodic sync in bot startup + reactive triggers via supplier worker on stock/price changes.

Cortex is secondary pattern index — Supplier Mirror remains source of truth. Bridge is infrastructure; never bypasses CEO approval.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/memory/src/supplierMirrorCortexBridge.ts` | New | Core bridge: ingest functions, node conventions, idempotent sync |
| `packages/memory/src/index.ts` | Modify | Re-export bridge types and functions |
| `packages/agent/src/conversation/supplierMirrorTools.ts` | Modify | Wire `ingestFallbackLessonToCortex` into `recordFallbackLesson` |
| `packages/agent/src/conversation/supplierMirrorEcommerceBridge.ts` | New | SM → OE candidate builder with provenance |
| `packages/bot/src/index.ts` | Modify | Startup seed (`ingestAllSuppliersToCortex`) + hourly sync |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Cortex node explosion from repeated ingestion | Medium | `getOrCreateNode()` idempotency; only latest stock observation; periodic `prune()` |
| Cross-DB inconsistency (SM SQLite ≠ Cortex SQLite) | High | SM is source of truth; Cortex is secondary index — eventual consistency accepted |
| Bridge noise in spreading activation | Medium | Conservative initial weights (0.5–0.8); `activationThreshold` filters weak paths |

## Rollback Plan

Remove periodic sync in `bot/src/index.ts`. Remove `ingestFallbackLessonToCortex()` wiring. Bridge writes no mutations — cease ingestion, graph returns to pre-bridge state. Prune supplier-typed nodes if needed.

## Dependencies

- `SupplierMirrorStore` (`MSL_SUPPLIER_MIRROR_DB_PATH` must be set)
- `GraphEngine` (`MSL_CORTEX_SQLITE_PATH` must be set)
- Agent Message Bus (stock-break notifications)
- `DeepSeekReasoningGateway` (cost-aware reasoning)

## Success Criteria

- [ ] Supplier data appears as Cortex concept nodes (`queryByMetadata` by `type = "supplier_item"`)
- [ ] Agent discovers supplier→niche combinations via `spreadActivation` — not hardcoded rules
- [ ] `StorefrontCandidate.provenance` populated with `supplierId`, `cortexNodeIds`
- [ ] Stock-break pause notifications reach Agent Message Bus from supplier worker
- [ ] Zero mutations to ML or Medusa from bridge code
- [ ] Existing tests pass; bridge unit tests cover ingestion + idempotency
