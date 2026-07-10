# Design: Financial Truth Foundation

## Technical Approach

Bottom-up layering: domain types → calculation engine → persistence → tools → barrel exports. All additive — zero existing code modified. Follows codebase conventions exactly: branded IDs, `as const` tuples, discriminated unions, `CREATE TABLE IF NOT EXISTS`, `seller_id` on every table, prepared statements, and `noMutationExecuted: true` on read-only tools.

## Architecture Decisions

| Decision | Choice | Alternatives Rejected | Rationale |
|----------|--------|----------------------|-----------|
| Money representation | Integer `amountMinor` with `Currency` union | `number` with decimal scaling; BigInt | `number` accumulates floating-point error; BigInt overkill for CLP/USD. Integer minor units are industry standard (Stripe, ISO 4217) |
| Currency model | Union `"CLP" \| "USD"` — no implicit exchange | `number` exchange rate; dynamic currency registry | No exchange rate logic in scope (PR 2/3). Explicit union prevents accidental cross-currency arithmetic |
| Cost decomposition | 11 fixed `CostComponentType` values in `as const` tuple | Open-ended string; tagged union | Fixed taxonomy matches existing `CostSupplierEvidenceResponder` evidence categories and prevents type proliferation |
| State machine | `VALID_OUTCOME_TRANSITIONS` map with explicit validation per transition | `enum` with implicit progression; generic state machine library | Follows `WRITE_ACTION_KINDS` / `riskByKind` pattern. Explicit transitions enable compile-time exhaustiveness and audit-grade traceability |
| JSON columns | TEXT with defensive `parseJson<T>` helpers | `jsonb` in SQLite (not available); separate normalized tables | Follows `supplierMirrorStore` pattern: `metadata_json`, `snapshot_json`, `evidence_ids_json` all use TEXT + parse helpers |
| Store interface | `EconomicOutcomeStore` type alias with factory function | Class-based repository; generic CRUD | Matches `SupplierMirrorStore`, `EvidenceRequestStore`, `OwnedEcommerceStore` pattern — factory + interface + migration |

## Data Flow

```
Tool (CEO) ──→ EconomicOutcomeStore ──→ SQLite (economic_outcomes)
                    │                        │
                    ▼                        ▼
            EconomicOutcome          unit_economics_snapshots
                    │                        │
                    ▼                        ▼
         EconomicCalculation        EconomicCostComponent
              (pure)                      (Money)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/domain/src/money.ts` | Create | `Money`, `Currency`, `createMoney`, `addMoney`, `subtractMoney`, `isZero`, `MoneyError` |
| `packages/domain/src/economicCost.ts` | Create | `CostComponentType`, `EconomicCostComponent`, `CostVerification`, `CostDataSource`, `createEconomicCostComponent` |
| `packages/domain/src/unitEconomics.ts` | Create | `UnitEconomicsSnapshot`, `CalculationStatus`, `MissingInput`, factory with currency validation |
| `packages/domain/src/economicOutcome.ts` | Create | `EconomicOutcome`, `EconomicOutcomeStatus`, `VALID_OUTCOME_TRANSITIONS`, transition validators |
| `packages/domain/src/economicCalculation.ts` | Create | `computeContributionProfit`, `computeNetProfit`, `computeMargin`, `computeUnitEconomics` — pure functions |
| `packages/domain/src/index.ts` | Modify | Add 5 `export *` lines |
| `packages/memory/src/economicOutcomeStore.ts` | Create | `EconomicOutcomeStore` interface, `migrateEconomicOutcomeStore`, `createSqliteEconomicOutcomeStore` |
| `packages/memory/src/index.ts` | Modify | Add store type + factory exports |
| `packages/agent/src/conversation/tools/economicTools.ts` | Create | `createInspectUnitEconomicsTool`, `createInspectEconomicOutcomeTool`, `createListMissingEconomicInputsTool` |
| `packages/agent/src/conversation/tools/index.ts` | Modify | Add `export * from "./economicTools.js"` |

