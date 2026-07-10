# Proposal: Owned Ecommerce Intelligence

## Intent

Transform `owned-ecommerce` from a surface monitor into an intelligent web agent that reasons over
supplier signals, Cortex, AccountBrain, and storefront evidence to produce ranked projections for
CEO approval. All outputs: `noMutationExecuted: true`.

## Scope

### In Scope
- `SupplierWebSignal` domain type (`noMutationExecuted: true`)
- `supplierManagerDaemon`: enqueue supplier-web-signal per 6 signal kinds
- `ownedEcommerceDaemon`: rewrite — Cortex-first reasoning (`spreadActivation`, `queryByMetadata`)
- `ownedEcommerceIntelligenceService`: signals → `StorefrontCandidate[]`
- `storefrontCandidateScorer`: deterministic (stock, margin, images, SEO, account-fit)
- `storefrontProjectionBuilder`: static Medusa projections
- Optional DeepSeek SEO/GEO — deterministic fallback
- `ownedEcommerceTools`: 3 new read-only CEO tools
- Creative Studio delegation; AccountBrain channel comparison; work-session registration
- Docs: new architecture doc; update bridge/vision docs

### Out of Scope
No mutations (publish, checkout, payment, price/stock, cache). No HTTP/Medusa/MercadoLibre writes,
secrets, dashboard, multi-bot, refactor.

## Capabilities

### New
- `supplier-web-signal`: supplier-to-web signaling contract
- `owned-ecommerce-intelligence`: Cortex reasoning, scoring, projection building
- `storefront-projection-builder`: Medusa-oriented static assembly

### Modified
- `supplier-manager-daemon`: parallel `supplier-web-signal` enqueue
- `owned-ecommerce-agent`: daemon rewrite + new read-only tools

## Approach

Daemon claims signal → Cortex spreadActivation/queryByMetadata → candidate bridge → deterministic
scorer (guardrails) → Creative Studio if images missing → AccountBrain channel comparison →
ProjectionBuilder → DeepSeek optional SEO/GEO → CEO proposal → work-session observation.
All `noMutationExecuted: true`.

## Affected Areas

| Area | Impact |
|------|--------|
| `packages/domain/src/ownedEcommerce.ts` | Modified — `SupplierWebSignal` |
| `packages/agent/src/workers/supplierManagerDaemon.ts` | Modified — signal enqueue |
| `packages/agent/src/workers/ownedEcommerceDaemon.ts` | Rewritten |
| `ownedEcommerceIntelligenceService.ts` | New |
| `storefrontCandidateScorer.ts` | New |
| `storefrontProjectionBuilder.ts` | New |
| `ownedEcommerceTools.ts` | Modified — read-only tools |
| `docs/architecture/owned-ecommerce-intelligence.md` | New |

## Risks

| Risk | Mitigation |
|------|------------|
| Signal volume overwhelms cycle | Hourly dedupe keys, batch ceiling |
| Cortex cold-start (no supplier nodes) | Graceful empty; no hardcoded-rule fallback |
| DeepSeek unsupported claims | Deterministic validation gate |
| Stale channel recommendation | Freshness check before scoring |

## Rollback Plan

Feature flag `MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED` gates forwarding. New files additive;
daemon map already wired. Set flag to `false` — projections are read-only previews, no state to
unwind.

## Dependencies

`SupplierMirrorStore`, `GraphEngine`, `OperationalReadModelReader`, `supplierMirrorEcommerceBridge`,
`AccountBrainService`, `AgentMessageBusStore`, `AgentWorkSessionStore`, `OwnedEcommerceStore`,
creative studio lane, `DeepSeekClient`/`FakeTransport` — all existing.

## Success Criteria

- [ ] `SupplierWebSignal` exported from `@msl/domain`
- [ ] `supplierManagerDaemon` enqueues supplier-web-signal per detect config
- [ ] `ownedEcommerceDaemon` runs intelligence pipeline on signal + daemon-tick
- [ ] Cortex `spreadActivation` drives discovery (no hardcoded rules)
- [ ] Scorer blocks stale/missing evidence with guardrail codes
- [ ] Projections include Medusa catalog, SEO/GEO, media refs, readiness
- [ ] DeepSeek optional, deterministic fallback when absent
- [ ] Creative Studio delegation on missing images
- [ ] AccountBrain channel recommendation in projection evidence
- [ ] CEO tools return read-only evidence, `noMutationExecuted: true`
- [ ] Work-session observations registered with evidence IDs
- [ ] Existing tests pass; new tests cover signal handling, scoring, projection building
