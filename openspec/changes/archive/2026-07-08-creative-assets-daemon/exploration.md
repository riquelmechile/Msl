## Exploration: creative-assets-daemon

### Current State
The system has zero centralized creative asset monitoring. Image-related data lives across:
- **MlItem.pictures** — basic `{ url }` array per listing, accessible via `mlcClient.getItem()`
- **getModerationStatus()** — per-item moderation results (WATERMARK, MULTIPLE, etc.)
- **diagnoseImage()** — per-image diagnostic before upload (white_background, text_logo, watermark, minimum_size)
- **getItemPerformance()** — PICTURES_QUANTITY_MIN rule in the CHARACTERISTICS bucket
- **Image orchestration flow** — 4-step prepare-only flow (diagnose → upload → associate → check) already typed but not executed by any daemon

The existing `creativeCommercialDaemon` detects high-visit low-conversion and stagnant stock, but does NOT inspect image quality, count, or moderation. The only image quality check that runs today is the Phase 7 quality checks in `backgroundIngestion.ts`, which uses `getItemPerformance()` for the overall score but doesn't specialize on image data.

### Affected Areas

| Area | File | Why Affected |
|------|------|-------------|
| **New daemon handler** | `packages/agent/src/workers/creativeAssetsDaemon.ts` | New `DaemonHandler` for creative asset signals |
| **Daemon scheduler** | `packages/agent/src/workers/daemonScheduler.ts` | Register new handler in `daemonHandlerMap` |
| **Lanes** | `packages/agent/src/conversation/lanes.ts` | New `LaneId` + `LaneContract` for creative-assets |
| **Company agents** | `packages/agent/src/conversation/companyAgents.ts` | Add department mapping |
| **Background ingestion** | `packages/agent/src/conversation/backgroundIngestion.ts` | New processor `processSellerCreativeAssets()`, new `KIND_FRESHNESS_TTL` entry, new `KIND_DEFAULT_MAX_PAGES` entry |
| **MercadoLibre types** | `packages/mercadolibre/src/index.ts` | New snapshot type `creative-snapshot`, new types for creative asset data summary |
| **Specs** | `openspec/specs/specialist-daemons/spec.md` | Add requirement for creative-assets-daemon |
| **Specs** | `openspec/specs/daemon-scheduler/spec.md` | Update agent-to-daemon handler map doc |

### Available APIs

#### MerecadoLibre Image/Creative APIs

| API | Endpoint | MlcApiClient Method | Returns | Status |
|-----|----------|-------------------|---------|--------|
| Item Pictures | `GET /items/{id}` → `.pictures[]` | `getItem()` | `Array<{ url: string }>` — no picture IDs, no moderation flags | ✅ Implemented |
| Image Diagnostics | `POST /moderations/pictures/diagnostic` | `diagnoseImage()` | `{ diagnosticId, diagnostics: [{ pictureType, action, detections }] }` — detections: white_background, minimum_size, text_logo, watermark | ✅ Implemented |
| Image Upload | `POST /pictures/items/upload` | `uploadImage()` | `{ pictureId, variations }` | ✅ Implemented |
| Image Associate | `POST /items/{id}/pictures` | `associateImageToItem()` | `{ itemId, pictureId, status }` (prepare-only) | ✅ Implemented |
| Image Moderation | `GET /moderations/last_moderation/{id}` | `getModerationStatus()` | `{ itemId, blocked, wordings(REASON/REMEDY), evidence(text_matched, section_name) }` | ✅ Implemented |
| Item Performance | `GET /item/{id}/performance` | `getItemPerformance()` | Bucket `CHARACTERISTICS` → variable `PICTURES` → rule `PICTURES_QUANTITY_MIN` with status/progress | ✅ Implemented |
| Orchestration (meta) | N/A (typed flow) | `normalizeImageOrchestration()` | 4-step flow: diagnose → upload → associate → check | ✅ Prepare-only |

#### Key Data Gaps

1. **No bulk picture read**. `getItem()` returns the full item but the `pictures` field is just `Array<{ url: string }>` — no picture IDs, no upload date, no moderation status per picture.
2. **No listing-level image diagnostics in bulk**. `diagnoseImage()` is a per-image API costing 1 HTTP call per picture URL. Rate-limited at app-level (429s documented).
3. **`getModerationStatus()` works at ITEM level**, not at the individual picture level. The `evidence.text_matched` field can contain picture IDs, but this is after a moderation event has occurred.
4. **No `getListingPictures()` method** exists — would need to be created by extracting pictures from `getItem()` response.
5. **Item Performance API** (`/item/{id}/performance`) — this is being deprecated/replaced by a new Performance API. The current one has a PICTURES_QUANTITY_MIN rule.

#### Image Diagnostics Detection Types
- `white_background` — non-white backgrounds
- `minimum_size` — fails min size requirements
- `text_logo` — unauthorized texts or logos
- `watermark` — watermarks detected

