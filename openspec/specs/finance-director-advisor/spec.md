# Finance Director Advisor Specification

## Purpose

DeepSeek-powered reasoning service that assembles economic evidence, builds cache-friendly prompts, validates responses, and produces structured `FinancialAssessment` outputs. Falls back deterministically when DeepSeek is unavailable.

## Requirements

### Requirement: Evidence Assembly and Reasoning

The advisor MUST accept structured economic evidence (from `EconomicOutcomeStore`, cost data, Product Ads profitability, account brain, etc.) and produce a `FinancialAssessment` with outcome, confidence, evidence IDs, gaps, and reasoning trace.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Profit interpretation | Complete unit-economics and cost evidence for product X | Advisor reasons | Assessment returned with profit/non-profit outcome, confidence ≥ 0.7 |
| Revenue without profit | Revenue data present, cost evidence missing | Advisor reasons | Outcome marked `unknown`, gaps list `missing-cost-evidence`, confidence ≤ 0.3 |
| Partial snapshot | Only 3 of 15 evidence kinds available | Advisor reasons | Assessment returned with `completeness: partial`, all 12 missing kinds listed |

### Requirement: Cache-Friendly Prompt Structure

The advisor MUST build prompts using 4 blocks: A (identity+rules, cached), B (company context, cached), C (session context, cached), D (dynamic evidence, uncached). SHALL reuse the `cacheBlocks` pattern from `DeepSeekReasoningGateway`.

#### Scenario: Cache reuse across sessions

- GIVEN blocks A, B are stable across invocations for the same seller
- WHEN consecutive `ask_finance_director` calls use the same stable prefix and context
- THEN prompt cache hits SHALL be measured on block A and block B

### Requirement: Response Validator

The validator MUST reject: hallucinated numbers (unbacked by evidence IDs), currency mixing across sellers, invented causality without evidence linkage, missing→zero conversion, observed→verified claims without verification timestamps, and guaranteed profit claims.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Hallucinated figure | LLM outputs `profit: 50000` but no evidence IDs present | Validator runs | Output rejected; fallback triggered |
| Hallucinated causality | LLM claims "cost reduction caused profit" without cost-evidence ID | Validator runs | Output rejected; fallback triggered |
| Currency incompatibility | Evidence contains CLP, seller requests USD comparison | Validator runs | `CurrencyMismatchError` raised |
| Deceptive ROAS | LLM reports high ROAS using revenue-only, ignoring cost evidence | Validator runs | Assessment flagged as `incomplete`, cost gap noted |
| Old costs | Cost evidence > 30 days old, marked `stale` | Validator runs | Assessment includes staleness warning, confidence degraded |

### Requirement: Deterministic Fallback

When `DeepSeekReasoningGateway` returns `status: "fallback"` or throws, the advisor SHALL return a `FinancialAssessment` with: outcome `unknown`, factual summary of available evidence, structured `missingInputs` list, enumerated risks, and confidence 0.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| DeepSeek timeout | Gateway times out after 30s | reason() completes | Fallback assessment returned, confidence=0, facts present |
| Fallback | DeepSeek unavailable entirely | reason() called | Fallback assessment returned with `source: "deterministic-fallback"` |
