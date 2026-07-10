# Tasks: Financial Truth Foundation

## Implementation Plan

Bottom-up, two chained PRs. PR 1 delivers all domain types + calculation engine + domain barrel + tests (no external deps). PR 2 builds on that foundation: SQLite store + CEO inspection tools + memory/tools barrel edits + tests. All additive — zero existing code modified.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,800 |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Delivery strategy | auto-forecast |
| Suggested split | PR 1 → PR 2 (stacked-to-main) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Domain types + calculation engine | PR 1 | ~950 lines. Foundation — no external deps. Includes all domain tests. |
| 2 | Store + tools + barrel exports | PR 2 | ~850 lines. Depends on PR 1 domain types. |

## PR 1: Domain Types & Calculation Engine

### Task 1.1: Money type ✅
- **Description**: Create `packages/domain/src/money.ts` — `Money`, `Currency`, `createMoney`, `addMoney`, `subtractMoney`, `isZero`, `MoneyError`, `CurrencyMismatchError`. Enforce integer `amountMinor`, reject NaN/Infinity/float.
- **Verification**: TDD — write `packages/domain/src/money.test.ts` first with NaN, Infinity, decimal, currency mismatch, negative, zero scenarios from spec. All pass. (18/18 tests)
- **Files**: `packages/domain/src/money.ts`, `packages/domain/src/money.test.ts`

### Task 1.2: EconomicCostComponent type ✅
- **Description**: Create `packages/domain/src/economicCost.ts` — `CostComponentType` (12-value `as const`), `EconomicCostComponent`, `CostVerification`, `CostDataSource`, `createEconomicCostComponent`. Validate type enum, reject invalid types.
- **Verification**: Test valid 12-type construction, invalid type rejection, full component with verification/confidence fields. (25/25 tests)
- **Files**: `packages/domain/src/economicCost.ts`, `packages/domain/src/economicCost.test.ts`

### Task 1.3: EconomicOutcome type with state machine ✅
- **Description**: Create `packages/domain/src/economicOutcome.ts` — `EconomicOutcome`, `EconomicOutcomeStatus` (6 states), `VALID_OUTCOME_TRANSITIONS` map, `transitionOutcome` validator. Enforce lifecycle: `pending → observing → observed → verified | disputed | invalidated`. Terminal states reject all transitions.
- **Verification**: Test normal progression, backward rejection (`verified → observed` throws), all valid/invalid transitions per spec table. (21/21 tests)
- **Files**: `packages/domain/src/economicOutcome.ts`, `packages/domain/src/economicOutcome.test.ts`

### Task 1.4: EconomicCalculationEngine (pure functions) ✅
- **Description**: Create `packages/domain/src/economicCalculation.ts` — `computeContributionProfit`, `computeNetProfit`, `computeMargin`, `computeUnitEconomics`. Pure deterministic functions. No NaN/Infinity, currency mismatch throws before computation, missing inputs produce `calculationStatus: "partial"`.
- **Verification**: 22 edge-case tests: NaN prevention, division by zero, currency mismatch, negative profit, zero margin, refund deduction, partial vs complete, explicit zero vs missing, contribution vs net divergence, full manual math verification. (22/22 tests)
- **Files**: `packages/domain/src/economicCalculation.ts`, `packages/domain/src/economicCalculation.test.ts`

### Task 1.5: UnitEconomicsSnapshot type ✅
- **Description**: Create `packages/domain/src/unitEconomics.ts` — `UnitEconomicsSnapshot`, `CalculationStatus`, `MissingInput`. Factory that computes snapshot using economicCalculation engine.
- **Verification**: Test complete snapshot, partial (missing costs), negative profit, refund reduction, explicit zero cost not in missingInputs. (3/3 tests)
- **Files**: `packages/domain/src/unitEconomics.ts`, `packages/domain/src/unitEconomics.test.ts`

### Task 1.6: Domain barrel exports ✅
- **Description**: Add exports for money, economicCost, unitEconomics, economicOutcome, economicCalculation to `packages/domain/src/index.ts`. Used explicit re-exports for money.ts to avoid `Money` type collision with `listing.ts`.
- **Verification**: `tsc -b` clean, all 173 existing + new tests pass.
- **Files**: `packages/domain/src/index.ts`

