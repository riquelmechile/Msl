# Design: Owned Ecommerce Intelligence

## Technical Approach

Daemon pipeline: supplier detection → AgentMessageBus `supplier-web-signal` → daemon claims → `OwnedEcommerceIntelligenceService` (Cortex spreadActivation → deterministic scorer → AccountBrain → optional DeepSeek SEO/GEO → projection → CEO proposal). All `noMutationExecuted: true`. Gated by `MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED`.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Intelligence layer | Standalone service class | Testable without daemon lifecycle; injectable |
| SupplierWebSignal location | Own file (`supplierWebSignal.ts`) | Distinct contract, different consumers from ownedEcommerce |
| Scorer | Pure function | Follows existing `guardrailsForCandidateEvidence` pattern |
| DeepSeek integration | Advisor via `DeepSeekTransport`/`FakeTransport` | Reuses existing pattern; deterministic fallback per spec |
| Seller isolation | `sellerId` arg on all Cortex queries | Plasticov/Maustian evidence never mixed; `SpreadingOptions.sellerId` already exists |

## Data Flow

```
SupplierManagerDaemon → AgentMessageBus (supplier-web-signal) → OwnedEcommerceDaemon
                                                                      │
                                                  OwnedEcommerceIntelligenceService
                                                  ┌─────────┼──────────┐
                                            CortexReasoner  Scorer  ProjectionBuilder
                                                  │                    │
                                          spreadActivation    StorefrontProjection
                                          queryByMetadata     (CEO proposal via bus)
```

## Domain Types

| Type | File | Key Fields |
|------|------|------------|
| `SupplierWebSignal` | `packages/domain/src/supplierWebSignal.ts` (new) | kind, supplierId, supplierItemId, evidenceIds, severity, recommendedAction, noMutationExecuted |
| `SupplierWebSignalKind` | same | `new-supplier-product` \| `stock-gap` \| `supplier-price-change` \| `supplier-stock-restored` \| `supplier-stock-out` \| `publish-opportunity` |
| `CandidateSourceKind` | `packages/domain/src/ownedEcommerce.ts` (mod) | Add `"supplier-web-signal"` |
| `StorefrontCandidateScore` | same (mod) | score, blockReasons, creativeRequest?, channelRecommendation? |

## File Changes

| File | Action |
|------|--------|
| `packages/domain/src/supplierWebSignal.ts` | Create — domain types |
| `packages/domain/src/ownedEcommerce.ts` | Modify — add source kind + score types |
| `packages/agent/src/ecommerce/ownedEcommerceIntelligenceService.ts` | Create — orchestration |
| `packages/agent/src/ecommerce/ownedEcommerceCortexReasoner.ts` | Create — Cortex wrapper |
| `packages/agent/src/ecommerce/storefrontCandidateScorer.ts` | Create — deterministic scorer |
| `packages/agent/src/ecommerce/storefrontProjectionBuilder.ts` | Create — static projection assembly |
| `packages/agent/src/workers/supplierManagerDaemon.ts` | Modify — enqueue 6 signal kinds |
| `packages/agent/src/workers/ownedEcommerceDaemon.ts` | Rewrite — intelligence pipeline |
| `packages/agent/src/conversation/ownedEcommerceTools.ts` | Modify — 3 new read-only tools |
| `packages/agent/src/workers/daemonTypes.ts` | Modify — optional deps |
| `docs/architecture/owned-ecommerce-intelligence.md` | Create — architecture doc |

## Component Interfaces

**`OwnedEcommerceIntelligenceService`**
- Deps: `cortex: GraphEngine` (required), `scorer`, `projectionBuilder`, `accountBrain?`, `deepSeek?`, `creativeJobQueue?`, `ownedEcommerceStore?`
- `prepareFromSupplierWebSignal(signal): Promise<{ candidates, scores, projection?, cortexUnavailable?, errors }>`
- Degrades: Cortex unreachable → `cortexUnavailable: true` (no hardcoded fallback). No accountBrain → skip channel recommendation. No deepSeek → deterministic SEO/GEO.

**`scoreCandidate` (pure function)**
- `(candidate, channelComparison?) → StorefrontCandidateScore`
- stock=out-of-stock \| no margin → `do-not-publish`. No images → `request-creative-assets`. Stale → `collect-more-evidence`.

**`buildProjection` (pure function)**
- `(scored[], deepSeekResult?) → StorefrontProjectionPreparation`
- Missing images → `.missingMedia` with creative request refs.

## Test Architecture

| Layer | What | How |
|-------|------|-----|
| Unit | Scorer (pure fn) | Table-driven: stock×margin×image combos |
| Unit | ProjectionBuilder (pure fn) | Input→output; missingMedia paths |
| Unit | CortexReasoner | In-memory SQLite GraphEngine, seeded supplier nodes |
| Integration | IntelligenceService | Real stores (in-memory), FakeTransport for DeepSeek |
| Integration | Daemons | Fake bus/stores, FakeTransport; verify signal→proposal lifecycle |

## Dependency Graph

- **Required**: `GraphEngine`, `AgentMessageBusStore`, `SupplierMirrorStore` (supplierManagerDaemon)
- **Optional**: `AccountBrainService` (skip channel), `DeepSeekTransport` (deterministic fallback), `CreativeJobQueueStore` (skip creative), `OwnedEcommerceStore` (skip persistence), `AgentWorkSessionStore` (skip observations)

**Feature flag**: `MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED=false` → signal enqueue skipped, daemon returns empty.

## PR Strategy (800-line budget)

| PR | Scope | Est. Lines |
|----|-------|-----------|
| 1 | Domain types + SupplierWebSignal + supplierManagerDaemon signal enqueue + tests | ~450 |
| 2 | IntelligenceService + reasoner + scorer + projectionBuilder + daemon rewrite + tools + docs | ~650 |

Work units per `work-unit-commits` convention: types → logic → wiring → tests.
