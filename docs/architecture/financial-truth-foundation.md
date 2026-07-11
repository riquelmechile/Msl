# Financial Truth Foundation — Architecture Document

> **Phase:** P1, PR 1/3
> **Date:** 2026-07-10
> **Status:** Implemented

## Purpose

The Financial Truth Foundation establishes MSL's canonical economic domain — the source of truth for what is revenue, what is cost, and what is profit. Before this foundation, the codebase had profitability daemons and cost evidence, but no unified model connecting an action to an observed economic outcome with audit-grade provenance.

This is the first of three PRs:

1. **PR 1/3 (this)**: Domain types + calculation engine + persistence + read-only tools
2. **PR 2/3 (planned)**: Finance Director conversational agent with DeepSeek reasoning
3. **PR 3/3 (planned)**: Cortex reinforcement loop — verified outcomes feed Darwinian learning

## Key Concepts

### Revenue ≠ Profit

A sale generates revenue. A marketplace takes fees. Shipping costs money. Advertising costs money. Products have cost. Only after subtracting all verified costs do you have profit. The calculation engine enforces this explicitly: if a cost component is missing, the result is marked `partial`, and the missing input is reported. Missing data is never silently converted to zero.

### Contribution Profit vs. Net Profit

- **Contribution profit** = gross revenue − variable costs (product cost, marketplace fee, shipping, advertising, seller-funded discounts). These are costs that scale with each sale.
- **Net profit** = gross revenue − all costs (variable + fixed: taxes, financing, landed cost allocation, packaging, refunds, returns, other). This is the bottom-line profit.

The engine computes both, making the difference visible.

### Data Honesty

- **Never invent costs.** Costs must come from a traceable source (MercadoLibre API, supplier data, carrier invoice, manual entry).
- **Never fill missing with zero.** If shipping cost is unknown, the snapshot marks it as missing and sets `calculationStatus: "partial"`.
- **Never mix currencies.** CLP and USD operations are explicitly rejected unless an exchange rate is provided.
- **Never use floating point.** All amounts are integers in minor units (e.g., CLP 1990 = $1.990). No `parseFloat`, no `toFixed`, no IEEE 754 artifacts.
- **Never assert causality prematurely.** In this PR, attribution is descriptive: "this outcome is associated with this action and this evidence." Causal attribution ("this agent caused X profit") is deferred to PR 3.

## Domain Model

### Money (`packages/domain/src/money.ts`)

```typescript
type Currency = "CLP" | "USD";
type Money = { amountMinor: number; currency: Currency };
```

- `createMoney(amountMinor, currency)` — validates finite integer, rejects NaN/Infinity/floats
- `addMoney(a, b)` — same currency only, throws `CurrencyMismatchError` otherwise
- `subtractMoney(a, b)` — same currency only
- `isZero(m)` — explicit zero check

### EconomicCostComponent (`packages/domain/src/economicCost.ts`)

12 cost types with provenance:

| Type | Description |
|------|-------------|
| `product_cost` | COGS / supplier cost |
| `marketplace_fee` | MercadoLibre commission |
| `shipping` | Seller-paid or subsidized shipping |
| `advertising` | Product Ads spend |
| `seller_discount` | Seller-funded discounts |
| `refund` | Partial refund |
| `return` | Full return |
| `tax` | VAT, sales tax |
| `financing` | Mercado Crédito, installment costs |
| `landed_cost` | Allocated import costs |
| `packaging` | Packaging materials |
| `other` | Any other verified cost |

Each component records:
- `id`, `sellerId`, `type`, `amount: Money`
- `source` (mercadolibre, supplier, customs, carrier, manual, derived, unknown)
- `sourceRecordId` — traceability to the original record
- `occurredAt`, `observedAt` — temporal tracking
- `verification` (unverified, partially_verified, verified, disputed)
- `confidence` (0.0–1.0)

### UnitEconomicsSnapshot (`packages/domain/src/unitEconomics.ts`)

Per-unit economics scoped by seller, channel, order, item, SKU, product, period, and currency.

Fields:
- `grossRevenue`, `sellerFundedDiscounts`, `refunds` → revenue side
- `marketplaceFees`, `sellerShippingCost`, `advertisingCost`, `productCost`, `allocatedLandedCost`, `taxes`, `financingCost`, `packagingCost`, `otherCosts` → cost side
- `contributionProfit`, `netProfit` → derived
- `contributionMargin`, `netMargin` → decimal 0–1
- `missingInputs: CostComponentType[]` — explicitly tracked
- `calculationStatus: "complete" | "partial" | "unverifiable" | "disputed"`

### EconomicOutcome (`packages/domain/src/economicOutcome.ts`)