**Note on Money collision**: `listing.ts` already exports a `Money` type (`{ amount, currency }`). New `money.ts` exports are added via explicit named re-exports excluding the `Money` type to avoid ambiguity. Import `Money` directly from `@msl/domain/money` when needed.

## PR 2: Store + Tools + Barrel Exports

### Task 2.1: EconomicOutcomeStore
- **Description**: Create `packages/memory/src/economicOutcomeStore.ts` — `EconomicOutcomeStore` type alias, `migrateEconomicOutcomeStore(db)`, `createSqliteEconomicOutcomeStore(db)`. Follow existing factory pattern (cf. `evidenceRequestStore.ts`). SQLite `CREATE TABLE IF NOT EXISTS`, seller_id on all tables, `db.transaction` for multi-row writes, idempotent inserts via `outcome_id` UNIQUE. Implement full interface: insert, updateStatus, verify, dispute, get, listBySeller, listByProposal, listByOrder, listMissingInputs, summarizeProfit.
- **Verification**: In-memory SQLite tests. Seller isolation (two sellers, cross-check), idempotent insert (duplicate returns existing), valid transition, invalid transition throws, profit summary by currency, missing inputs deduplication.
- **Files**: `packages/memory/src/economicOutcomeStore.ts`, `packages/memory/src/__tests__/economicOutcomeStore.test.ts`

### Task 2.2: CEO inspection tools
- **Description**: Create `packages/agent/src/conversation/tools/economicTools.ts` — `createInspectUnitEconomicsTool`, `createInspectEconomicOutcomeTool`, `createListMissingEconomicInputsTool`. All `noMutationExecuted: true`, `sellerId` required. Follow existing tool pattern (cf. `costTools.ts`, `businessTools.ts`).
- **Verification**: Test each tool: returns data with `noMutationExecuted`, seller isolation, invalid input rejection, empty result handling. Use store mock/stub.
- **Files**: `packages/agent/src/conversation/tools/economicTools.ts`, `packages/agent/src/conversation/tools/__tests__/economicTools.test.ts`

### Task 2.3: Memory barrel export
- **Description**: Add `EconomicOutcomeStore` type export and `createSqliteEconomicOutcomeStore`/`migrateEconomicOutcomeStore` factory exports to `packages/memory/src/index.ts`. Follow existing pattern (see `EvidenceRequestStore` exports).
- **Verification**: `tsc --noEmit` passes. Import store from `@msl/memory`.
- **Files**: `packages/memory/src/index.ts`

### Task 2.4: Tools barrel export
- **Description**: Add `export * from "./economicTools.js"` to `packages/agent/src/conversation/tools/index.ts`.
- **Verification**: `tsc --noEmit` passes.
- **Files**: `packages/agent/src/conversation/tools/index.ts`

## Deliverables Checklist

### Create
- [x] `packages/domain/src/money.ts`
- [x] `packages/domain/src/economicCost.ts`
- [x] `packages/domain/src/unitEconomics.ts`
- [x] `packages/domain/src/economicOutcome.ts`
- [x] `packages/domain/src/economicCalculation.ts`
- [x] `packages/memory/src/economicOutcomeStore.ts`
- [x] `packages/agent/src/conversation/tools/economicTools.ts`

### Tests
- [x] `packages/domain/src/money.test.ts`
- [x] `packages/domain/src/economicCost.test.ts`
- [x] `packages/domain/src/economicOutcome.test.ts`
- [x] `packages/domain/src/economicCalculation.test.ts`
- [x] `packages/domain/src/unitEconomics.test.ts`
- [x] `packages/memory/src/economicOutcomeStore.test.ts` (17 tests)
- [x] `packages/agent/src/conversation/tools/economicTools.test.ts` (14 tests)

### Modify
- [x] `packages/domain/src/index.ts` — 5 exports (incl. explicit re-exports for money.ts)
- [x] `packages/memory/src/index.ts` — store type + factory exports
- [x] `packages/agent/src/conversation/tools/index.ts` — 1 export line
