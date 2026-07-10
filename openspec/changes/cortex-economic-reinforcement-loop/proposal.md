# Proposal: Cortex Economic Reinforcement Loop

> **Phase:** P1, PR 3/3 (Financial Truth)
> **Date:** 2026-07-10
> **Status:** Proposed

## Intent

Close the Financial Truth cycle by connecting verified economic outcomes to Cortex Darwinian learning. This is the third and final PR of the Financial Truth foundation series.

## Problem

Currently, Cortex learns from approval/rejection signals — CEO says "dale" or "no", and constellations get reinforced or penalized. But this only captures **preference**, not **effectiveness**. A CEO might approve a bad decision, or reject a good one. Cortex has no way to learn from actual economic results.

The existing system has:
- EconomicOutcome with a 6-state lifecycle (pending → observing → observed → verified/disputed/invalidated)
- Finance Director agent producing assessments
- Cortex Darwinian feedback for approval/rejection
- EconomicOutcomeStore as the source of economic truth

What's missing is the bridge: **verified economic outcomes feeding back into Cortex learning**.

## Core Principles

1. **CEO preference ≠ economic effectiveness.** Approval teaches what the CEO wants. Verified outcomes teach what actually works. These are distinct signals.

2. **Only `verified` outcomes are eligible.** Never reinforce from pending, observing, observed, disputed, or invalidated outcomes.

3. **Verified ≠ causal.** A verified outcome means the numbers are confirmed accurate. It does NOT prove that action X caused profit Y. Attribution must be evaluated separately.

4. **EconomicOutcomeStore remains the source of truth.** Cortex is a learning system, not the ledger. Cortex failures must never modify or invalidate economic outcomes.

5. **Learning must be auditable and reversible.** Every reinforcement action is recorded. Reversals are supported. History is preserved.

6. **Weak attribution → cautious lesson.** Correlation without evidence of contribution must not produce strong reinforcement.

## Scope

### Implement

- **EconomicLearningEligibilityEvaluator** — deterministic gate: only verified, complete, coherent outcomes qualify
- **EconomicSignalCalculator** — deterministic signal from economic data (direction, magnitude, confidence)
- **EconomicAttributionEvaluator** — evidence-based attribution strength assessment
- **AttributionStrength** — five-level scale: none, associated, contributory, experiment-supported, causal
- **EconomicReinforcementPlanner** — transforms signal + attribution into a validated plan
- **CortexEconomicReinforcementBridge** — applies the plan to Cortex with idempotency
- **EconomicLearningStore** — SQLite ledger for eligibility, attribution, plans, events, reversals
- **Reversal support** — disputed/invalidated outcomes trigger compensation events
- **Finance Director read-only tools** — `explain_economic_learning`, `inspect_economic_learning_status`, `list_economic_learning_events`
- **Event-driven wake policy** — process on verified/disputed/invalidated events, not polling

### Do NOT Implement

- Autonomous decision execution from learned patterns
- Price changes, ad spend, publishing, purchasing
- Cross-seller learning (Plasticov ↔ Maustian isolation maintained)
- Causal inference beyond evidence-supported attribution
- Statistical models, external training, fine-tuning
- Kafka, Redis, graph databases, vector databases
- HTTP calls to external APIs
- Raw LLM output storage

## Non-Goals

- Autonomous commercial mutations
- Cross-account learning without explicit process
- Real-time financial dashboard (deferred to P0)
- Landed cost production
- Full accounting cash flow

## Architecture Tiers

### Tier 1 — Economic Truth (deterministic)
Source: EconomicOutcome, UnitEconomicsSnapshot, verified evidence. Answers "what happened." Must be deterministic.

### Tier 2 — Attribution Evaluation (evidence-based)
Estimates how reasonable it is to associate the outcome with proposals, actions, sessions, agents, campaigns. Must not assert causality without support. DeepSeek can assist with hypothesis formulation but cannot override evidence limits.

### Tier 3 — Cortex Application (learning)
Creates outcome nodes, links evidence, adjusts eligible connections, records learning events, prevents duplicates, enables audit and reversal. Must never recalculate profit.

## Files Planned

| Package | File | Purpose |
|---------|------|---------|
| domain | `economicLearning.ts` | Types: Eligibility, AttributionStrength, AttributionAssessment, ReinforcementPlan, LearningEvent |
| domain | `economicLearningEligibility.ts` | Deterministic eligibility evaluator |
| domain | `economicSignal.ts` | Economic signal calculator |
| memory | `economicLearningStore.ts` | SQLite ledger for learning artifacts |
| agent | `EconomicAttributionEvaluator.ts` | Evidence-based attribution assessment |
| agent | `EconomicReinforcementPlanner.ts` | Plan generation from signal + attribution |
| agent | `CortexEconomicReinforcementBridge.ts` | Cortext bridge with idempotency |
| agent | `economicLearningTools.ts` | Finance Director read-only inspection tools |
| agent | workers | Event handlers for verified/disputed/invalidated outcomes |

## Acceptance Criteria

1. Hardening PR 2 issues resolved
2. Lane/handler/validator counts aligned
3. Eligibility evaluator exists — only verified can advance
4. Verified but incomplete can be blocked
5. Economic signal calculator is deterministic
6. Attribution assessment exists — correlation ≠ causation
7. Reinforcement plan separated from application
8. Cortex bridge with idempotency exists
9. Seller-scoped ledger exists
10. Policy versioning tracked
11. Reversal supported
12. Cortex failure does not alter EconomicOutcome
13. Single episode does not create global rule
14. Lessons have scope, confidence, expiry
15. Finance Director participates without applying reinforcement
16. Read-only inspection tools exist
17. Plasticov ↔ Maustian isolation maintained
18. No commercial mutations, no HTTP, no chain-of-thought stored
19. Documentation aligned
20. Tests pass

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Over-reinforcement from weak attribution | Cortex learns wrong patterns | Attribution strength caps; cautious defaults |
| Causal confusion | System treats correlation as cause | Explicit attribution levels; anti-causality validator |
| Seller data leakage | Cross-account reinforcement | Seller-scoped queries, no cross-seller nodes |
| Cortex corruption from economic changes | Learning contradicts truth | Cortex never modifies EconomicOutcome; bridge is append-only |
| Idempotency failures | Duplicate reinforcement | Compare-and-swap with composite idempotency key |
