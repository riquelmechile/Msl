# Design: Full Product Launch Cycle (P2)

## Technical Approach

Additive team of 11 worker daemons across 5 new lanes, orchestrated by a `ProductLaunchCoordinator` via the existing Agent Message Bus. All daemons follow the `creativeStudioDaemon` pattern: claim → parse → gate → execute → save → enqueue → Cortex. Writes remain blocked (`assertMercadoLibreWriteDisabled` unchanged). Launches produce validated-ready packages for CEO approval. No mutation reaches ML servers.

## Architecture Decisions

| Decision | Option | Tradeoff | Choice |
|---|---|---|---|
| Worker architecture | Monolithic agent vs team of daemons via Agent Message Bus | Monolith is simpler but violates existing 15-daemon pattern. Team enables parallel execution, independent testing, and cache-friendly lane prefixes | **Team of daemons** — follows `creativeStudioDaemon` pattern, reuses bus lifecycle |
| Google Lens integration | DeepSeek Vision vs SerpApi Google Lens API | DeepSeek Vision requires image download+upload; Google Lens accepts URL → $0.005, 1-3s latency, structured JSON | **SerpApi Google Lens** — cheaper, faster, URL-based |
| Image sourcing | Download bytes → MiniMax vs pass URLs directly | `minimax-image-provider.ts:buildSubjectReference()` passes `imageRef.uri` as string to `subject_reference` — MiniMax downloads on their side | **URL passthrough** — zero download cost, verified in existing code |
| Photo entrypoint | New `message:photo` handler vs repurpose `message:text` | Text handler silently ignores images; photo handler required | **`bot.on("message:photo")`** — additive, zero-impact on existing text path |
| Product DB | New SQLite store vs reuse Cortex graph | Cortex is a neural graph optimized for learning; product catalog needs structured queries (GTIN lookup, launch history) | **New SQLite store** — `product_catalog/product_images/product_launches` tables in agent SQLite DB |
| ML upload gating | Write gate stays blocked vs conditional | Exploration found `assertMercadoLibreWriteDisabled()` throws unconditionally. P2 only reads from ML | **Write gate unchanged** — `publishItem` unreachable; `diagnoseImage` (read-only) reused |
| Cache | Lane prefixes for all DeepSeek calls | Every lane gets stable system prompt prefix; repeated launches hit cache discount | **Lane-prefix cache** — same 3-block strategy as existing 16 lanes |

## Data Flow

```
Telegram photo → CoordinatorDaemon claims → delegates in stages:
  VisionAnalyst (Google Lens) → MarketResearcher (DeepSeek) ∥ CatalogSpecialist (ML API)
  → PhotoDirector (quality score) → StudioArtist (MiniMax)
  → Copywriter (DeepSeek) → SpecTechnician (ML attrs) → QualityInspector (ML pre-flight)
  → CEO approval → outcome → Cortex
```

