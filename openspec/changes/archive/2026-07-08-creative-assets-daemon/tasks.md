# Tasks: Creative Assets Monitoring Daemon

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~576 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-forecast |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Infrastructure + ingestion | PR 1 | base=main; ~191 LOC: lanes, types, processSellerCreativeAssets, wiring, ingestion tests |
| 2 | Daemon signals 1-3 | PR 2 | base=main; ~200 LOC: creativeAssetsDaemon low-count/blocked/PICTURES detection + tests |
| 3 | Composite signals 4-5 | PR 3 | base=main; ~185 LOC: high-traffic composite, moderated-in-campaign + integration tests |

## Phase 1: Foundation & Ingestion

- [x] 1.1 `lanes.ts`: add `"creative-assets"` LaneId + CREATIVE_ASSETS_LANE contract with requiredEvidenceKinds
- [x] 1.2 `companyAgents.ts`: laneDepartments["creative-assets"] = "commercial"
- [x] 1.3 `backgroundIngestion.ts`: CreativeSnapshotData type, KIND_FRESHNESS_TTL 24h, KIND_DEFAULT_MAX_PAGES=1
- [x] 1.4 `backgroundIngestion.ts`: implement processSellerCreativeAssets() — read listing snapshots, getModerationStatus (batch 50, 429 backoff), pull PICTURES score, upsert creative-snapshot ORM
- [x] 1.5 `backgroundIngestion.ts`: wire into main ingestion loop
- [x] 1.6 `daemonScheduler.ts`: handler map entry for "creative-assets"
- [x] 1.7 `index.ts`: export daemon handler

## Phase 2: Daemon Core (Signals 1-3)

- [x] 2.1 `creativeAssetsDaemon.ts`: DaemonHandler with run(), noMutationExecuted, hourly dedupe key
- [x] 2.2 Signal 1: pictureCount < 2 → warning "low-image-count"
- [x] 2.3 Signal 2: blocked + active listing → warning "moderation-blocked"
- [x] 2.4 Signal 3: PICTURES status PENDING → warning "poor-pictures-score"
- [x] 2.5 Group findings by severity tier, enqueue with dedupe key

## Phase 3: Composite Signals (4-5)

- [x] 3.1 Signal 4: compute seller avg visits from Cortex, per-item comparison — visits > avg AND (PICTURES PENDING OR count<2 OR blocked) → warning "high-traffic-poor-creative"
- [x] 3.2 Signal 5: build active-ads itemId Set from product-ads-insights, cross-ref blocked items → critical "moderated-in-campaign"
- [x] 3.3 Isolated error handling: try/catch per signal, missing data skips silently

## Phase 4: Testing

- [x] 4.1 Unit: processSellerCreativeAssets persists creative-snapshot with 24h TTL
- [x] 4.2 Unit: 429 backoff skips remaining items without error
- [x] 4.3 Unit: Signal 1 — pictureCount=0 yields warning low-image-count
- [x] 4.4 Unit: Signal 2 — blocked + active yields warning moderation-blocked
- [x] 4.5 Unit: Signal 3 — PICTURES PENDING yields warning poor-pictures-score
- [x] 4.6 Unit: Signal 4 — visits>avg + poor creative fires; healthy creative skips
- [x] 4.7 Unit: Signal 5 — blocked+active-ad yields critical; blocked no-ad yields only R2 warning
- [x] 4.8 Integration: full daemon run — verify findings count, dedupe key format, noMutationExecuted
