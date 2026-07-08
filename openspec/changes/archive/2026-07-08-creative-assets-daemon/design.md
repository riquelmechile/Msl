# Design: Creative Assets Monitoring Daemon

## Technical Approach

Two-phase architecture: (1) `processSellerCreativeAssets()` in `backgroundIngestion.ts` persists `creative-snapshot` ORM rows with 24h TTL, reusing existing listing snapshots plus fresh `getModerationStatus()` + Phase 7 PICTURES data per item. (2) `creativeAssetsDaemon.ts` reads snapshots + Cortex visits + product-ads-insights, applies five isolated signal checks, enqueues grouped CEO proposals with hourly dedupe keys. No new external API endpoints — all data sources already ingested.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Stand-alone API calls per listing | Complete data but heavy rate-limit risk | Piggyback on existing listing ingestion. `pictureCount` from listing snapshots, moderation + PICTURES as incremental enrichment |
| Per-item `diagnoseImage()` for MVP | Per-image quality but 1 call/picture, 429 risk | Deferred to iteration 2. MVP uses PICTURES score (already ingested) |
| Per-signal proposal enqueue | Fine-grained but noisy | Group by severity tier (warning/critical) with hourly key, matching `productAdsMonitorDaemon` pattern |

## Data Flow

```
processSellerListings (existing)           processSellerCreativeAssets (NEW)
         │                                           │
         ├─ listing snapshot (ORM)                   ├─ listing snapshot → pictureCount
         ├─ visit_snapshot (Cortex)                  ├─ getModerationStatus() → blocked/wordings
         └─ getItemPerformance (Phase 7)             ├─ Phase 7 PICTURES → score/status
                                                     └─ upsert creative-snapshot (ORM, 24h TTL)

                creativeAssetsDaemon (NEW)
                         │
         ┌───────────────┼──────────────────────┐
         ▼               ▼                       ▼
   creative_snapshot   visit_snapshot     product-ads-insights
       (ORM)            (Cortex)              (ORM)
         │               │                       │
         └───────────────┴───────────────────────┘
                         │
                  5 signal checks
                         │
              CEO proposals (grouped, hourly dedupe)
```

## Ingestion Pipeline

`processSellerCreativeAssets(config, sellerId)` follows `processSellerProductAds` pattern:
1. Read listing snapshots from ORM via `reader.searchSnapshots({ kind: "listing", sellerId })`
2. Iterate active listings (batch 50/cycle), for each: pull `pictureCount` from listing data, call `getModerationStatus()`, extract PICTURES score from Phase 7 quality snapshots (Cortex)
3. Upsert `creative-snapshot` to ORM with 24h TTL
4. `upsertCheckpoint(sellerId, "creative-snapshot", capturedAt)`
5. Rate-limit: 50 items/cycle, 429 backoff (retry-after), remaining items skip enrichment

**CreativeSnapshotData type:**
```typescript
type CreativeSnapshotData = {
  itemId: string;
  pictureCount: number;
  variationPictureCount: number;
  hasMainImage: boolean;
  moderationStatus: "none" | "active" | "paused" | "blocked";
  moderationTags: string[];
  moderationWordings: Array<{ kind: string; value: string }>;
  performancePicturesStatus?: "COMPLETED" | "PENDING";
  performancePicturesScore?: number;
  capturedAt: string;
};
```

## Signal Detection Algorithms

All five isolated in try/catch, each returning `DaemonFinding[]`.

| # | Signal | Severity | Rule | Data Sources |
|---|--------|----------|------|-------------|
| 1 | Low image count | warning | `pictureCount < 2` | creative_snapshot |
| 2 | Moderation blocked | warning | `moderationStatus === "blocked"` AND listing active | creative_snapshot |
| 3 | Poor PICTURES | warning | `performancePicturesStatus === "PENDING"` | creative_snapshot |
| 4 | High-traffic + poor creative | warning | visits > seller average AND (PICTURES PENDING OR pictureCount < 2 OR blocked) | creative_snapshot + visit_snapshot (Cortex) |
| 5 | Moderated-in-campaign | critical | blocked AND itemId in active campaign ads[] | creative_snapshot + product-ads-insights |

**Signal 4 composite intelligence**: compute seller-average visit volume from Cortex `visit_snapshot` per `sellerId`. For each listing, compare its `totalVisits` against seller average. If visits exceed average AND any creative quality indicator is below threshold (PICTURES PENDING, pictureCount < 2, or blocked), fire warning. Single-threshold risk mitigated by multi-parameter evaluation per spec.

**Signal 5**: fetch product-ads-insights per seller, build `Set<itemId>` from active ads (status !== "paused"). Cross-reference with blocked items from creative_snapshot.

## Dedupe Key Design

`creative-assets:{severityGroup}:{hour}` — groups findings by severity tier (warnings/criticals). Same pattern as `productAdsMonitorDaemon` (`product-ads-{kind}-{capturedAt.slice(0,13)}`).

## Error Handling

Each signal check wrapped in `try/catch { /* isolated */ }`. Ingestion failures (`getModerationStatus` 429) skip the item and continue. Missing Cortex data (`visit_snapshot`, `product-ads-insights`) causes individual signals to skip without error. Empty snapshots return `{ findings: [], proposalEnqueued: false }`.

## Lane Registration

Four files, four changes:
- `lanes.ts`: add `"creative-assets"` to `LaneId` union; new `CREATIVE_ASSETS_LANE` contract (requiredEvidenceKinds: `["creative-snapshot", "visit-snapshot", "product-ads-insights"]`); add to `LANE_CONTRACTS`
- `companyAgents.ts`: `laneDepartments["creative-assets"] = "commercial"`
- `daemonScheduler.ts`: import `creativeAssetsDaemon`, add `"creative-assets": creativeAssetsDaemon` to `daemonHandlerMap`
- `backgroundIngestion.ts`: add `KIND_FRESHNESS_TTL["creative-snapshot"]` (24h), `KIND_DEFAULT_MAX_PAGES["creative-snapshot"]` (1), call `processSellerCreativeAssets()` in main loop

## Test Design

| Layer | What | Approach |
|-------|------|----------|
| Unit: signal 1-3 | Low count, blocked, poor PICTURES | Mock `reader.searchSnapshots()` → assert finding kind + severity |
| Unit: signal 4 | Composite intelligence | Mock visits > avg + pictureCount < 2 → assert finding; mock visits > avg + all healthy → assert no finding |
| Unit: signal 5 | Moderated-in-campaign | Mock blocked creative + active ad → assert critical finding; mock blocked, no ad → assert only R2 warning |
| Unit: pipeline | processSellerCreativeAssets | Mock `getModerationStatus`, verify upsertSnapshot called with correct kind + TTL |
| Integration | Full daemon handler | Mock reader + cortex + bus → verify enqueue count, dedupe key format, noMutationExecuted |

## PM2 Impact

No new process. Handler map entry in `daemonScheduler.ts` (+1 line), scheduler picks it up automatically. Ingestion runs within existing `startBackgroundIngestion()` interval (6h).

## Open Questions

- [ ] What is the exact PICTURES score threshold for "poor"? Exploration says `PICTURES_QUANTITY_MIN` with `status: "PENDING"` — confirm this is the correct rule to check
- [ ] Should signal 4 use seller average or top percentile for visit threshold? Design assumes seller average; can refine during implementation