Links an action to its observed economic result.

6-state lifecycle:
```
pending → observing → observed → verified
                              ↘ disputed → invalidated (terminal)
                                        → observed (re-evaluate)
```

- `pending`: Created, not yet tracking
- `observing`: Within observation window, awaiting results
- `observed`: Results captured, awaiting verification
- `verified`: Confirmed accurate, eligible for Cortex learning (future PR 3)
- `disputed`: Accuracy challenged
- `invalidated`: Proven wrong — terminal, never feeds learning

Key fields: `outcomeId`, `sellerId`, `proposalId`, `preparedActionId`, `executionId`, `correlationId`, `workSessionId`, `originatingAgentId`, `orderId`, `itemId`, `sku`, `expectedEconomicImpact`, `observedEconomicImpact`, `observationWindow`, `status`, `confidence`, `completeness`, `evidenceIds`.

### Calculation Engine (`packages/domain/src/economicCalculation.ts`)

Pure deterministic functions:

- `computeContributionProfit(revenue, variableCosts) → Money`
- `computeNetProfit(revenue, allCosts) → Money`
- `computeMargin(profit, revenue) → number`
- `computeUnitEconomics(input) → UnitEconomicsSnapshot`

Guarantees: no NaN, no Infinity, no implicit currency mixing, missing ≠ zero, partial results flagged, negative profits allowed, zero valid only from explicit zero source.

## Persistence

### EconomicOutcomeStore (`packages/memory/src/economicOutcomeStore.ts`)

SQLite store with 3 tables:

| Table | Purpose |
|-------|---------|
| `economic_outcomes` | Outcome lifecycle, status, correlation IDs, attribution links |
| `economic_cost_components` | Individual cost records with provenance and `ingestion_run_id` |
| `unit_economics_snapshots` | Full snapshots stored as JSON with `ingestion_run_id` |
| `economic_evidence_references` | Evidence chain-of-custody with 15-column composite key |

All tables have `seller_id TEXT NOT NULL` with indexes. All queries use parameterized `WHERE seller_id = ?`. Zero SQL string interpolation.

Key methods:
- `insertOutcome` — idempotent via UNIQUE on `outcome_id`
- `updateOutcomeStatus` — validates transitions via `transitionOutcome()`
- `verifyOutcome` / `disputeOutcome` — controlled state changes
- `getOutcome`, `listOutcomesBySeller`, `listOutcomesByProposal`, `listOutcomesByOrder`, `listOutcomesByCorrelationId`
- `listMissingInputs` — identifies gaps across all outcomes
- `summarizeProfit` — aggregates by currency (never mixes CLP/USD)

### EconomicEvidenceStore (`packages/memory/src/economicEvidenceStore.ts`)

Durable chain-of-custody for economic evidence references with provenance tracking:

- **Table**: `economic_evidence_references` — 15 columns (evidence_id, seller_id, source_system, source_entity_type, source_record_id, source_field, observed_at, occurred_at, source_version, checksum, verification, confidence, superseded_by, ingestion_run_id, created_at)
- **Composite unique key**: `(seller_id, source_system, source_entity_type, source_record_id, source_version, checksum)`
- **Scan indexes**: `(ingestion_run_id)`, `(seller_id)`, `(source_record_id)`
- **8 CRUD methods**: `insertEvidence`, `upsertEvidence`, `getEvidence`, `listBySeller`, `listByRun`, `listBySourceRecord`, `markSuperseded`, `countByRun`
- **Idempotency**: `INSERT ON CONFLICT DO NOTHING` — safe to re-ingest the same data
- **Superseding**: `markSuperseded(evidenceId, supersededBy)` preserves old rows for audit
- **Cross-seller isolation**: every method requires `sellerId`
- **No PII**: stores only metadata (checksums, versions, verification status) — no raw payloads or buyer data

### Atomic Transaction Boundary

All final persistence writes execute in a single `db.transaction()`:

```
db.transaction(() => {
  evidenceStore.upsertEvidence(e)       // for each evidence ref
  store.insertCostComponent(c)          // for each cost component
  store.insertUnitEconomicsSnapshot(s)  // for each snapshot
  runStore.updateRun(runId, {...})      // run → completed
  runStore.updateCheckpoint(sellerId)   // only after commit
})
```

If any write inside the transaction throws, SQLite automatically rolls back all pending writes — no partial data is committed. The error propagates to mark the run `failed` and the CLI exits non-zero.

### Ingestion Run Provenance

Every cost component and unit economics snapshot carries an `ingestion_run_id TEXT NOT NULL` column. This enables:

- Filtering components/snapshots by the run that produced them
- Audit queries linking evidence, components, and snapshots to a specific ingestion
- Idempotent re-ingestion: same data range, new run ID, zero duplicate evidence rows
- Run-scoped metrics: `normalizedLines`, `componentsCreated`, `snapshotsCreated`, `duplicatesIgnored`

### Missing Cost Types

The following cost component types remain partial (stub adapters returning empty + `missingInputs`):

| Type | Missing Reason | Resolution Path |
|------|---------------|-----------------|
| `product_cost` | Requires supplier cost data | Supplier Mirror integration |
| `landed_cost` | Requires customs and freight data | Import documentation, carrier APIs |
| `packaging` | Requires packaging cost tracking | Operational data collection |
| `financing` | Requires credit/installment tracking | Mercado Crédito API access |
| `tax` | Requires tax calculation rules | Accounting integration |
| `other` | Any other verified cost | Manual entry or future integrations |

Missing ≠ zero. Snapshots with missing inputs are marked `calculationStatus: "partial"` and the missing types are declared explicitly.

## Tools

Three CEO read-only tools in `packages/agent/src/conversation/tools/economicTools.ts`:

| Tool | Purpose |
|------|---------|
| `inspect_unit_economics` | Read a UnitEconomicsSnapshot by ID |
| `inspect_economic_outcome` | Read outcomes by ID or filter by seller/status |
| `list_missing_economic_inputs` | List all outcomes with missing cost data |

All tools:
- Require `sellerId` (validated)
- Declare `noExternalMutationExecuted: true` on every return path
- Return bounded responses (default limit 20)
- Gracefully handle missing stores and invalid inputs

## Seller Isolation

Plasticov and Maustian data is strictly isolated:
- `seller_id` column on all tables
- Indexes for seller-scoped queries
- Every query includes `WHERE seller_id = ?`
- Cross-seller queries are architecturally impossible without bypassing the store interface

## Cortex Integration (Future PR 3)

The contract is defined but not implemented:

- Only `verified` outcomes MAY feed Cortex learning
- `pending`, `observing`, `observed` MUST NOT reinforce any constellation
- `disputed` or `invalidated` MUST NEVER reinforce a constellation
- Cortex failures must never corrupt economic truth

## Formula

```
grossRevenue
- sellerFundedDiscounts
- refunds
= net revenue
- marketplaceFees
- sellerShippingCost
- advertisingCost
- productCost
= contributionProfit
- allocatedLandedCost
- taxes
- financingCost
- packagingCost
- otherCosts
= netProfit

contributionMargin = contributionProfit / grossRevenue
netMargin = netProfit / grossRevenue
```

When grossRevenue is zero, margin returns 0 (no division by zero).

## Out of Scope (for PR 1/3)

- Finance Director conversational agent
- DeepSeek prompts for financial analysis
- Commercial recommendations generated by LLM
- MercadoLibre write operations
- HTTP calls to real APIs
- Credentials or secrets
- Causal attribution ("agent X caused profit Y")
- Landed cost import calculations (full breakdown)
- Purchasing, publishing, pricing, campaign management
- Currency exchange rate fetching

## Files

| File | Package | Purpose |
|------|---------|---------|
| `money.ts` | domain | Money type, currency safety |
| `economicCost.ts` | domain | Cost components with provenance |
| `unitEconomics.ts` | domain | Per-unit economics snapshot |
| `economicOutcome.ts` | domain | Outcome lifecycle state machine |
| `economicCalculation.ts` | domain | Deterministic calculation engine |
| `runIdFactory.ts` | domain | UUID-based RunIdFactory (Crypto + Deterministic) |
| `economicEvidenceReference.ts` | domain | Evidence reference domain types |
| `economicLearningEligibility.ts` | domain | 10-block-reason eligibility evaluator |
| `economicOutcomeStore.ts` | memory | SQLite persistence (cost components, snapshots, outcomes) |
| `economicEvidenceStore.ts` | memory | Evidence chain-of-custody with provenance |
| `economicIngestionRunStore.ts` | memory | Ingestion run lifecycle + checkpoints |
| `economicTools.ts` | agent/tools | CEO read-only inspection tools |
| `EconomicIngestionPipeline.ts` | agent/economics | Durability-hardened ingestion pipeline |

## Tests

120+ tests across 7+ test files (domain + store + tools), plus 65+ durability-specific tests:
- 89 domain tests (money, cost, outcome, calculation, unit economics, eligibility)
- 17 store tests (SQLite persistence, isolation, transitions)
- 14 tool tests (read-only, seller isolation, error handling)
- Durability: RunIdFactory unit tests, evidence store CRUD, pipeline fault injection (6 points), transaction rollback, dual-seller isolation, re-ingestion idempotency, migration upgrade (v1→v5), CLI inspect
