# Finance Director Agent — Architecture Document

> **Phase:** P1, PR 2/3 (Financial Truth)
> **Date:** 2026-07-10
> **Status:** Implemented

## Purpose

The Finance Director is a transversal financial manager agent — a specialized DeepSeek-powered reasoning lane that interprets economic truth data, not calculates it. It answers CEO questions, detects financial anomalies, reviews proposals for profitability, and explains economic outcomes using evidence-backed reasoning.

**This is the interpretation layer (PR 2/3), not the calculation layer (PR 1/3).**

## Relationship with the Financial Truth foundation (PR 1/3)

```
PR 1/3 (Economic Domain Foundation)       PR 2/3 (Finance Director Agent)
───────────────────────────────────       ────────────────────────────────
UnitEconomicsSnapshot (calculation)  →     Finance Director reads snapshots
EconomicOutcome (factual record)     →     Finance Director interprets outcomes
Money type (integer minor units)     →     Finance Director reasons about amounts
EconomicOutcomeStore (persistence)   →     Finance Director queries via store
CEO inspection tools (read-only)     →     Finance Director's own tools (advisory)
Deterministic calculation            →     AI-powered interpretation
Missing data ≠ zero                  →     Validator rejects missing→zero claims
```

**Rule:** The Finance Director NEVER calculates. It READS from the calculation layer and INTERPRETS results. If a cost is missing, it reports the gap — it never invents one.

## Relationship with Product Ads Profitability

The Finance Director **consumes** product-ads profitability data, it does not duplicate it. The `product-ads-profitability` lane computes CFO-grade signals per product independently. The Finance Director reads those signals, compares them with economic outcomes, and synthesizes cross-domain financial insights.

- The `product-ads-profitability` lane answers: "Is this ad profitable at the product level?"
- The Finance Director answers: "Given everything we know (ads, orders, costs, outcomes), what does the financial picture look like?"

## Architecture

### Advisor Pipeline

```
EconomicOutcomeStore → FinanceDirectorEvidenceAssembler → FinanceDirectorPromptBuilder
                                                                    ↓
FinanceDirectorAdvisor ← FinanceDirectorValidator ← DeepSeekReasoningGateway
        ↓                                       (rejected)
        ↓                                            ↓
   FinancialAssessment ←──────────────── FinanceDirectorFallback
        ↓
FinanceDirectorAssessmentStore (persisted)
```

1. **Evidence Assembler**: Queries `EconomicOutcomeStore` — snapshots (max 50), outcomes (max 25), profit summary — bounded by maxAge (default 90d). Sets `metadata.bounded: true` when limits are hit.
2. **Prompt Builder**: Builds 4 cache-friendly blocks:
   - Block A: Identity + rules (constant, cache-stable)
   - Block B: Company context (seller-scoped, infrequent updates)
   - Block C: Session context (correlation-scoped)
   - Block D: Dynamic evidence (uncached, fresh each call)
3. **Advisor**: Lazy `DeepSeekReasoningGateway`. Calls `analyze(evidence, question)` — assembles → prompts → reasons → validates → falls back if needed.
4. **Validator**: 16 rejection rules covering hallucinated numbers, fabricated causality, currency mixing, missing→zero conversion, deceptive ROAS, cross-account leakage, and more.
5. **Fallback**: Deterministic assessment with `outcome: "unknown"`, `confidence: 0`, factual evidence summary, enumerated gaps. No invention.

### Assessment Store Schema

```sql
finance_director_assessments (
  assessment_id   TEXT PRIMARY KEY,
  seller_id       TEXT NOT NULL,
  type            TEXT NOT NULL,   -- one of 9 AssessmentType values
  outcome         TEXT,
  confidence      REAL NOT NULL,
  completeness    TEXT NOT NULL,   -- "complete" | "partial" | "insufficient"
  evidence_ids_json  TEXT,         -- JSON array of evidence IDs
  gaps_json       TEXT,            -- JSON array of gap descriptions
  reasoning_trace TEXT,
  source          TEXT,            -- "deepseek-reasoning" | "deterministic-fallback"
  correlation_id  TEXT,
  session_id      TEXT,
  created_at      TEXT
);
```

## Evidence Model

### What evidence is gathered

| Evidence Kind | Source | Max Items | Max Age |
|---|---|---|---|
| Unit Economics Snapshots | `EconomicOutcomeStore` | 50 | 90d |
| Economic Outcomes | `EconomicOutcomeStore` | 25 | 90d |
| Profit Summary | Aggregated from snapshots | — | 90d |
| Product Ads Profitability | `product-ads-profitability` lane | consumed as-needed | — |
| Account Brain | `account-brain` lane | consumed as-needed | — |

### Evidence Bounding

When a query would return more data than the configured limits, the assembler:
1. Returns the most recent items within limits
2. Sets `metadata.bounded: true`
3. Includes a `truncationNotice` describing which limit was hit
4. The validator treats bounded evidence as `partial` — prevents overconfident claims

## FinancialAssessment Contract

