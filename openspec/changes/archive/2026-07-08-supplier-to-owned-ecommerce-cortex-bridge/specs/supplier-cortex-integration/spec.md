# Supplier Cortex Integration Specification

## Purpose

Bridge ingesting Supplier Mirror data into Cortex neural memory so the owned ecommerce agent can reason on supplier patterns and discover niche storefront candidates under CEO governance.

## Requirements

### Requirement: Supplier Data Ingestion into Cortex

The system MUST ingest supplier data as Cortex concept nodes: supplier profiles, items, stock, mappings, policies, and lessons. Ingestion MUST use `getOrCreateNode()` for idempotency. Supplier Mirror remains source of truth; Cortex is secondary pattern index.

#### Scenario: Supplier profile ingested
- GIVEN a registered supplier exists in Supplier Mirror
- WHEN the bridge syncs supplier data
- THEN a `supplier_profile` node MUST exist with metadata including `supplierId`, `name`, and `source`

#### Scenario: Supplier item ingested
- GIVEN a supplier item snapshot exists
- WHEN bridge syncs items
- THEN a `supplier_item` node MUST be created with metadata `supplierId`, `supplierItemId`, `title`

#### Scenario: Stock observation ingested
- GIVEN a recent stock observation exists for a mapped item
- WHEN the bridge syncs stock
- THEN a `supplier_stock` node MUST be created or updated with `quantity` and `confidence` in metadata

#### Scenario: Idempotent ingestion
- GIVEN nodes already exist for a supplier
- WHEN the bridge syncs again
- THEN `getOrCreateNode()` MUST return existing nodes
- AND stock nodes MUST update in-place

### Requirement: Periodic Sync

The system MUST support periodic hourly seed sync covering all suppliers. The bridge ingests supplier profiles, items, stock, mappings, policies, and lessons idempotently on each cycle.

#### Scenario: Hourly full sync
- GIVEN the bot startup or hourly timer fires
- WHEN `ingestAllSuppliersToCortex()` runs
- THEN all registered suppliers MUST be ingested idempotently

> **Note:** Reactive stock-break auto-pause and Agent Message Bus notification are deferred to a future change. The current implementation handles stock freshness through the hourly periodic sync.

### Requirement: Agent-Driven Discovery, Not Deterministic Pipeline

The bridge MUST populate Cortex with supplier data but MUST NOT embed hardcoded pricing, targeting, or merchandising rules. The agent SHALL reason on Cortex data and propose candidates.

#### Scenario: Bridge provides data, agent reasons
- GIVEN supplier data is freshly ingested into Cortex
- WHEN the owned ecommerce agent queries Cortex for niche patterns
- THEN the bridge MUST NOT pre-filter or rank candidates
- AND the agent MUST own the reasoning and proposal logic

### Requirement: CEO-Gated Autonomy Levels

The system SHALL auto-publish only for low-criticality actions with high Cortex confidence. All other proposals MUST route through CEO "dale" approval. Pricing proposals MUST enter a CEO feedback loop with iteration until approval.

#### Scenario: High-confidence low-criticality auto-publish
- GIVEN Cortex confidence exceeds autonomy threshold and action criticality is low
- WHEN the agent proposes a storefront candidate
- THEN the system MAY auto-publish without CEO gate

#### Scenario: Uncertain or high-criticality requires CEO
- GIVEN Cortex confidence is below threshold OR action is high-criticality
- WHEN the agent proposes a candidate or mutation
- THEN the proposal MUST route to CEO for "dale" before execution

#### Scenario: Pricing proposal loop
- GIVEN the agent proposes supplier-based pricing
- WHEN CEO provides feedback
- THEN the agent MUST iterate until CEO approval or abandonment
