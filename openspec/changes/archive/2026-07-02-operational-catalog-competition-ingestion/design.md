# Design: Operational Catalog Competition Ingestion

## Technical Approach

Add a safe-read `pricing` ingestion processor beside the existing Product Ads processor. It will reuse `MlcApiClient.getItemPriceToWin`, process only a bounded rotated batch of listing IDs per cycle, persist successful competition snapshots through the generic operational read model, and update the `pricing` checkpoint only after the bounded batch completes. The checkpoint is a cadence marker, not a per-item cursor; deterministic rotation prevents repeatedly reading only the first catalog items without changing the checkpoint schema. Market and margin lanes already map to `pricing`; this design proves and preserves that path without introducing price, promotion, or media mutations.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Reuse `getItemPriceToWin` vs add a new ML endpoint client | Reuse avoids duplicated API normalization and preserves current MLC item validation; the existing snapshot kind is `listing`, so ingestion must persist it as operational `pricing`. | Reuse `getItemPriceToWin`; no new endpoint. |
| Bounded rotated item batch with checkpoint cadence vs full catalog scan | Full scans maximize coverage but risk rate-budget spikes. A checkpoint-only cursor would be dishonest because the store has no item cursor column. | Add `PRICING_MAX_ITEMS_PER_CYCLE` / `pricingMaxItemsPerCycle`; select a deterministic rotated slice from listings; persist `pricing` checkpoint after the batch as cadence evidence. |
| Skip no-data items vs persist missing snapshots | Missing snapshots add noise and can overwrite useful evidence. Skips keep lanes graceful. | Skip unsupported/unauthorized/non-catalog/no-data items; persist only usable partial/complete snapshots. |
| Change lane mapping vs rely on existing mapping | Mapping already routes `market` and `margin` to `pricing`; changing it risks regressions. | Keep mapping, add focused tests. |

## Data Flow

```text
getListings ──→ bounded rotated pricing selector ──→ getItemPriceToWin
     │                        │                         │
     │                        └── pricing checkpoint ←──┘
     └── listing snapshots      pricing snapshots ──→ OperationalEvidenceProvider
                                                   └── market/margin prompt lines
```

Per-item failures are caught inside the pricing processor. Only unexpected store/checkpoint failures should fail the processor, matching Product Ads persistence semantics.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modify | Add pricing TTL/cap constants, optional config cap, `processSellerPricing`, deterministic rotated batch selection from listings, graceful price-to-win no-data detection, checkpoint update after bounded batch, and call from worker after listings are available. |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | Modify | Keep mapping unchanged; adjust formatting only if needed to label pricing as read-only evidence while staying compact. |
| `packages/memory/src/operationalReadModel.ts` | No schema change | Existing generic `kind`, `data_json`, `evidence_id`, and checkpoint table support `pricing`. Tests should prove it. |
| `packages/domain/src/cacheFreshness.ts` | No change expected | `BusinessSignalKind` already includes `pricing`; freshness helpers treat it as medium risk. |
| `packages/mercadolibre/src/index.ts` | No change expected | Existing `getItemPriceToWin` and `MlcPriceToWinSummary` are reused. |
| `packages/agent/tests/conversation/backgroundIngestion.test.ts` | Modify | Add bounded ingestion, checkpoint ordering, graceful per-item failure, no-store/no-client, and no-mutation assertions. |
| `packages/agent/tests/conversation/operationalEvidenceProvider.test.ts` | Modify | Add explicit market and margin pricing evidence tests, including missing/partial graceful behavior. |

## Interfaces / Contracts

```ts
export type BackgroundIngestionConfig = {
  pricingMaxItemsPerCycle?: number; // default small cap, e.g. 20
};

export async function processSellerPricing(
  config: BackgroundIngestionConfig,
  sellerId: string,
  listings: ReadonlyArray<MlcListingSummary>,
): Promise<{ persisted: number; skipped: number }>;
```

Persisted snapshot contract: `kind: "pricing"`, entity ID = item ID, evidence ID = `orm:pricing:{sellerId}:{itemId}:{capturedAt}`, data includes the normalized `MlcPriceToWinSummary` plus `noMutationExecuted: true`.

Batch selection contract: sort listing IDs deterministically, compute a rotated start offset from seller ID plus the previous/current pricing checkpoint timestamp, then take at most `pricingMaxItemsPerCycle` IDs with wraparound. This is a rate guard and fairness mechanism, not an exact per-item resume cursor.

Checkpoint contract: `getCheckpoint(sellerId, "pricing")` records cadence only. The checkpoint is written once, after all capped items have been attempted and successful snapshots have persisted.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Pricing rotated batch cap, evidence ID, snapshot metadata, checkpoint-after-persist, graceful 401/403/404/no-data/per-item errors | Vitest against in-memory operational store and mocked `MlcApiClient`. |
| Integration | Market/margin lanes retrieve pricing evidence and omit missing/limited evidence safely | Existing `OperationalEvidenceProvider` tests with mocked reader and SQLite-backed reads where useful. |
| E2E | Not required for this slice | No UI/user flow changes; verify with `npm test` during apply/verify. |

## Migration / Rollout

No schema migration required. Roll out by deploying the new processor with the default cap. Rollback is disabling/removing the processor call; existing `pricing` snapshots are read-only and can be ignored by lane evidence. No price mutations, promotion mutations, returns reviews, or AI image generation are introduced.

## Open Questions

- [ ] None blocking.
