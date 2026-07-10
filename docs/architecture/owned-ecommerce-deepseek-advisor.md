# DeepSeek Merchandising Advisor

## What changed

Added an optional DeepSeek-powered merchandising advisor between the deterministic scorer and projection builder in the owned ecommerce intelligence pipeline. The advisor enriches storefront projections with AI-generated SEO/GEO copy, channel tradeoff analysis, experiment proposals, and evidence gap detection — gated by a feature flag and pure-function validator.

## Quick path

1. Enable: `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED=true`
2. Configure `DeepSeekTransport` in the intelligence service.
3. Pipeline automatically enriches passing candidates.
4. Blocked candidates remain blocked — advisor never unblocks.
5. No transport → deterministic fallback. No pipeline failure.

## Architecture

```text
SupplierWebSignal → Cortex query → build candidate → scoreCandidate (deterministic)
                                                           │
                                    ┌──────────────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ MerchandisingAdvisor    │  step 7
                        │ (DeepSeek, optional)    │
                        │  ├ draftSeoGeoCopy      │
                        │  ├ explainTradeoffs     │
                        │  ├ rankWithReasoning    │
                        │  ├ proposeExperiment    │
                        │  └ identifyMissingEvidence
                        └───────────┬─────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ AdvisorValidator        │  pure function
                        │ blocks: superlatives    │
                        │ w/o evidence, publish   │
                        │ language, unsupported   │
                        │ claims                  │
                        └───────────┬─────────────┘
                                    ▼
                        ┌─────────────────────────┐
                        │ buildProjection         │
                        │ (DeepSeekEnrichment)    │
                        └───────────┬─────────────┘
                                    ▼
                              CEO proposal
```

Blocked candidates remain blocked — advisor does not unblock.

## Components

| Component | Role | File |
|-----------|------|------|
| `OwnedEcommerceMerchandisingAdvisor` | 5-method advisor with deterministic fallback | `packages/agent/src/ecommerce/ownedEcommerceMerchandisingAdvisor.ts` |
| `OwnedEcommerceAdvisorPrompt` | 4-block prompt builder with cache-friendly hashing | `packages/agent/src/ecommerce/ownedEcommerceAdvisorPrompt.ts` |
| `MerchandisingAdvisorValidator` | Pure-function output validator | `packages/agent/src/ecommerce/merchandisingAdvisorValidator.ts` |
| `EcommerceEvidenceRequestPlanner` | Converts gap reports into inter-agent messages | `packages/agent/src/ecommerce/ecommerceEvidenceRequestPlanner.ts` |
| `OwnedEcommerceIntelligenceService` | Pipeline host (step 7) | `packages/agent/src/ecommerce/ownedEcommerceIntelligenceService.ts` |

## Transport / Fallback Pattern

| Condition | Behavior |
|-----------|----------|
| Transport available + flag enabled | Advisor calls DeepSeek for SEO/GEO and tradeoffs |
| Transport absent | Deterministic fallback: product-name SEO title, empty keywords/FAQ |
| Transport throws | `try/catch` degrades gracefully — enrichment skipped, pipeline continues |
| Flag disabled | Step 7 skipped entirely — no transport calls |

All advisor methods carry `noMutationExecuted: true` and return structured results even in fallback mode.

## Validator Safety Gate

Every advisor output passes through `MerchandisingAdvisorValidator.validate()` — a pure function with zero side effects:

| Blocked Pattern | Condition |
|-----------------|-----------|
| Superlatives ("best", "guaranteed", "official") | Without evidenceIds |
| Publish/checkout language | Always blocked |
| Medical/technical claims | Without evidenceIds |
| Mixed-account cross-references | Without comparison flag |
| Invalid targetAgentIds | Unknown agent reference |
| Invented stock/margin data | Numeric claims without evidenceIds |

Blocked claims are stripped; safe content passes through. `usable: true` only when zero claims are blocked.

## Cache-Friendly Prompt Architecture

The prompt builder uses a 4-block structure optimized for DeepSeek prefix-cache:

1. **(A) Identity/safety** — stable, never changes
2. **(B) Account/channel context** — varies per seller, slow-changing
3. **(C) Variable evidence** — candidate scores, stock, margin — changes per invocation
4. **(D) Output JSON schema** — stable, never changes

Hash strategy: `sha256(A+B+D)` for the cacheable prefix, `sha256(candidateIds+scores)` for volatile content. Identical prefix across calls = cached tokens at position 0.

## Feature Flag Lifecycle

`MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` (env, default `false`):

| Stage | Flag | Behavior |
|-------|------|----------|
| Development | `false` | Step 7 no-op, zero cost |
| Staging | `true` | Advisor active, transport configured |
| Production | `true` | Full enrichment active |
| Incident rollback | `false` | Instant disable — no code deploy needed |

When `true` but transport absent: deterministic fallback, zero cost, zero failure.

## Before / After Example

**Before** (deterministic fallback):
```
SEO title: "Bicicleta Mountain Bike Pro — Owned Ecommerce Storefront"
SEO description: "Storefront listing for Bicicleta Mountain Bike Pro..."
Keywords: []
GEO: "Purchase-intent listing for Bicicleta Mountain Bike Pro."
```

**After** (advisor enrichment):
```
SEO title: "Bicicleta Mountain Bike Pro — Comprá Online | Envío Rápido"
SEO description: "Bicicleta disponible en tienda propia. Precio competitivo, envío a todo Chile."
Keywords: ["bicicleta", "mountain bike", "tienda online"]
GEO: "Compra Bicicleta Mountain Bike Pro con confianza. Producto verificado..."
FAQ: [{"question": "¿Tienen stock disponible?", "answer": "Sí, stock verificado..."}]
```

## Verification

- 0 real HTTP in tests — `DeepSeekFakeTransport` only
- `noMutationExecuted: true` on every result
- 0 secrets in code/tests
- All 2,421+ tests pass