### Ingestion Design

#### What Data to Ingest

A `creative_snapshot` should capture the creative state per listing at a point in time:

```typescript
type CreativeSnapshotData = {
  itemId: string;
  pictureCount: number;
  variationPictureCount: number;
  hasMainImage: boolean;
  moderationStatus: "none" | "active" | "paused" | "blocked";
  moderationTags: string[];      // e.g. ["poor_quality_thumbnail"]
  moderationWordings: Array<{ kind: string; value: string }>;
  moderationEvidence: Array<{ textMatched?: string; sectionName?: string }>;
  performanceScore?: number;     // from getItemPerformance() overall
  performancePicturesScore?: number;   // PICTURES bucket score
  performancePicturesStatus?: "COMPLETED" | "PENDING";  // PICTURES_QUANTITY_MIN rule
  capturedAt: string;
};
```

#### Ingestion Pipeline (`processSellerCreativeAssets`)

```
For each seller:
  1. Fetch listings (already done in processSellerListings — can reuse)
  2. For each active listing:
     a. Call getItem(itemId) for enriched picture data
     b. Call getModerationStatus(itemId) — lightweight, per-item
     c. Call getItemPerformance(itemId) — to get PICTURES quality score
     d. Merge into CreativeSnapshotData
  3. Batch upsert to ORM: operationalStore.upsertSnapshot({ kind: "creative-snapshot", ... })
  4. upsertCheckpoint(sellerId, "creative-snapshot", capturedAt)
```

#### Freshness TTL

- **Creative snapshots**: 24h — images change infrequently, moderation status is read-only
- **Special case**: If moderation is `blocked`, could shorten to 6h (higher priority)

#### Per-Seller Batch Size

- `KIND_DEFAULT_MAX_PAGES.creative` = 1 (simple snapshot per cycle)
- But listing-level calls mean we need to iterate. With up to ~2000 active listings, this needs batching with rate-limit awareness.

**Key concern**: `getItem()` and `getModerationStatus()` are per-item calls. For 500 active listings that's 1000 HTTP calls per cycle. Need to understand the RPM limits.

#### Alternative: Lightweight approach

If per-item calls are too rate-limited, we can use only `getItemPerformance()` (which already runs for Phase 7 quality checks) and `getItem()` results from the existing listing ingestion. The `getItem()` call already returns `pictures` array — we just need to extract `pictureCount` and `variationPictureCount` from the existing data flow.

#### Recommended First Iteration

1. Add `creative_snapshot` kind to ORM
2. Add `processSellerCreativeAssets()` that uses existing listing data + moderation status + performance data
3. Freshness TTL: 24h
4. Rate-limit: batch items, respect 429 with backoff
5. Later iteration can add `diagnoseImage()` calls for specific high-traffic listings only

### Signal Candidates

| # | Signal | Data Source | Feasibility | Effort |
|---|--------|-------------|-------------|--------|
| 1 | **Low image count** (< 2 images) — conversion risk | `getItem().pictures.length` | ✅ High — pictures already in `MlItem` type | Low |
| 2 | **Active moderation** (blocked listing) — hidden/banned risk | `getModerationStatus().blocked === true` | ✅ High — already implemented in MlcApiClient | Low |
| 3 | **Poor image quality** — PICTURES_QUANTITY_MIN PENDING | `getItemPerformance()` → PICTURES bucket score | ✅ High — already in Phase 7 | Low |
| 4 | **High-traffic + poor creative** — cross ref visits + PICTURES score | `visit_snapshot` (Cortex) + `creative_snapshot` (ORM) | ✅ High — both already ingested | Medium |
| 5 | **No main image** — listing has zero pictures | `getItem().pictures.length === 0` | ✅ High | Low |
| 6 | **Image diagnostics issues** (text/logo, watermark) | `diagnoseImage()` per picture URL | ⚠️ Medium — rate-limited, expensive at scale | High |
| 7 | **Stale images** — never updated (no reliable timestamp for images) | `getItem()` — no `last_updated` on pictures array | ❌ Low — no timestamp on pictures in current API | N/A |
| 8 | **Moderated listings in campaigns** — blocked creative can't be promoted | `moderationStatus.blocked` + `product-ads-insights` | ✅ High — cross-reference two existing data sources | Medium |
| 9 | **Low PICTURES score in performance but high visits** | `performance.PICTURES.score < 50` + visits > threshold | ✅ High | Low |

#### Recommended signals for MVP (ordered by value/effort)

1. **Low image count alert** — listings with < 2 pictures (conversion risk)
2. **Active moderation alert** — blocked listings (hidden/banned risk)
3. **Poor image quality alert** — PICTURES_QUANTITY_MIN pending in performance
4. **High-traffic + poor images** — missed revenue from bad creative
5. **Moderated in campaign** — resurface when blocked creative is in active ad

### Architecture Impact

#### New Files

