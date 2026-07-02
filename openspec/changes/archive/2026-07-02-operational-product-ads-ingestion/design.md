# Design: Operational Product Ads Ingestion

## Technical Approach

Add a small Product Ads processor to the existing background ingestion cycle. It will call the already available `mlcClient.getProductAdsInsights` once per seller with a bounded seller-level date range, persist one `product-ads-insights` snapshot into `@msl/memory`, and update the Product Ads checkpoint only after that snapshot is written. No new MercadoLibre endpoints, signal kinds, lanes, or mutation paths are introduced.

This satisfies `business-memory-cache` by making Product Ads snapshots durable and `operational-lane-evidence` by relying on the existing `market`/`campaign` evidence mapping represented in code by `market-catalog` and `creative-commercial` lanes.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Product Ads API surface | Reuse `MlcApiClient.getProductAdsInsights` | Add direct Product Ads calls in agent | Keeps first slice safe-read only and avoids duplicating endpoint/version/header behavior already centralized in `packages/mercadolibre/src/index.ts`. |
| Snapshot cardinality | One seller-level snapshot per cycle | Per-campaign or per-ad ORM rows | Matches proposal scope, avoids API/write volume, and uses `item_id` as the seller-level date range identity required by the spec. |
| Lane evidence | Keep `KIND_SIGNAL_MAP` unchanged | Add new lanes or signal kinds | `operationalEvidenceProvider.ts` already maps `market` and `campaign` evidence to `product-ads-insights`; tests should prove durable retrieval instead of changing contracts. |
| No-access handling | Catch disabled/unauthorized/no-advertiser errors as no-data | Fail seller cycle | Many sellers may not have Product Ads enabled; ingestion must not break listings/orders/reputation for that seller. |

## Data Flow

```text
startBackgroundIngestion
  └─ per seller
      ├─ listings/orders/claims/questions/messages/reputation
      └─ processSellerProductAds
          ├─ mlcClient.getProductAdsInsights(sellerId, defaultRange)
          ├─ operationalStore.upsertSnapshot(kind="product-ads-insights")
          └─ operationalStore.upsertCheckpoint(sellerId, "product-ads-insights", capturedAt)

OperationalEvidenceProvider
  └─ market-catalog / creative-commercial
      └─ findEvidence(snapshotKind="product-ads-insights")
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modify | Import Product Ads types, add `product-ads-insights` TTL/default page entry, add exported `processSellerProductAds`, call it once per seller after reputation, and persist evidence/checkpoint. |
| `packages/agent/src/conversation/operationalEvidenceProvider.ts` | No code change | Existing mapping already returns Product Ads for market/campaign evidence; add tests only unless implementation reveals a bug. |
| `packages/memory/src/operationalReadModel.ts` | No code change | Existing schema accepts arbitrary `kind`, deterministic `evidence_id`, JSON data, and per-kind checkpoints. |
| `packages/domain/src/cacheFreshness.ts` | No code change | Existing `BusinessSignalKind` already includes `product-ads-insights`. |
| `packages/mercadolibre/src/index.ts` | No code change | Existing client already normalizes `noMutationExecuted`, ROAS metadata, date range, and freshness. |
| `packages/agent/tests/conversation/backgroundIngestion.test.ts` | Modify | Add compact Product Ads persistence, checkpoint, optional client skip, and no-access graceful skip tests. |
| `packages/agent/tests/conversation/operationalEvidenceProvider.test.ts` | Modify | Add explicit market-catalog and creative-commercial durable Product Ads evidence scenarios if current coverage is not specific enough. |

## Interfaces / Contracts

```ts
export async function processSellerProductAds(
  config: BackgroundIngestionConfig,
  sellerId: string,
): Promise<{ persisted: boolean }>;
```

Snapshot contract:
- `kind`: `"product-ads-insights"`
- `entityId`: `${dateFrom}_${dateTo}`
- `evidenceId`: `orm:product-ads-insights:${sellerId}:${dateFrom}_${dateTo}:${capturedAt}`
- `data`: `MlcProductAdsInsights` plus existing `noMutationExecuted: true`, `performanceMetric: "roas"`, and transitional metric metadata from the client snapshot
- `source`: `"mercadolibre-api"`; `completeness`, `confidence`, and `freshness` copied from the client snapshot

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Product Ads processor persists snapshot and checkpoint | In-memory `better-sqlite3` via `createSqliteOperationalReadModel`, compact mocked `getProductAdsInsights`. |
| Unit | Optional/no-access behavior | Mock missing method and thrown 401/403/404/no-advertiser error; assert no throw, no mutation, no snapshot. |
| Unit | Lane retrieval | Use `OperationalEvidenceProvider` mock reader for `product-ads-insights` on `market-catalog` and `creative-commercial`. |
| Integration | Full ingestion cycle wiring | Existing background ingestion test pattern with interval disabled/short-lived worker if needed; prefer direct exported processor for review size. |
| E2E | Not required | No UI or external workflow change in this slice. |

## Migration / Rollout

No schema migration required. Roll out by deploying the processor; Product Ads snapshots start appearing after the next background cycle for sellers with access. Rollback is deleting the processor call/tests; existing live Product Ads reads and lane mappings remain unchanged. No persisted data deletion is required because dormant snapshots are ignored unless queried by kind.

## Open Questions

- [ ] None.
