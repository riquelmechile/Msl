# Delta for specialist-daemons

## MODIFIED Requirements

### Requirement: Shared Daemon Contract

Every daemon MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. `DaemonResult` MUST have `{ findings: DaemonFinding[]; proposalEnqueued: boolean }`. Each finding MUST include `{ kind: string; severity: "info"|"warning"|"critical"; summary: string; evidenceIds: string[] }`.

Daemons SHOULD use `searchSnapshots()` instead of `listSnapshots()` + manual filtering for status, price, and date conditions. Using `searchSnapshots()` SHALL produce identical findings: same detections, same severity levels, same `evidenceIds` references.
(Previously: same text — unchanged contract, only the daemon count updated in Purpose)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Findings returned | Daemon detects signals | investigate() completes | DaemonResult with findings array |
| No findings | No signals detected | investigate() completes | Empty findings, proposalEnqueued: false |
| Error during investigation | Evidence read fails | investigate() throws | Error propagated to scheduler for message fail |
| Migration preserves identical findings | Daemon refactored to use searchSnapshots() | investigate() completes | Same findings, same severities, same evidenceIds as before |

## ADDED Requirements

### Requirement: productAdsMonitorDaemon

`productAdsMonitorDaemon` MUST read `product-ads-insights` snapshots using `searchSnapshots()` and cross-reference Cortex `cost_snapshot` and `visit_snapshot` nodes and ORM `listing_snapshot` data. It SHALL detect at minimum: advertised unprofitable products (price - cost < 0, `critical`), declining visits with active ad (30%+ WoW over 2 weeks, `warning`), cross-account monopoly across Plasticov + Maustian (`info`), per-product ROAS below 1.0 (`warning`), and profitable products missing ads in high-ROAS campaigns (`opportunity`). It MUST enqueue CEO proposals with hourly dedupe keys and `noMutationExecuted: true`. Missing data SHALL cause individual signal checks to skip without error.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unprofitable advertised product | Ad runs, price - cost < 0 via cost_snapshot | Daemon investigates | Finding with severity "critical", kind "alert" |
| Declining visits with active ad | WoW visits ↓ 30%+ for 2+ weeks, ad is active | Daemon investigates | Finding with severity "warning" |
| Cross-account monopoly | Product only on Plasticov + Maustian listing_snapshot | Daemon investigates | Finding with severity "info" |
| Low per-product ROAS | Ad ROAS < 1.0 within campaign metrics | Daemon investigates | Finding with severity "warning" |
| Profitable product with no ad | price - cost > 0, campaign ROAS > 3.0, product not in ads[] | Daemon investigates | Finding with severity "info", kind "opportunity" |
| No signals | All checks pass or data missing | Daemon investigates | Empty findings, proposalEnqueued: false |
| Cost data missing | Ad active, no cost_snapshot for item | Daemon investigates | Profitability signal skipped; no false-critical |
| Empty snapshots | No product-ads-insights data | Daemon investigates | Empty findings, no error |