## Interfaces / Contracts

**Store interface**:
```typescript
export type EconomicOutcomeStore = {
  insertOutcome(outcome: EconomicOutcome): Promise<EconomicOutcome>;
  updateOutcomeStatus(outcomeId: string, newStatus: EconomicOutcomeStatus): Promise<EconomicOutcome>;
  verifyOutcome(outcomeId: string, reason: string): Promise<EconomicOutcome>;
  disputeOutcome(outcomeId: string, reason: string): Promise<EconomicOutcome>;
  getOutcome(outcomeId: string): Promise<EconomicOutcome | null>;
  listOutcomesBySeller(sellerId: SellerId, opts?: { status?: EconomicOutcomeStatus; limit?: number }): Promise<EconomicOutcome[]>;
  listOutcomesByProposal(proposalId: string): Promise<EconomicOutcome[]>;
  listOutcomesByOrder(orderId: string): Promise<EconomicOutcome[]>;
  listMissingInputs(sellerId: SellerId): Promise<MissingInput[]>;
  summarizeProfit(sellerId: SellerId, currency: Currency, period?: { from: number; to: number }): Promise<ProfitSummary>;
};
```

**Tool parameters** — all require `sellerId: { type: "string" }` in `required: ["sellerId"]`.

## SQL Schema

```sql
CREATE TABLE IF NOT EXISTS economic_outcomes (
  outcome_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  account_id TEXT,
  channel TEXT NOT NULL,
  proposal_id TEXT,
  prepared_action_id TEXT,
  execution_id TEXT,
  correlation_id TEXT,
  work_session_id TEXT,
  originating_agent_id TEXT,
  order_id TEXT,
  item_id TEXT,
  sku TEXT,
  expected_impact_json TEXT,
  observed_impact_json TEXT,
  observation_window_json TEXT,
  baseline_reference TEXT,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  completeness REAL NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  observed_at TEXT,
  verified_at TEXT,
  disputed_at TEXT,
  invalidated_at TEXT,
  verification_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_economic_outcomes_seller ON economic_outcomes(seller_id);
CREATE INDEX IF NOT EXISTS idx_economic_outcomes_status ON economic_outcomes(seller_id, status);
```

Unit economics snapshots and cost components are stored inline as JSON columns (`observed_impact_json`).

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Domain | `Money` validation (NaN, Infinity, float, currency mismatch), `EconomicCostComponent` 11-type enum, `EconomicOutcome` state transitions, calculation engine edge cases (zero revenue margin, overflow near MAX_SAFE_INTEGER, partial data) | `packages/domain/src/__tests__/` — 5 test files, ≥10 calculation edge-case tests |
| Store | Seller isolation (two sellers, queries return only own data), idempotent inserts, valid + invalid transitions, profit summary by currency | `packages/memory/src/__tests__/` — `:memory:` SQLite, prepared statement coverage |
| Tools | `noMutationExecuted: true` on all responses, seller isolation, invalid input rejection, empty result handling | `packages/agent/src/conversation/tools/__tests__/` — store mock/stub, bounded response validation |

## Migration / Rollout

No migration required — all additive. `migrateEconomicOutcomeStore(db)` is idempotent (safe on existing DBs). Rollback: drop 3 tables, remove 5 export lines from domain barrel + 1 tool export + store exports, delete 6 new files.

## Open Questions

- [ ] Should `summarizeProfit` implement SQLite `SUM` aggregation directly, or load outcomes into memory and sum in JS? (Tradeoff: SQL SUM is faster but requires JSON extraction from `observed_impact_json`; in-memory is simpler but loads all outcomes. Design defaults to SQL aggregation with `json_extract` for performance on large datasets.)
- [ ] Should `EconomicCostComponent` be a separate table or inline JSON in the unit economics snapshot? (Design defaults to inline JSON — matches `supplierMirrorStore` snapshot_json pattern and avoids 3-table joins for simple read paths.)
