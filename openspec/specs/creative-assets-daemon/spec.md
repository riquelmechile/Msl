# creative-assets-daemon Specification

## Purpose

Investigation-only daemon reading creative snapshots, visit data, moderation status, and ad insights to detect image quality, count, and blocked-creative signals. Enqueues CEO proposals — never mutates.

## Requirements

### Requirement: Creative Signal Detection

The daemon MUST detect five signals from `creative_snapshot`, Cortex `visit_snapshot`, and `product-ads-insights`:

| Signal | Severity | Rule |
|--------|----------|------|
| Low Image Count | warning | `pictureCount < 2` |
| Active Moderation Block | warning | `getModerationStatus()` blocked, listing active |
| Poor PICTURES Score | warning | Phase 7 PICTURES below threshold |
| High-Traffic + Poor Creative | warning | Visits > seller avg AND (PICTURES < threshold OR pictureCount < 2 OR blocked) |
| Moderated-in-Campaign | critical | Blocked AND in active Product Ads campaign |

Composite intelligence (Signal 4) MUST evaluate multiple parameters — visit volume vs seller average, visit trend, PICTURES score, image count, campaign membership — with no single threshold.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Zero images | pictureCount=0 | Daemon runs | Finding "warning", kind "low-image-count" |
| Blocked active | moderation=blocked, active listing | Daemon runs | Finding "warning", kind "moderation-blocked" |
| Poor PICTURES | score below threshold | Daemon runs | Finding "warning", kind "poor-pictures-score" |
| High-traffic composite | visits > avg, pictureCount<2 | Evaluate composite | Finding "warning", kind "high-traffic-poor-creative" |
| High-traffic good creative | visits > avg, images OK, score OK | Evaluate composite | No finding |
| Moderated-in-campaign | blocked + active ads campaign | Cross-reference | Finding "critical", kind "moderated-in-campaign" |
| Blocked, no campaign | blocked, not in any campaign | Cross-reference | Escalates to R2 warning only |
| All healthy | All checks pass | Daemon runs | Empty findings, proposalEnqueued: false |

### Requirement: Ingestion Pipeline

`processSellerCreativeAssets()` MUST reuse listing snapshots for `pictureCount`, call `getModerationStatus()` per item with batch sizing (50/cycle) and 429 backoff, pull PICTURES from Phase 7, and upsert `creative_snapshot` to ORM with 24h TTL.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Full ingest | Seller has active listings | Ingestion runs | creative_snapshot persisted, 24h TTL |
| Rate-limited | 429 from moderation API | Batch hits limit | Backoff; remaining items use listing data only |
| Missing Phase 7 | No PICTURES score | Ingestion runs | PICTURES null; R3+R4 skip |

### Requirement: Lane Registration

The daemon MUST register via `LaneId: "creative-assets"`, `CREATIVE_ASSETS_LANE` contract, `laneDepartments["creative-assets"]="commercial"`, and a handler entry in `daemonScheduler.ts`.

### Requirement: No-Mutation & Dedupe

The daemon MUST set `noMutationExecuted: true`, SHALL NOT call ML write APIs, and MUST use hourly dedupe keys (`creative-assets:{sellerId}:{itemId}:{signalKind}:{hour}`).

### Requirement: Graceful Degradation

Missing data (no visit snapshots, no ads insights, no moderation response) SHALL cause individual signal checks to skip without error propagation. Empty snapshots SHALL return `{ findings: [], proposalEnqueued: false }`.
