# Proposal: Honey-Pot Probing — Active Counterintelligence (Phase 5a)

## Intent

Give the agent counterintelligence capabilities: detect competitor probing of the seller's listings, propose honey-pot decoy operations, and learn competitor behavioral patterns — all gated behind mandatory CEO strategy authorization + "dale" confirmation.

## Scope

### In Scope
- **ProbeDetector**: analyze question/view patterns for suspicious competitor behavior via enhanced `simulate_actor`
- **HoneyPotProposer**: suggest decoy operations (decoy listings, bait responses) based on competitor actor analysis
- **ProbeResult store in Cortex**: new tables (`probe_operations`, `competitor_observations`, `suspicious_events`) for persistent pattern learning
- **CEO approval gate**: `honeyPotGuardrail` requiring explicit active CEO strategy + "dale" before any honey-pot operation executes
- **Competitor persona enhancement**: `competidor` actor prompt gains counterintelligence awareness
- **Strategy parser extension**: new regex patterns for honey-pot CEO directives

### Out of Scope
- Autonomous honey-pot execution (always requires "dale")
- ML API data ingestion (Phase 7) — detection operates on simulated/conversational data
- Actual MercadoLibre listing creation
- Autonomous background detection engine (Phase 5b, post-Phase-7)

## Capabilities

### New Capabilities
- `honey-pot-operations`: decoy listing deployment, probe analysis actions, and new `WriteActionKind` entries (`honey-pot-deploy`, `probe-analysis`)
- `probe-detection`: competitor behavior analysis via `simulate_counterintelligence` tool, suspicious pattern recognition through Cortex Hebbian learning

### Modified Capabilities
- `actor-simulation`: `competidor` persona prompt enhanced with counterintelligence awareness; new `simulate_counterintelligence` variant
- `conversational-business-agent`: probe tools registered in agent loop; CEO directives injected via `## Estrategia del CEO` in Block A
- `strategy-parser`: new patterns for honey-pot directives (`"probá competidores en {cat}"`, `"creá listing señuelo"`, `"monitoreá reacciones de {competidor}"`)
- `action-approval-safety`: `honeyPotGuardrail` — deny-all posture blocking honey-pot operations unless active CEO strategy authorizes them
- `neural-graph-memory`: new tables and methods for probe operation lifecycle, competitor observation tracking, and suspicious event recording

## Approach

Extend the existing actor/guardrail/strategy trio (Approach 3 from exploration). No new architectural paradigm — reuse what already works: proposal → strategy validator → "dale" → execute → audit. Enhances `competidor` persona for counterintelligence awareness, adds `WriteActionKind` entries for decoy operations, extends `strategyParser` for honey-pot directives, and introduces `honeyPotGuardrail` (default-deny, requires CEO strategy). Designed to evolve into autonomous detection (Approach 4) when Phase 7 delivers ML API data.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/tools.ts` | Modified | New `simulate_counterintelligence` tool registration |
| `packages/agent/src/conversation/actorSimulator.ts` | Modified | Enhanced competidor persona prompt |
| `packages/agent/src/conversation/guardrails.ts` | Modified | New `honeyPotGuardrail` |
| `packages/agent/src/conversation/strategyParser.ts` | Modified | Honey-pot pattern regex |
| `packages/agent/src/conversation/types.ts` | Modified | New `WriteActionKind`, probe types |
| `packages/memory/src/cortex/engine.ts` | Modified | New probe methods |
| `packages/memory/src/cortex/database.ts` | Modified | 3 new tables |
| `packages/domain/src/preparedAction.ts` | Modified | New action kind entries |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ML TOS violation from fake listings | Low | Default-deny guardrail + CEO must explicitly authorize every decoy with TOS warning |
| Competitor retaliation if decoys detected | Low | Guardrail includes warning mechanism; CEO decides risk appetite |
| Strategy parser ambiguity (probe vs exclude) | Medium | Disambiguate with distinct pattern anchors; LLM fallback for ambiguous input |
| Cortex graph pollution from decoy nodes | Low | Tag probe-related nodes with `probe: true` metadata to isolate from real business learning |

## Rollback Plan

- Deactivate all honey-pot strategies in `ceo_strategies` table (no active strategy = guardrail blocks all operations)
- Revert `competidor` persona prompt to pre-honey-pot version from git
- No schema migration required for rollback (new tables are additive; simply stop writing to them)
- Delete `honey-pot-deploy` and `probe-analysis` `WriteActionKind` entries from enum

## Dependencies

- Existing actor simulation infrastructure (Phase 4)
- Existing strategy parser and guardrail pipeline
- Existing Cortex Hebbian learning (Phase 3)

## Success Criteria

- [ ] CEO can issue honey-pot directives ("probá competidores en electrónica") and have them parsed into active strategies
- [ ] Agent proposes decoy operations when CEO authorizes probing; blocked otherwise
- [ ] `simulate_counterintelligence` returns structured competitor behavior analysis in Spanish
- [ ] Probe operations, competitor observations, and suspicious events are persisted with Cortex graph edges for future pattern learning
- [ ] Existing non-honey-pot agent behavior is unchanged (no regression)