```typescript
type FinancialAssessment = {
  assessmentId: string;
  sellerId: string;
  assessmentType: AssessmentType;  // 9-member enum
  summary: string;
  verifiedFacts: string[];         // ONLY facts with evidence linkage
  hypotheses: Hypothesis[];        // Speculative, with confidence
  risks: FinancialRisk[];          // Severity + probability
  opportunities: Opportunity[];    // Estimated impact
  missingEvidence: MissingEvidence[];
  confidence: number;              // 0..1
  uncertaintyReasons: string[];
  recommendations: Recommendation[];
  requestsForEvidence: EvidenceRequest[];
  evidenceIds: string[];           // Every ID referenced in the assessment
  outcomeIds: string[];
  snapshotIds: string[];
  modelUsed: string;
  fallbackUsed: boolean;
  noMutationExecuted: true;        // Always true — read-only
};
```

## Validator Anti-Hallucination Rules (16 Total)

1. **Hallucinated numbers**: figure present but 0 evidence IDs → reject
2. **Hallucinated causality**: cause without evidence linkage → reject
3. **Currency mixing**: CLP + USD in same claim → reject
4. **Missing→zero conversion**: treating absent data as zero → reject
5. **Observed→verified**: claiming verification without timestamp → reject
6. **Guaranteed profit**: claiming guaranteed profit → reject
7. **Deceptive ROAS**: revenue-only, ignoring costs → flag `incomplete`
8. **Stale costs**: >30d without staleness warning → flag
9. **Cross-account leakage**: referencing another seller's data → reject
10. **Negative confidence**: confidence < 0 → reject
11. **Missing outcome field**: required `outcome` field absent → reject
12. **Duplicate evidence IDs**: same ID referenced twice → flag
13. **Overconfident certainty**: confidence > 0.9 with `completeness: "partial"` → flag
14. **Fabricated evidence IDs**: ID not in evidence set → reject
15. **Unsupported currency**: currency not in evidence → reject
16. **Invented seller names**: seller reference not matching input → reject

## Fallback Behavior

When DeepSeek returns `status: "fallback"` or validation rejects the output:
1. Build deterministic `FinancialAssessment`
2. `outcome`: `"unknown"`
3. `confidence`: `0`
4. Factual summary of available evidence only — no interpretation
5. All gaps enumerated
6. Risks list from evidence metadata
7. `source`: `"deterministic-fallback"`
8. `fallbackUsed`: `true`

## CEO Tools (4)

| Tool | Purpose | Assessment Type | Mutation |
|---|---|---|---|
| `ask_finance_director` | Open-ended financial question | `account-health` (default) | None |
| `review_financial_health` | Broad account health sweep | `account-health` | None |
| `explain_economic_outcome` | Explain a specific outcome | `outcome-review` | None |
| `review_proposal_profitability` | Evaluate proposal without approving | `proposal-review` | None |

All tools:
- Require `sellerId`
- Return `noExternalMutationExecuted: true`
- Scope all queries to the requesting seller
- Return error gracefully when stores or advisor are unavailable

## Work Sessions Integration

The `finance-director` lane is registered as a **sessionized lane** in `daemonScheduler.ts`. When `enableWorkSessions` is true, daemon ticks for this lane route through `AgentWorkSessionRunner` instead of direct handler dispatch.

### Wake reasons

| Reason | Trigger |
|---|---|
| `ceo_question` | CEO asks a financial question |
| `economic_outcome_observed` | New economic outcome calculated |
| `economic_outcome_disputed` | Outcome status marked `disputed` |
| `new_unit_economics_snapshot` | Fresh snapshot ingested |
| `profit_anomaly` | Negative net profit detected |
| `missing_input_resolved` | Previously missing cost data now available |
| `evidence_response_received` | Response to pending evidence request |
| `proposal_review_requested` | CEO or daemon requests profitability review |

### Daemon handler

The `financeDirectorDaemon` scans for:
- New economic outcomes (since last check)
- Profit anomalies (negative net profit)
- Low-confidence outcomes (confidence < 0.5)
- Enqueues structured CEO proposals with findings

Interval is configurable via `MSL_FINANCE_DIRECTOR_INTERVAL_MS` (not 15-minute default — longer intervals recommended).

## Boundaries and Limits

- **Read-only**: Never publishes, changes prices, executes actions, or modifies MercadoLibre
- **No verification**: Never marks outcomes as `verified` — that's a separate process
- **Seller isolation**: Column-scoped `sellerId` throughout; Plasticov cannot see Maustian's data
- **No currency mixing**: CLP and USD operations are isolated
- **No floating point**: All reasoning via integer minor units
- **No fabrication**: Missing data is reported, not invented
- **No approval changes**: `review_proposal_profitability` never changes approval state
- **Cortex deferred**: Reinforcement learning from verified outcomes is PR 3/3

## Separation of Concerns

| Concern | PR 1/3 | PR 2/3 (this) | PR 3/3 |
|---|---|---|---|
| Calculation | ✅ | Reads from | Reads from |
| Persistence | ✅ | Reads from | Reads from |
| Interpretation | — | ✅ (DeepSeek) | ✅ |
| Validation | — | ✅ (16 rules) | ✅ |
| Learning | — | — | ✅ (Cortex) |

## What's left for PR 3/3 (Cortex Reinforcement Loop)

- Verified economic outcomes → Cortex Darwinian learning
- Attribution: which agent/action caused which outcome
- Agent economic scorecards
- Reinforcement: proven-profitable patterns get stronger edges
- Penalty: loss-making patterns get weaker edges
- Scheduling by expected economic utility
