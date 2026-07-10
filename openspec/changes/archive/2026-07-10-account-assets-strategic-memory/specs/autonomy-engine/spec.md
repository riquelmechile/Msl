# Delta for autonomy-engine

## ADDED Requirements

### Requirement: Per-Seller Autonomy State Schema
`autonomy_state` MUST gain `seller_id TEXT NOT NULL` via idempotent migration, default `'default'` for existing rows. PK: `(seller_id)`. New sellers start at level 1.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Existing preserved | Row with level 2 exists | Migration runs | `seller_id = 'default'`, level = 2 |
| New seller | "maustian" has no row | Engine inits for maustian | Row created: level 1, seller "maustian" |

### Requirement: Per-Seller KPI History
`kpi_history` MUST include `seller_id TEXT NOT NULL`. KPIs scoped to the action's seller.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| KPIs isolated | Plasticov succeeds, Maustian fails | KPIs recorded | Plasticov: success_rate=1; Maustian: success_rate=0 |

### Requirement: Per-Seller Degradation Events
`degradation_events` MUST include `seller_id TEXT NOT NULL`. Degradation evaluated per seller using only that seller's KPIs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Isolated degradation | Plasticov >3 violations, Maustian 0 | `evaluateDegradation("plasticov")` | Plasticov → level 0; Maustian unchanged |

## MODIFIED Requirements

### Requirement: Autonomy Level State Machine
Level 0–5 **per seller, keyed by `seller_id`**. Level 0 = all require "dale". Level 5 = only critical requires "dale". Default level 1 for new sellers. (Previously: global singleton.)

#### Scenario: CEO promotes one account only
- GIVEN Plasticov level 2, Maustian level 1
- WHEN `setLevel("plasticov", 3, reason)` is called
- THEN Plasticov level=3; Maustian level still 1

#### Scenario: Level persists per account
- GIVEN Plasticov=3, Maustian=1
- WHEN `converse()` starts for Maustian → level 1 loaded
- WHEN `converse()` starts for Plasticov → level 3 loaded

#### Scenario: Level bounded 0–5 (unchanged)

### Requirement: Risk-to-Level Threshold Mapping
Mapping identical per seller but NOW evaluated per-seller. (Previously: global.) Auto-approval is per-account: level 3 Plasticov auto-approves `low`; level 0 Maustian blocks `low`.

### Requirement: KPI Tracking
KPIs recorded **per seller** into `kpi_history` with `seller_id`. KPIs: margin_compliance, success_rate, safety_violations, response_accuracy. (Previously: global.)

### Requirement: Auto-Degradation
Degradation evaluated **per seller** querying only that seller's KPI windows. Safety violations >3 in 24h FOR THAT SELLER → level 0. Margin <0.8 in 7d → degrade by 1. Success <0.5 in 30d → degrade by 1. (Previously: global evaluation.)

#### Scenario: Seller-A degradation doesn't affect Seller-B
- GIVEN Plasticov >3 violations, Maustian 0
- WHEN `evaluateDegradation("plasticov")` → drops to 0
- WHEN `evaluateDegradation("maustian")` → unchanged

### Requirement: Autonomy Gate Guardrail
(Unchanged. Gate logic identical; operates per-seller state.)

### Requirement: Promotion via CEO Confirmation
(Unchanged. Evaluated per seller; CEO must call `setLevel` explicitly.)

## REMOVED Requirements
(None)
