# Delta for specialist-daemons

## ADDED Requirements

### Requirement: creativeAssetsDaemon

`creativeAssetsDaemon` MUST read `creative_snapshot` ORM data, Cortex `visit_snapshot` nodes, and `product-ads-insights` snapshots. It SHALL detect 5 signals: low image count (< 2, `warning`), active moderation block (`warning`), poor PICTURES score (`warning`), high-traffic + poor creative composite (`warning`), and moderated-in-campaign (`critical`). Composite intelligence MUST evaluate multiple parameters (visit volume vs seller avg, visit trend, PICTURES score, image count, campaign membership) — no single threshold. It MUST enqueue proposals with hourly dedupe keys and `noMutationExecuted: true`. Missing data SHALL cause individual signals to skip without error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Low image count | creative_snapshot: pictureCount < 2 | Daemon investigates | Finding severity "warning", kind "low-image-count" |
| Moderation blocked | Moderation status blocked, listing active | Daemon investigates | Finding severity "warning", kind "moderation-blocked" |
| Poor PICTURES score | PICTURES score below threshold | Daemon investigates | Finding severity "warning", kind "poor-pictures-score" |
| High-traffic + poor creative | Visits > seller avg, pictureCount < 2 or blocked | Composite evaluation | Finding severity "warning", kind "high-traffic-poor-creative" |
| Moderated-in-campaign | Blocked AND in active ads campaign | Daemon cross-references | Finding severity "critical", kind "moderated-in-campaign" |
| No signals | All checks pass or data missing | Daemon investigates | Empty findings, proposalEnqueued: false |
| Missing visit data | No visit_snapshot for item | Daemon investigates | R4 skipped; other signals unaffected |
| All data missing | No snapshots available | Daemon investigates | Empty findings, no error |