Each stage enqueues the next via `bus.enqueue({ receiverAgentId: nextLane })`. Coordinator polls for its `product-launch` lane messages, claims, delegates, awaits child resolution.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/domain/src/productLaunch.ts` | Create | `ProductLaunch`, `ProductContext`, `ImageQualityScore` types + state machine |
| `packages/domain/src/productCatalog.ts` | Create | `ProductCatalogStore` interface |
| `packages/agent/src/workers/productLaunchCoordinator.ts` | Create | CoordinatorDaemon — claims, delegates, reports progress |
| `packages/agent/src/workers/visionAnalyst.ts` | Create | SerpApi Google Lens → structured recognition |
| `packages/agent/src/workers/marketResearcher.ts` | Create | DeepSeek web search → specs, competition |
| `packages/agent/src/workers/catalogSpecialist.ts` | Create | ML `domain_discovery/search` → catalog_product_id |
| `packages/agent/src/workers/photoDirector.ts` | Create | Image quality scoring (0-100) + routing decision |
| `packages/agent/src/workers/imageScout.ts` | Create | Google Lens image search → URLs (no download) |
| `packages/agent/src/workers/studioArtist.ts` | Create | Wraps `creativeStudioDaemon` — adds lazy generation logic |
| `packages/agent/src/workers/copywriter.ts` | Create | DeepSeek: title+description (account-aware) |
| `packages/agent/src/workers/specTechnician.ts` | Create | ML `GET /categories/{id}/attributes` validation |
| `packages/agent/src/workers/qualityInspector.ts` | Create | ML `/items/{id}/performance` pre-flight |
| `packages/agent/src/conversation/lanes.ts` | Modify | ADD 5 lanes: `product-launch`, `product-recognition`, `product-research`, `creative-production`, `listing-composition` |
| `packages/agent/src/conversation/tools/productLaunchTools.ts` | Create | CEO tools: `launch_product`, `query_launch_status` |
| `packages/agent/src/economics/launchCostTracker.ts` | Create | Per-launch cost aggregation → `WorkforceCostCacheLedger` |
| `packages/agent/src/workers/productCatalogStore.ts` | Create | SQLite `ProductCatalogStore` impl (3 tables) |
| `packages/agent/src/workers/daemonHandlerMap.ts` | Modify | Register 11 new daemon handlers |
| `packages/agent/src/readiness/productionReadinessService.ts` | Modify | ADD `product-launch` capability check |
| `packages/bot/src/index.ts` | Modify | ADD `bot.on("message:photo")` handler |

## Lane Contracts

```typescript
// 5 new lanes added to LANE_CONTRACTS:
{ laneId: "product-launch", stablePrefix: "You are the Product Launch Coordinator..." },
{ laneId: "product-recognition", stablePrefix: "You are the Vision Analyst..." },
{ laneId: "product-research", stablePrefix: "You are the Market Researcher..." },
{ laneId: "creative-production", stablePrefix: "You are the Photo Director..." },
{ laneId: "listing-composition", stablePrefix: "You are the Listing Composer..." }
```

All follow existing `LaneContract` format with stable prefix for DeepSeek caching, phase-one boundaries, and `proposal-only` guard.

## Database Schema (SQLite)

```sql
CREATE TABLE product_catalog (
  product_id TEXT PRIMARY KEY, gtin TEXT, brand TEXT, model TEXT,
  category_ml TEXT, attributes_json TEXT, first_seen_at TEXT, last_launched_at TEXT
);
CREATE TABLE product_images (
  image_id TEXT PRIMARY KEY, product_id TEXT REFERENCES product_catalog,
  url TEXT NOT NULL, source TEXT CHECK(source IN ('lens','minimax','web','ceo_telegram')),
  quality_score INTEGER, width INTEGER, height INTEGER, ml_diagnostic_json TEXT, created_at TEXT
);
CREATE TABLE product_launches (
  launch_id TEXT PRIMARY KEY, product_id TEXT REFERENCES product_catalog,
  seller_id TEXT NOT NULL, ml_item_id TEXT, listing_type TEXT, price_amount INTEGER,
  price_currency TEXT, title TEXT, description TEXT, quality_score_predicted INTEGER,
  quality_score_actual INTEGER, cost_total_usd REAL,
  status TEXT CHECK(status IN ('photo_received','recognizing','researching','generating_creative',
    'composing','awaiting_approval','approved','ready_to_publish','rejected')),
  created_at TEXT, completed_at TEXT
);
```

## State Machine

```
photo_received → recognizing → researching → generating_creative → composing → awaiting_approval → approved → ready_to_publish
                                                                       ↘ rejected
```

Transitions enforced in `ProductLaunch.transition(newState)`. Invalid jumps throw. Coordinator claims by `status`, processes, transitions, enqueues next.

## Cost Model per Launch

| Component | Calls | $/call | Total |
|---|---|---|---|
| Google Lens | 1 | $0.005 | $0.005 |
| DeepSeek (research+composer) | 3-4 | ~$0.01 | $0.04 |
| MiniMax | 2-4 | $0.015 | $0.03-0.06 |
| **Total** | | | **$0.08-0.10** |

Tracked via `LaunchCostTracker` → `WorkforceCostCacheLedger`. MiniMax daily cap: $5 (existing env `MSL_CREATIVE_STUDIO_MAX_DAILY_USD`).

## Telegram Integration

`bot.on("message:photo")` handler in `packages/bot/src/index.ts`:
1. `ctx.getFile()` → download highest-res variant
2. Save to `.msl/product-photos/{chatId}/{timestamp}.jpg`
3. Extract caption as title hint
4. Create `ProductLaunch` in `photo_received` state
5. `bus.enqueue({ receiverAgentId: "product-launch", payloadJson })`
6. Coordinator sends progressive updates via `sendProactiveMessage(chatId, text)`

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. All workers use existing Agent Message Bus and HTTP API calls.

## Migration / Rollout

Zero-downtime, fully additive:
- New daemon handlers registered in `daemonHandlerMap` — existing daemons unaffected
- `bot.on("message:photo")` added alongside existing `message:text` — no text-path impact
- New SQLite tables created via migration, no existing data altered
- Write gate unchanged (`assertMercadoLibreWriteDisabled` stays)
- Rollback: remove `message:photo` handler + remove new lanes from `LANE_CONTRACTS`

## Open Questions

- [ ] CEO confirmation step design: inline reply parsing vs structured button UI for "which product" / "approve listing" decisions
- [ ] ImageScout: Google Lens image search availability via SerpApi — verify `engine=google_lens` supports image URL input for product image search
- [ ] Google Lens fallback to Bing Visual Search: implementation deferred or included in MVP?
