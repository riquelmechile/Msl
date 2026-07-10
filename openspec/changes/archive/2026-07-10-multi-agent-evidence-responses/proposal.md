# Proposal: Multi-Agent Evidence Response Handling

## Intent

The advisor and planner identify evidence gaps (margin, stock, demand, images, account fit) but those requests don't trigger real collaborative multi-agent responses — they remain as text. This change makes evidence requests wake other agents, receive structured responses, and enrich CEO candidates.

## Scope

### In Scope
- `EvidenceRequestPayload` / `EvidenceResponsePayload` domain types (9 evidence kinds, 7 statuses)
- `EvidenceRequestStore` (SQLite, in-memory for tests) with enqueue, claim, answer, fail, expire, dedupe, query
- `EvidenceResponseRouter` delegating pending requests to correct responder agents
- 5 responder agents (CostSupplier, MarketCatalog, CreativeAssets, AccountBrain, SupplierManager)
- `OwnedEcommerceEvidenceAggregator` joining responses, enriching candidates, updating blockers/confidence
- Integration: planner persists to store, daemon marks candidates `waiting_for_evidence` and re-evaluates
- Message bus: `evidence-request` and `evidence-response` message types
- 2 read-only CEO tools: `inspect_evidence_status`, `list_pending_evidence`
- Work Session + Cortex hooks on request/response lifecycle
- 32 tests covering all components, seller isolation, `noMutationExecuted: true`, 0 HTTP

### Out of Scope
- Real provider API calls — responders use injected fake transports
- Mutation of ML listings, Medusa, or supplier data
- Dashboard UI — tools are CLI/Telegram-only

## Capabilities

### New Capabilities
- `inter-agent-evidence`: Domain types, store, router, responder contracts, bus integration

### Modified Capabilities
- `owned-ecommerce-merchandising-advisor`: Planner persists to store + emits to bus
- `owned-ecommerce-agent`: Daemon marks waiting_for_evidence, re-evaluates on responses
- `multi-agent-orchestration`: New agent lane targets for evidence routing

## Approach

Layered integration on existing infrastructure:
1. **Domain layer** — new types in `packages/domain/src/`
2. **Memory layer** — `EvidenceRequestStore` in `packages/memory/src/`
3. **Agent layer** — router + 5 responders + aggregator in `packages/agent/src/`
4. **Integration** — Planner → Store → Bus → Router → Responders → Aggregator → Candidate enrichment
5. **Tools** — read-only inspection tools

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/domain/src/` | New | Evidence request/response types |
| `packages/memory/src/` | New | EvidenceRequestStore (SQLite + in-memory) |
| `packages/agent/src/ecommerce/` | Modified | Planner integration, aggregator |
| `packages/agent/src/evidence/` | New | Router + 5 responders |
| `packages/agent/src/conversation/` | Modified | New bus message types |
| `packages/agent/src/tools/` | New | 2 read-only inspection tools |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Multi-agent coordination complexity | Medium | Stateless responders, store as single source of truth |
| Store performance under load | Low | SQLite WAL mode, dedupe via hash index |
| Deduplication correctness | Medium | Hash-based dedupe keys per candidate+kind+window |
| Stale responses feeding candidates | Medium | Expiry timestamps, freshness gates in aggregator |

## Rollback Plan

Store and types are additive. Remove router/responder wiring from planner + daemon. Existing `planRequests()` fallback path (returns structured messages without store) untouched.

## Dependencies

- Agent Message Bus (exists)
- AgentWorkSessionStore (exists)
- OwnedEcommerceStore (exists)

## Success Criteria

- [ ] 32 tests pass (0 HTTP, 0 external writes, 0 secrets)
- [ ] Seller isolation: Plasticov/Maustian requests never cross
- [ ] All payloads carry `noMutationExecuted: true`
- [ ] CEO candidate enriched with structured evidence responses
- [ ] `waiting_for_evidence` → re-evaluation cycle works end-to-end
