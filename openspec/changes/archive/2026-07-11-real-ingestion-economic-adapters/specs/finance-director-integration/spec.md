# Finance Director Integration Specification

## Purpose

How Finance Director tools consume real economic data through the evidence assembler using the new ingestion pipeline output.

## Requirements

### Requirement: Real Data Consumption

Finance Director tools MUST consume real `UnitEconomicsSnapshot` and `EconomicCostComponent` data through the evidence assembler. All tools SHALL work with live data, not mock/stub responses.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| inspect_unit_economics with real data | 25 snapshots for Plasticov | Tool called | Returns real revenue, costs, profit from persisted snapshots |
| Fallback when no data | No snapshots exist for seller yet | Tool called | Returns empty result with guidance to run ingestion |

### Requirement: Finance Director Questions

The following questions MUST be answerable with real data: "How much did we really earn on this order?", "Which products sell but lose money?", "What costs are missing for Plasticov?", "What costs are missing for Maustian?", "Which account has better margin?", "Is positive ROAS producing net profit?", "Which snapshots are still partial?"

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Order profitability | Order #600 snapshot: revenue 50000, costs 45000, net 5000 | Question asked | Returns net profit 5000 with cost breakdown |
| Losing products | Product X: 10 sales, all net negative | Question asked | Lists product X with aggregate loss |
| Missing costs query | Maustian: 8 scenarios missing product_cost | Question asked | Returns list with evidence gaps enumerated |

### Requirement: Partial Snapshot Honesty

The assembler MUST NEVER present partial snapshots as definitive profit. Missing inputs SHALL be explicitly surfaced.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Partial snapshot presented | Snapshot missing product_cost, net profit appears positive | Finance Director inspects | `missingInputs` clearly shown, net profit marked as `partial, not definitive` |

### Requirement: Bounded Evidence Assembly

The assembler MUST NOT send all orders to the LLM directly. It SHALL use aggregates, top anomalies, bounded evidence, seller scope, and period filtering.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| 1000 orders for seller | Query: "Which products lose money?" | Assembler runs | Aggregates by product, returns top 10 loss-makers, not 1000 raw rows |
| Cross-seller query | Query spans Plasticov + Maustian | Assembler runs | Each seller processed separately, results scoped |
