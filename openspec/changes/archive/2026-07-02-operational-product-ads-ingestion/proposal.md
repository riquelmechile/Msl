# Proposal: Operational Product Ads Ingestion

## Intent

Persist existing safe-read Product Ads insights into the operational read model so CEO, campaign, and market lanes can cite durable ad-performance evidence without relying on live-only tool calls.

## Scope

### In Scope
- Add background ingestion for one seller-level `product-ads-insights` snapshot per cycle.
- Reuse existing `getProductAdsInsights` and current `product-ads-insights` signal/lane mapping.
- Persist freshness, completeness, confidence, ROAS-oriented metadata, `noMutationExecuted`, evidence ID, and checkpoint.
- Treat Product Ads disabled/no-permission states as graceful no-data.
- Add focused tests for persistence, checkpoints, lane evidence availability, and graceful skips/errors.

### Out of Scope
- Campaign/ad budget, status, strategy, title, or creative mutations.
- New MercadoLibre Product Ads endpoints or write tools.
- New operational evidence lanes or signal kinds.
- Large fixtures or broad ingestion refactors.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `business-memory-cache`: expand operational read model ingestion/persistence to include `product-ads-insights` seller snapshots and checkpoints.
- `operational-lane-evidence`: ensure `market` and `campaign` lanes can retrieve durable `product-ads-insights` evidence from the operational DB.
- `ml-api-integration`: no spec-level change; existing Product Ads safe-read client/matrix behavior is reused unchanged.

## Approach

Follow the existing per-kind background ingestion pattern in `backgroundIngestion.ts`. If `getProductAdsInsights` is available, call it per seller with bounded default options, normalize the returned read snapshot into a single operational snapshot, and checkpoint only after successful persistence. Preserve safe-read semantics and never add mutation paths.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | Add Product Ads processor and checkpointing. |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | Modified | Tests may prove existing lane mapping returns persisted Product Ads evidence. |
| `packages/domain/src/cacheFreshness.ts` | Unchanged | Existing `product-ads-insights` kind is reused. |
| `packages/mercadolibre/src/index.ts` | Unchanged | Existing `getProductAdsInsights` is reused. |
| `packages/agent/tests/conversation/*` | Modified | Add compact ingestion/evidence tests. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Seller lacks Product Ads access | Med | Gracefully skip as no-data without failing the cycle. |
| Metrics appear real-time | Med | Preserve requested date range/freshness and document daily cadence. |
| Review size exceeds 400 lines | Low | Use compact fixtures and narrow tests. |

## Rollback Plan

Remove the Product Ads ingestion processor/tests and stop writing the `product-ads-insights` checkpoint; existing live read tool and lane mappings remain intact.

## Dependencies

- Existing `getProductAdsInsights`, operational read model writer, and `product-ads-insights` domain kind.

## Success Criteria

- [ ] Background ingestion stores durable `product-ads-insights` snapshots with evidence IDs.
- [ ] Campaign/market lane evidence can cite persisted Product Ads evidence.
- [ ] Product Ads no-access cases skip safely with no mutation executed.