| File | Purpose | Est. LOC |
|------|---------|----------|
| `packages/agent/src/workers/creativeAssetsDaemon.ts` | Daemon handler → reads `creative_snapshot` from ORM, detects signals, enqueues CEO proposals | ~250 |
| `packages/agent/tests/workers/creativeAssetsDaemon.test.ts` | Tests for the daemon handler | ~200 |

#### Modified Files

| File | Change | Est. LOC |
|------|--------|----------|
| `packages/agent/src/workers/daemonScheduler.ts` | Import + register handler in `daemonHandlerMap` | +3 |
| `packages/agent/src/conversation/lanes.ts` | Add `"creative-assets"` to `LaneId`, create `CREATIVE_ASSETS_LANE` contract, add to `LANE_CONTRACTS` | +30 |
| `packages/agent/src/conversation/companyAgents.ts` | Add department mapping (`"creative-assets" → "commercial"`) | +1 |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Add `processSellerCreativeAssets()`, add `KIND_FRESHNESS_TTL` entry, add `KIND_DEFAULT_MAX_PAGES` entry, call from main loop | +80 |
| `packages/mercadolibre/src/index.ts` | Add `MlcCreativeAssetSummary`, `MlcCreativeAssetSnapshot`, `MlcCreativeAssetData` types | +30 |
| `openspec/specs/specialist-daemons/spec.md` | Add requirement for creative-assets-daemon with signal table | +20 |
| `openspec/specs/daemon-scheduler/spec.md` | Update agent-to-daemon handler map to include creative-assets | +3 |

#### Total Estimated LOC

- **New**: ~450 (daemon + tests)
- **Modified**: ~170 across 7 files
- **Total**: ~620 LOC

### Approaches

1. **Full ingestion approach** — stand-alone `processSellerCreativeAssets()` that calls ML APIs per-item
   - Pros: Complete data, own freshness schedule, can add diagnoseImage() later
   - Cons: Many API calls, rate-limit management needed, higher complexity
   - Effort: High (~250 LOC ingestion + 250 LOC daemon)

2. **Lightweight / piggyback approach** — reuse existing listing data from `processSellerListings`, only add `getModerationStatus()` calls
   - Pros: Fewer API calls, faster to implement, reuses existing data flow
   - Cons: No image diagnostic data, no enriched item data
   - Effort: Medium (~150 LOC ingestion + 250 LOC daemon)

3. **Hybrid (recommended)** — start with lightweight for signal set 1-4, add `diagnoseImage()` for high-traffic only in iteration 2
   - Pros: Fast MVP, lower rate-limit risk, iterative enhancement
   - Cons: More code complexity to manage two tiers
   - Effort: Medium (~200 LOC ingestion + 250 LOC daemon)

### Recommendation

**Hybrid approach (option 3)**. The daemon can detect valuable signals using ONLY:
- Picture count from existing listing snapshots (already ingested by `processSellerListings`)
- Moderation status from `getModerationStatus()` (1 API call per listing, paginated)
- PICTURES score from existing Phase 7 quality checks (already ingested)
- Visit data from existing Cortex visit snapshots

This avoids new expensive API calls for the MVP. `diagnoseImage()` can be added later for specific high-traffic listings flagged by the daemon, making it a targeted cost rather than a bulk cost.

### Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Rate limits (429)** on `getModerationStatus()` for large listing sets | Daemon can't check all listings | Batch items (50/cycle), use pagination, implement backoff; start with lightweight approach |
| **Item Performance API deprecation** — docs say `/health` will be replaced by `/performance` | PICTURES score data may change | Monitor ML changelog; the `/performance` endpoint already shows the same PICTURES data |
| **`getItem()` returns enriched data but is heavier** than listing snapshot | Extra bandwidth | Use existing listing snapshot data for picture count; only call `getItem()` when more detail needed |
| **Moderation reference ID** — `getModerationStatus()` needs MODERATION_REFERENCE_ID, which comes from the item's moderation history | May return empty for many listings | That's correct — empty means no moderation, which is the expected "clean" state. Not a blocker. |
| **No picture-level granularity** — moderation status is at the ITEM level, not per-image | Can't tell WHICH image triggered the moderation | Accept limitation for MVP; the `evidence.text_matched` field sometimes contains picture IDs |
| **Freshness TTL vs. real-time needs** — 24h may miss rapid moderation changes | Stale data | Accept 24h for MVP; moderation changes are infrequent (hours/days) |

### Ready for Proposal
Yes. The exploration confirms:
- Sufficient API surface exists for a valuable MVP (signals 1-5)
- The ingestion pipeline has a clear pattern to follow (processSellerProductAds)
- The daemon registration has a well-defined 4-step pattern (LaneId, LaneContract, handler, handlerMap)
- Rate-limit risks are manageable with the hybrid/lightweight approach
- No architectural blockers — the system's daemon/lane/ingestion patterns are mature enough

**Recommended next phase**: sdd-propose
