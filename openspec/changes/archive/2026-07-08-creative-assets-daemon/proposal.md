# Proposal: Creative Assets Monitoring Daemon

## Intent

Listings with poor creative assets silently bleed revenue — zero centralized monitoring exists for image count, moderation blocks, or creative quality. The existing `creativeCommercialDaemon` detects visit/conversion issues but never inspects images.

**Problem**: Blocked listings get advertised (wasted spend), listings with 0-1 images lose conversion, and no daemon cross-references creative health with traffic patterns.

**Value**: Surface creative-asset risks before they hurt revenue. 5 signals, proposal-only (no mutations).

## Scope

### In Scope
- Hybrid ingestion pipeline: `processSellerCreativeAssets()` — uses existing listing snapshots + `getModerationStatus()` + Phase 7 PICTURES score
- New `creative_snapshot` ORM kind (24h TTL, 1 page/seller cycle)
- 5 MVP signals: low image count (warning), active moderation/blocked (warning), poor PICTURES score (warning), high-traffic + poor creative composite (warning), moderated-in-campaign (critical)
- Lane registration: `creative-assets` lane + daemon handler in scheduler
- Composite "high traffic" intelligence: cross-references `visit_snapshot` (Cortex), `creative_snapshot` (ORM), `product-ads-insights` (ORM). No single threshold — daemon evaluates visit volume vs seller average, visit trend, PICTURES score, image count, and campaign membership to decide notification

### Out of Scope
- Per-image diagnostics (`diagnoseImage()`) — deferred to iteration 2 for high-traffic listings only
- Automated image remediation (upload, replace) — proposal-only
- Picture-level granularity — moderation at item level for MVP

## Capabilities

### New Capabilities
- `creative-assets-daemon`: investigation-only daemon reading creative snapshots, visit data, and moderation status to detect image quality, count, and blocked-creative signals

### Modified Capabilities
- `daemon-scheduler`: add `creative-assets` to handler map (agent-to-daemon routing)
- `specialist-daemons`: add requirement + scenarios for creative-assets-daemon

## Approach

**Hybrid ingestion (option 3 from exploration):**
1. Reuse existing listing snapshot `pictureCount` from `processSellerListings`
2. Call `getModerationStatus()` per listing (batch-aware, 429 backoff)
3. Pull PICTURES score from existing Phase 7 quality checks
4. Upsert `creative_snapshot` to ORM with 24h TTL
5. Daemon reads snapshots + Cortex visits + ads insights → composite assessment → enqueue CEO proposals

**Registration pattern** (4 steps, matching 5 existing daemons):
1. `LaneId`: add `"creative-assets"` to union
2. `LaneContract`: `CREATIVE_ASSETS_LANE` with `requiredEvidenceKinds` + boundaries
3. `companyAgents`: `laneDepartments[creative-assets] = "commercial"`
4. Daemon handler map: register in `daemonScheduler.ts`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/creativeAssetsDaemon.ts` | New | DaemonHandler — investigation logic + 5 signal detectors |
| `packages/agent/tests/workers/creativeAssetsDaemon.test.ts` | New | Signal detection + composite intelligence tests |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Register handler in map (+3 LOC) |
| `packages/agent/src/conversation/lanes.ts` | Modified | LaneId + CREATIVE_ASSETS_LANE contract (+35 LOC) |
| `packages/agent/src/conversation/companyAgents.ts` | Modified | laneDepartments mapping (+1 LOC) |
| `packages/agent/src/conversation/backgroundIngestion.ts` | Modified | processSellerCreativeAssets + TTL + PAGES (+85 LOC) |
| `openspec/specs/specialist-daemons/spec.md` | Modified | New requirement + scenarios (+25 LOC) |
| `openspec/specs/daemon-scheduler/spec.md` | Modified | Handler map update (+3 LOC) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 429 rate-limit on per-item `getModerationStatus()` | Medium | Batch 50/cycle, backoff; lightweight fallback with listing data only |
| Item Performance API deprecation | Low | `/performance` endpoint already returns same PICTURES data |
| 24h TTL misses fast moderation changes | Low | Accept for MVP; moderation operates on hour/day scale |
| Composite false positives (high-traffic + poor creative) | Medium | Multiple parameters soften single-threshold risk; `warning` not `critical`; CEO reviews |

## Rollback

Remove handler from `daemonHandlerMap` + delete `creativeAssetsDaemon.ts`. Ingestion processor can be no-op'd by removing from main loop call. No data migration needed — snapshots expire naturally.

## Dependencies

- Existing `OperationalReadModelReader.searchSnapshots()` for `creative_snapshot` reads
- Cortex `visit_snapshot` nodes and `product-ads-insights` snapshots (already ingested)
- `getModerationStatus()` in `MlcApiClient` (already implemented)

## Success Criteria

- [ ] Daemon detects listings with < 2 images and enqueues warning proposal
- [ ] Daemon detects blocked/moderated listings and enqueues warning proposal
- [ ] Composite signal fires when a listing has high traffic AND poor creative quality
- [ ] Moderated-in-campaign detection fires (critical) when blocked listing is in active ad
- [ ] Daemon returns empty findings when all images are healthy
- [ ] Ingestion pipeline persists creative_snapshot data via ORM with 24h freshness
