# Proposal: Finance Director Agent (PR 2/3 Financial Truth)

## Intent

MSL has product-level specialists but no agent integrating cost, sales, account, and economic-outcome evidence into a unified financial picture. The CEO needs a Finance Director reasoning over real data via DeepSeek — detecting gaps, questioning conclusions, delivering assessments without fabricating numbers.

## Scope

### In Scope
- `LaneId = "finance-director"`, department `finance` in `LANE_CONTRACTS`
- **FinanceDirectorAdvisor** — DeepSeek reasoning over `EconomicOutcomeStore` + evidence
- **EvidenceAssembler** — gathers from cost-supplier, product-ads-profitability, account-brain
- **PromptBuilder** — cache-friendly 4-block via `cacheBlocks`
- **Validator** — rejects hallucinations, currency mixing, invented causality
- **Fallback** — deterministic path on DeepSeek failure
- **`FinancialAssessment`** type — assessment kind, confidence, evidence IDs, gaps, reasoning trace
- **`FinanceDirectorAssessmentStore`** — SQLite, seller-scoped
- **4 CEO tools**: `ask_finance_director`, `review_financial_health`, `explain_economic_outcome`, `review_proposal_profitability` (`noMutationExecuted: true`)
- Evidence requests via `EvidenceResponseRouter` + `AgentMessageBusStore`
- Work Session support

### Out of Scope (PR 3/3)
Cortex reinforcement, Darwinian learning, causal attribution, auto-verification, mutations (price/ad-spend/purchases), landed cost, cash flow, legal taxes, forecasting.

## Capabilities

### New Capabilities
- `finance-director-lane`: Lane contract + department `finance` in `CompanyDepartmentId`
- `finance-director-advisor`: DeepSeek reasoning with structured `FinancialAssessment` output
- `finance-director-assessment-store`: SQLite persistence for assessments
- `finance-director-tools`: CEO read-only financial reasoning tools

### Modified Capabilities
- `company-agents`: Extend `CompanyDepartmentId` with `"finance"`
- `lane-contracts`: Add `"finance-director"` to `LaneId` union + `LANE_CONTRACTS`

## Approach

Reuse `DeepSeekReasoningGateway`, `EvidenceResponseRouter`, `cacheBlocks`, `AgentWorkSessionStore`. The Finance Director interprets evidence atop the deterministic engine — never fabricates numbers.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/lanes.ts` | Modified | Add lane |
| `packages/agent/src/conversation/companyAgents.ts` | Modified | Add department |
| `packages/agent/src/conversation/tools/` | New | 4 finance tools |
| `packages/agent/src/finance/` | New | Advisor, assembler, builder, validator |
| `packages/memory/src/` | New | Assessment store |
| `packages/domain/src/` | New | `FinancialAssessment` type |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| DeepSeek hallucinates conclusions | Medium | Validator rejects unsupported claims; deterministic fallback |
| Currency mixing across sellers | Low | `CurrencyMismatchError`; single-currency context enforcement |
| Cross-seller data exposure | Low | `seller_id` on all store queries |
| Prompt cache miss on large evidence | Medium | Stable 4-block structure; evidence in cacheable context |

## Rollback Plan

Additive — remove lane, drop tables, unregister tools. No existing behavior modified.

## Success Criteria

- [ ] Answers `"Are we making money on product X?"` with evidence, confidence, and gaps
- [ ] Never invents data when snapshots are partial
- [ ] Rejects currency-mixing inquiries
- [ ] `noMutationExecuted: true` on all tools
- [ ] Seller isolation enforced (plasticov vs maustian)
- [ ] Deterministic fallback returns structured `FinancialAssessment`
- [ ] ≥10 unit tests covering hallucination rejection, missing-data, currency safety
