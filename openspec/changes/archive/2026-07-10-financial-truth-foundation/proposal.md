# Proposal: Financial Truth Foundation

## Intent

The codebase has product-ads profitability (ProductAdsProfitabilityDaemon), workforce cost tracking (WorkforceCostCacheLedgerStore), and cost-supplier evidence (CostSupplierEvidenceResponder), but no canonical economic domain model. Cost evidence and margin assessments live in agent-specific logic — nothing ties an action to an observed economic outcome with audit-grade provenance, nor drives a Cortex learning loop from financial results. PR 1/3 establishes the economic domain types, deterministic calculation engine, SQLite persistence, and read-only inspection tools. PRs 2 and 3 will build the Finance Director agent and Cortex feedback loop on this foundation.

## Scope

### In Scope
- **`Money` type**: `amountMinor` (integer), `currency` (CLP | USD). No floating point, no implicit exchange.
- **`EconomicCostComponent`**: 11 cost types (COGS, marketplace fees, shipping, advertising, discounts, refunds, taxes, financing, landed cost, packaging, other) with provenance — source, sourceRecordId, verification, confidence.
- **`UnitEconomicsSnapshot`**: Per seller/channel/order/item/SKU. Gross revenue, itemized costs, contribution/net profit, contribution/net margin, `missingInputs`, `calculationStatus`.
- **`EconomicOutcome`**: Links action to observed result. Status lifecycle: `pending → observing → observed → verified | disputed | invalidated`. Correlation IDs, expected vs. observed impact, observation windows.
- **Calculation engine**: Pure deterministic functions. No NaN, Infinity, or implicit currency mixing. Missing data ≠ zero — partial results flagged.
- **SQLite store**: `EconomicOutcomeStore` with seller isolation (`seller_id`), idempotent writes (`CREATE TABLE IF NOT EXISTS`), controlled state transitions, `db.transaction` atomicity.
- **CEO inspection tools**: `inspect_unit_economics`, `inspect_economic_outcome`, `list_missing_economic_inputs` — all read-only, `noMutationExecuted: true`.
- **Domain barrel export**: All new modules re-exported from `packages/domain/src/index.ts`.

### Out of Scope
- Finance Director agent, DeepSeek prompts, commercial recommendations
- ML execution, real HTTP, credentials
- Causal attribution, landed cost import calculations
- Purchasing, publishing, pricing, campaign management
- Cortex integration (contract decision only: only `verified` outcomes will feed learning in PR 3)

## Capabilities

### New Capabilities
- `money-type`: Safe monetary representation — integer `amountMinor`, CLP + USD, no floating point
- `economic-cost-component`: Cost decomposition with provenance — 11 cost types, verification, confidence
- `unit-economics-snapshot`: Per-unit economics — gross through net, margins, missing inputs, calculation status
- `economic-outcome`: Action→result linkage with 5-state lifecycle, correlation IDs, observed vs. expected impact
- `economic-calculation-engine`: Deterministic pure functions — no NaN/Infinity, partial results, currency safety
- `economic-outcome-store`: SQLite persistence — seller-scoped, idempotent, controlled transitions
- `economic-inspection-tools`: CEO read-only tools — inspect snapshots, outcomes, and missing inputs

### Modified Capabilities
None. PR 1/3 is purely additive — existing daemons and stores are unchanged.

## Approach

Bottom-up: domain types → calculation engine → persistence → tools. Four new domain modules (`money.ts`, `economicCost.ts`, `unitEconomics.ts`, `economicOutcome.ts`), one new store (`packages/memory/src/EconomicOutcomeStore.ts`), three new tools in `packages/agent/src/conversation/tools/`. Follow existing patterns: branded IDs, discriminated unions, `as const` tuples, snake_case SQL columns, `createTableIfNotExists` migrations, `seller_id` on every table.

## Dependencies

All satisfied: existing domain conventions, `better-sqlite3`, `getSharedDb`, tool registration pattern, barrel export structure, `CostSupplierEvidenceResponder` (source for cost evidence), Cortex `GraphEngine` (target for future PR 3 integration).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Floating point leaks into money amounts | Medium | `amountMinor` integer-only; validator rejects `number` type if non-integer |
| Missing data silently treated as zero | High | `missingInputs` array; `calculationStatus: "partial"` on incomplete snapshots |
| Invalid state transitions in EconomicOutcome | Low | Explicit transition table; invalid transitions throw `EconomicOutcomeStateError` |
| Currency mixing across components | Medium | Engine rejects operations across different `currency` values |
| Cross-seller data exposure | Low | `seller_id` on all tables; query-level `WHERE seller_id = ?` filtering |

## Rollback Plan

All additive — zero existing code modified. Remove new domain modules from barrel export, drop store tables, unregister tools. No migration or data repair needed.

## Success Criteria

- [ ] `Money` enforces integer `amountMinor`, CLP + USD, no floating point
- [ ] `EconomicCostComponent` validates against 12 `CostComponentType` values
- [ ] `UnitEconomicsSnapshot` computes contribution profit, net profit, both margins correctly
- [ ] `EconomicOutcome` enforces valid transitions; rejects `verified → observed`
- [ ] Calculation engine never returns NaN or Infinity on valid input
- [ ] Missing inputs produce `calculationStatus: "partial"` — never zero
- [ ] Currency mixing throws explicit `CurrencyMismatchError`
- [ ] Store creates tables idempotently (`IF NOT EXISTS`)
- [ ] All store queries filter by `seller_id`
- [ ] `db.transaction` wraps multi-table writes
- [ ] Duplicate outcome insertion returns existing record (idempotent via UNIQUE)
- [ ] `inspect_unit_economics` returns snapshot with `noMutationExecuted: true`
- [ ] `inspect_economic_outcome` filters by status, seller, time window
- [ ] `list_missing_economic_inputs` identifies gaps without mutation
- [ ] Domain barrel re-exports all new modules from `packages/domain/src/index.ts`
- [ ] Zero existing test breakage
- [ ] ≥10 unit tests covering calculation edge cases (NaN, Infinity, currency mismatch, partial data)
- [ ] TypeScript typecheck passes on all new modules
- [ ] Store tests use `:memory:` for isolation
- [ ] All code follows existing conventions (branded IDs, discriminated unions, `as const`)
