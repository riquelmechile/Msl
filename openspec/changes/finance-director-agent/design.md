# Design: Finance Director Agent

## Technical Approach

New `"finance"` department with a DeepSeek-powered FinanceDirectorAdvisor that reasons over bounded economic evidence. Follows the `CostSupplierDeepSeekAdvisor` pattern — lazy `DeepSeekReasoningGateway`, structured output, cost tracking. Evidence assembled from `EconomicOutcomeStore` with limits. Four-block prompt for cache efficiency. Validation layer rejects fabrications. Deterministic fallback when DeepSeek fails.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Advisor as standalone class vs CEO-lane inline | Separation enables independent testing, reuse across tools | Standalone `FinanceDirectorAdvisor` |
| Single `analyze()` method vs per-assessment-type methods | Single method simpler; assessment type inferred from evidence/question | Single `analyze()` |
| Validator in advisor vs separate class | Adhering to spec: 5 components, unit-testable independently | Separate `FinanceDirectorValidator` |
| Full SQLite dumps to LLM vs bounded evidence | Cost, privacy, hallucination risk | Bounded evidence with hard limits |

## Data Flow

```
CEO Tool ──→ FinanceDirectorAdvisor.analyze()
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
  Assembler   PromptBuilder  Validator
     │            │            │
     ▼            ▼            ▼
EconomicOutcomeStore    DeepSeekReasoningGateway
```

1. Tool receives `sellerId` + question
2. Assembler queries `EconomicOutcomeStore` (bounded: max 50 snapshots, max 25 outcomes, max 90d age)
3. PromptBuilder builds 4-block system+user messages
4. `DeepSeekReasoningGateway.reason()` via lazy gateway
5. Validator checks output: rejects hallucinations, currency mixing, invented figures
6. Falls back to deterministic `FinanceDirectorFallback` on error
7. Assessment persisted to `FinanceDirectorAssessmentStore`; returned to CEO

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/finance/FinanceDirectorAdvisor.ts` | New | Core advisor class, lazy gateway |
| `packages/agent/src/finance/FinanceDirectorEvidenceAssembler.ts` | New | Bounded evidence gathering from store |
| `packages/agent/src/finance/FinanceDirectorPromptBuilder.ts` | New | 4-block cache-friendly prompt construction |
| `packages/agent/src/finance/FinanceDirectorValidator.ts` | New | Output validation (16 rejection rules) |
| `packages/agent/src/finance/FinanceDirectorFallback.ts` | New | Deterministic fallback assessment |
| `packages/domain/src/financialAssessment.ts` | New | `FinancialAssessment` type, `AssessmentType` enum |
| `packages/memory/src/financeDirectorAssessmentStore.ts` | New | SQLite store, seller-scoped queries |
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `"finance-director"` to `LaneId`, `FINANCE_DIRECTOR_LANE` contract, `LANE_CONTRACTS` entry |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Add `"finance"` to `CompanyDepartmentId`, lane→department mapping |
| `packages/agent/src/conversation/tools/financeDirectorTools.ts` | New | 4 CEO tools: ask, review_health, explain_outcome, review_proposal |

## Interfaces / Contracts

```typescript
// FinanceDirectorAdvisor
class FinanceDirectorAdvisor {
  constructor(input: { transport: DeepSeekTransport; sellerIds: string[]; ledger?: WorkforceCostCacheLedgerStore });
  analyze(evidence: FinanceDirectorEvidence, question: string): Promise<FinancialAssessment>;
}

// Assembler
class FinanceDirectorEvidenceAssembler {
  constructor(store: EconomicOutcomeStore, sellerId: string);
  assembleEvidence(opts: { question; snapshotIds?; outcomeIds?; limit?; maxAge? }): FinanceDirectorEvidence;
}

// Key types
type FinanceDirectorEvidence = {
  sellerId; accountId?; snapshots: UnitEconomicsSnapshot[];
  outcomes: EconomicOutcome[]; profitSummary: ProfitSummary;
  missingInputs; metadata: { totalSnapshots; totalOutcomes; bounded: boolean; cutoffAge };
};

type AssessmentType = "account-health" | "order-profitability" | "product-profitability"
  | "ads-profitability" | "proposal-review" | "outcome-review"
  | "missing-cost-review" | "cross-account-comparison" | "cash-risk-indicator";
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Validator: 16 rejection rules, one test per rule | Vitest with fabricated inputs |
| Unit | Fallback: produces factual summary without fabrication | Vitest, mock evidence |
| Unit | PromptBuilder: block A+B stability across calls | Vitest, hash comparison |
| Unit | Assembler: respects limit, age, size bounds | Vitest, mock store |
| Integration | Advisor → store → DeepSeek gateway (mocked transport) | Vitest, `mem_search` transport |
| Integration | Tool execution → advisor pipeline | Vitest, dependency injection |
| E2E | Full ask/health/outcome/proposal flow | Playwright (guarded) |

## Migration / Rollout

Additive change — no migration required. New tables created via `migrateFinanceDirectorAssessmentStore()`. Removal: drop tables, remove lane, unregister tools.

## Open Questions

- None
