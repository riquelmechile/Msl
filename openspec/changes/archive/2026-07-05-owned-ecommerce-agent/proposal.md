# Proposal: Owned Ecommerce Builder Agent

## Intent

Give MSL an Owned Ecommerce Builder Agent that creates and maintains fast, personalized Medusa.js ecommerce surfaces under CEO orchestration. It selects products from Plasticov, Maustian, Supplier Mirror/Jinpeng, and future suppliers; generates storefront/content projections; and optimizes performance, SEO, schema, and GEO/AI visibility.

## Scope

### In Scope
- Medusa-oriented architecture and adapter contracts.
- Product selection from ML accounts, Supplier Mirror/Jinpeng, future suppliers.
- Static projection with images, schema, SEO/GEO content, performance checks.
- Telegram CEO loop for questions, approvals, readiness.
- Deterministic guardrails for stock, margin, evidence freshness, secrets, publish/payment activation, prices, and risky mutations.

### Out of Scope
- Live payments/checkout activation.
- Uncontrolled public publishing/storefront launch.
- Real paid campaigns.
- Autonomous price/stock mutation without approval.

## Capabilities

### New Capabilities
- `owned-ecommerce-agent`: Medusa-first builder/operator for selection, projections, SEO/GEO content, adapter previews, and CEO-gated web operations.

### Modified Capabilities
- `multi-agent-orchestration`: add an Owned Ecommerce Specialist under CEO/orchestrator.
- `action-approval-safety`: gate publish, checkout/payment, price/stock, secrets, risky content.

## Approach

Use Medusa.js as the primary target with a clean adapter boundary. First slice: preview Medusa-ready catalog/storefront changes from precomputed projections. Deterministic filters enforce constraints; DeepSeek handles ranking, merchandising, SEO/GEO copy, and tradeoffs. Telegram CEO approval is required before public publish, checkout/payment, or risky writes.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/domain/src/` | New | Models and guardrails. |
| `packages/agent/src/conversation/` | Modified | Lane/tools/approvals. |
| `packages/workers/src/` | New | Collection, ranking, projection. |
| `packages/memory/src/` | Modified | Snapshots/adapter state. |
| `packages/mercadolibre/src/` | Modified | Plasticov/Maustian evidence. |
| `packages/memory/src/supplierMirrorStore.ts` | Modified | Supplier/Jinpeng inputs. |
| `packages/ecommerce-medusa/` | New | Medusa adapter. |
| `apps/web/storefront/` | New | Static storefront. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SEO/GEO overclaiming | Med | Require evidence-backed claims. |
| Page speed regressions | Med | Serve static projections; no request-time agent reasoning. |
| Inventory/pricing drift | High | Block stale/weak evidence. |
| Secret/payment risk | Med | Fail closed; redact; exclude checkout/payment. |
| Duplicate content | Med | Score duplication; require positioning. |
| Approval boundary erosion | Med | Treat previews as non-mutations; require CEO approval. |

## Rollback Plan

Disable lane/tools/worker, retain read-only records, and leave Medusa/public publish adapters unconfigured. MercadoLibre/Supplier Mirror remain unchanged.

## Dependencies

- Medusa.js adapter contract alignment; existing ML, Supplier Mirror/Jinpeng, read model, Cortex, DeepSeek, Telegram approvals.

## Success Criteria

- [ ] CEO receives ranked, evidence-linked Medusa storefront candidates through Telegram.
- [ ] Projections include content, schema, images, SEO/GEO, performance, readiness checks.
- [ ] Guardrails block unsafe stock, price, secret, checkout/payment, or publish actions without approval.
