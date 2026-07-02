# Proposal: Operational Catalog Competition Ingestion

## Intent

Persist catalog competition (`price_to_win`) evidence locally so market/catalog and margin lanes can reason from auditable, fresh operational snapshots instead of depending on ad hoc live reads.

## Scope

### In Scope
- Add bounded background ingestion for existing `getItemPriceToWin` reads.
- Persist successful bounded results as `pricing` operational snapshots with freshness, completeness, confidence, evidence IDs, and checkpoints.
- Keep unsupported, partial, unauthorized, or non-catalog items graceful and non-fatal.

### Out of Scope
- Price mutation, pricing automation changes, promotions mutation, returns review, or media/image mutation.
- New MercadoLibre API endpoints or fake/private AI image generation integration.
- Broader promotions, visits, quality, or returns operationalization.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `business-memory-cache`: extend operational read model and ingestion requirements to include `pricing` snapshots from catalog competition price-to-win reads.
- `operational-lane-evidence`: require market and margin lane evidence to retrieve durable `pricing` competition snapshots when present.

## Approach

Reuse the existing MercadoLibre client `getItemPriceToWin` inside background ingestion with a small per-cycle item cap and `pricing` checkpoint. Normalize each result into the existing operational snapshot shape; skip no-data items without failing the cycle and preserve `noMutationExecuted` behavior.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | Add bounded `pricing` processor for price-to-win snapshots. |
| `packages/memory/src/operationalReadModel.ts` | Modified | Verify/support `pricing` snapshot/checkpoint use with existing generic model. |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | Modified | Prove market/margin lanes surface durable `pricing` evidence. |
| `packages/agent/tests/conversation/*` | Modified | Add ingestion, checkpoint, partial-failure, and lane-evidence coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Per-item reads pressure API budget | Med | Cap listings per cycle and checkpoint `pricing`. |
| Unsupported/non-catalog items return no data | Med | Store partial metadata or skip gracefully. |
| Stale competition evidence misleads pricing advice | Med | Preserve freshness/completeness/confidence and evidence timestamps. |

## Rollback Plan

Disable the `pricing` ingestion processor/config and revert proposal/spec/code deltas. Existing snapshots are read-only evidence and can be ignored by lane mapping if rollback is needed.

## Dependencies

- Existing `getItemPriceToWin` client behavior and operational `pricing` signal mapping.
- MercadoLibre catalog competition read availability for targeted seller items.

## Success Criteria

- [ ] Background ingestion persists bounded price-to-win results as `pricing` snapshots with deterministic evidence IDs.
- [ ] Checkpoints prevent repeated full-catalog replay and rate-budget spikes.
- [ ] Market and margin lanes cite durable `pricing` evidence when available.
- [ ] No mutations execute and no AI image generation API is introduced.
