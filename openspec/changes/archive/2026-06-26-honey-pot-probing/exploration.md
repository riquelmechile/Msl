## Exploration: Honey-Pot Probing / Active Counterintelligence (Phase 5)

### Current State

The system already has the building blocks for counterintelligence, just wired for reactive simulation, not proactive probing:

- **Actor Models** (`actorSimulator.ts`): `competidor` actor already simulates competitor behavior with prompts like "Monitoreás precios de la competencia, ajustás tus publicaciones para ganar visibilidad, reaccionás a cambios de precio." The persona EXISTS but is only consulted on-demand via `simulate_actor` tool.
- **Agent Loop** (`agentLoop.ts`): Processes turns through guardrails → LLM → tool-call loop → response synthesis. Tools currently: `get_business_context`, `prepare_action`, `simulate_actor`.
- **Cortex** (`engine.ts`): Neural graph with Hebbian reinforcement (+0.1 / −0.15), spreading activation via recursive CTE, convergence detection, Darwinian pruning. Already has `actor_simulations` table and `seedActorNodes`/`reinforceActorOutcome` methods.
- **Guardrails** (`guardrails.ts`): `strategyValidator` blocks proposals violating CEO strategies. `actionSafetyValidator` checks risk levels. Every proposal needs "dale" confirmation.
- **Strategy Parser** (`strategyParser.ts`): Extracts `competitive` rules ("igualar precio de X") and `category` rules ("no competir en X"). Already has `competitor` and `competitive` rule types in the type system.
- **Prepared Actions** (`preparedAction.ts`): Seven action kinds — `price-change`, `stock-change`, `customer-message`, `cancellation`, `refund`, `listing-edit`, `creative-publication`. None of these are honey-pot-specific today.

The gap: all simulation is REACTIVE. The CEO asks "¿cómo reaccionaría un competidor si bajo precio?" and the agent simulates. There is no autonomous detection of competitor probing, no decoy deployment, no counter-measure logic. The system has eyes but no ears for hostile intelligence gathering.

### Affected Areas

- `packages/agent/src/conversation/tools.ts` — New tools for honey-pot deployment, competitor behavior analysis, and probe detection
- `packages/agent/src/conversation/actorSimulator.ts` — Enhanced `competidor` persona prompt with counterintelligence awareness
- `packages/agent/src/conversation/guardrails.ts` — New guardrail requiring explicit CEO approval for honey-pot operations; extends `strategyValidator` for honey-pot-specific strategies
- `packages/agent/src/conversation/strategyParser.ts` — New regex patterns for honey-pot CEO directives ("probá competidores", "creá listing señuelo")
- `packages/agent/src/conversation/types.ts` — New `RuleType` (or extension of `competitive`), new `WriteActionKind` for honey-pot actions, probe-related types
- `packages/memory/src/cortex/engine.ts` — New methods: `recordProbeObservation`, `detectProbebehavior`, `getCompetitorFingerprint`
- `packages/memory/src/cortex/database.ts` — New tables: `probe_operations`, `competitor_observations`, `suspicious_events`
- `packages/domain/src/preparedAction.ts` — New `WriteActionKind` entries for honey-pot operations
- `openspec/specs/actor-simulation/spec.md` — Delta spec for honey-pot extension
- `openspec/specs/conversational-business-agent/spec.md` — Delta spec for probe tools and CEO directives

### Approaches

#### 1. **Agent Tool Extension (Minimal)**
Add three new LLM-callable tools: `deploy_decoy_listing`, `analyze_competitor_reactions`, and `detect_suspicious_activity`. Each tool is stateless and executes on conversation trigger only. No background detection, no Cortex learning for probe patterns.

- **Pros**:
  - ~150 lines of new code; reuses 100% of existing infrastructure
  - No new database tables; probe state stored in conversation messages
  - CEO approval via existing `prepare_action` → "dale" pipeline
  - Aligns with "cell → tissue → organ" philosophy (start minimal)
- **Cons**:
  - No autonomous detection — CEO must manually ask "¿me están probando?" every time
  - No historical pattern learning; each analysis is isolated
  - Competitor behavior patterns are not stored or reinforced
  - Decoy listings use existing `creative-publication` action kind, which conflates real and fake listings at the domain level
- **Effort**: Low

#### 2. **Cortex-Backed Competitor Fingerprint Engine**
Add a `CompetitorFingerprint` subsystem in the Cortex package that builds behavioral models of known competitors:
- Stores competitor observations (price changes, reaction times, question patterns) as Cortex nodes
- Uses Hebbian learning to strengthen edges between competitor patterns and outcomes
- `spreadActivation` on a competitor query surfaces learned behavioral patterns
- New `competitor_observations` table for timestamped events
- Detection is cortex-driven: seeding competitor-related terms triggers activation across learned competitor edges

- **Pros**:
  - Leverages existing Hebbian learning — competitor patterns improve with data
  - Context is injectable into Block C via existing `get_business_context` tool
  - Autonomous pattern recognition as graph weights evolve
  - No new package — extends memory package
  - Competitor fingerprints persist across sessions
- **Cons**:
  - Cortex is for REPRESENTING knowledge, not SCHEDULING detection; still needs a trigger mechanism
  - No active probing capability (decoy listings, bait questions) — detection only
  - Competitor observation ingestion needs either ML API integration (Phase 7) or manual CEO input
  - Graph nodes represent static knowledge; temporal patterns (reaction time, spike detection) need time-series logic the graph model doesn't natively support
- **Effort**: Medium

#### 3. **Actor Model Extension + CEO Approval Gates (Conservative)**
Extend the existing actor/guardrail/strategy trio:
- Enhance `competidor` persona prompt with counterintelligence awareness: "Sos un vendedor competidor... también sabés que te pueden estar probando con listings señuelo y ajustás tu estrategia con cautela."
- Add new `WriteActionKind`: `honey-pot-deploy` for decoy listings, `probe-analysis` for behavioral queries
- Extend `strategyParser` for honey-pot CFO directives: `"probá competidores en {categoría}"`, `"creá listing señuelo a ${precio}"`, `"monitoreá reacciones de {competidor}"`
- New `honeyPotGuardrail` that BLOCKS any honey-pot operation unless the CEO has an explicit active strategy authorizing it — default posture is deny-all
- `probeStrategyValidator` extends `strategyValidator` to check CEO approval for probe operations
- New `simulate_actor` variant: `simulate_counterintelligence` that evaluates whether a competitor is probing YOU

- **Pros**:
  - Maximum safety: every honey-pot operation requires explicit CEO strategy + "dale" confirmation
  - Reuses existing guardrail pattern (proposal → strategy check → confirmation → execute → audit)
  - Minimal new infrastructure — extends what already exists
  - CEO has full control over when/how probing happens
  - Competitor persona becomes aware of counterintelligence, making simulations more realistic
- **Cons**:
  - No autonomous detection — CEO must guide every probe operation
  - Decoy listing management is conversational; doesn't scale beyond a few operations
  - Competitor behavior analysis requires the CEO to interpret results; no automated alerting
  - The "actor simulation" paradigm is conversational — probing is inherently operational, not just conversational
- **Effort**: Medium

#### 4. **Hybrid: Autonomous Probe Engine + CEO Oversight (Feature-Complete)**
A new `ProbeEngine` in the memory package (or dedicated `packages/probing/`) with:
- **Autonomous detection layer**: time-series-based pattern recognition for view spikes, repeated questions from same accounts, reaction-time modeling
- **Cortex integration**: competitor observations stored as graph nodes with temporal metadata; Hebbian edges between competitor behaviors and outcomes
- **CEO alert protocol**: when probing detected, the agent proactively informs the CEO in conversation with evidence and confidence level
- **Approval gating**: honey-pot counter-operations (decoy deployments, bait responses) require CEO "dale" confirmation, but DETECTION is autonomous
- **New tables**: `probe_operations` (decoy lifecycle), `competitor_observations` (timestamped events), `suspicious_events` (detection records)
- **New tools**: `get_competitor_intelligence` (reads probe data), `deploy_decoy` (with CEO approval check), `analyze_probe_patterns` (detection results)
- **Strategy extensions**: `"alertame si detectan mis listings"`, `"no honey-pot en {categoría}"`, `"creá decoy en {categoría} a ${precio}"`

- **Pros**:
  - Full feature coverage: detection + counter-measures + misdirection + alerting
  - CEO doesn't need to manually trigger analysis — system detects and alerts
  - Cortex stores learned competitor patterns; improves over time
  - Clean separation: detection is autonomous (safe), deployment requires approval (safe)
  - Probe engine can be tested independently of conversation flow
- **Cons**:
  - Most complex approach; ~600-800 lines of new code across 3 packages
  - Time-series detection logic is new territory — no existing patterns in the codebase
  - Requires new database tables and schema migrations
  - Autonomous behavior requires scheduling infrastructure (cron, setInterval, or event-driven trigger) — the project currently has no background task runner
  - The project's philosophy explicitly warns against premature complexity: "44 tools + 6 plugins before stable core = failure"
  - Effective detection REQUIRES ML API integration (Phase 7) to ingest real listing data, view counts, and question events; without it, detection is synthetic
- **Effort**: High

### Recommendation

**Start with Approach 3 (Actor Model Extension + CEO Approval Gates), designed to evolve into Approach 4 incrementally.**

Rationale:

1. **Philosophy alignment**: The ROADMAP explicitly warns against the "El Sindicato" failure of 44 tools before a stable core. Phase 5 should extend existing patterns, not introduce a new architectural paradigm.

2. **Safety first**: Honey-pot operations involve creating fake listings on MercadoLibre. This is ethically and commercially sensitive. Default-deny posture via CEO strategy requirement is the right call. The existing guardrail pipeline (proposal → strategy validator → "dale" → execute → audit) is the proven safety mechanism.

3. **Data dependency**: Autonomous detection (Approach 4) requires real ML data (view counts, question events, listing metrics). That's Phase 7. Building a ProbeEngine before the data pipeline exists means the engine operates on synthetic/mock data and can't deliver real intelligence.

4. **Pareto efficiency**: Approach 3 delivers 80% of the value (decoy operations, competitor simulation with counterintelligence awareness, CEO-controlled probing) with 20% of the complexity of Approach 4.

5. **Evolution path**: Approach 3 can be extended to Approach 4 when Phase 7 (Real ML API) lands. The `WriteActionKind` extensions, strategy patterns, and guardrails from Approach 3 become the approval layer for the autonomous engine in Approach 4. The Cortex competitor nodes from Approach 3 become the training data for Approach 4's detection patterns.

**Implementation roadmap:**
1. Phase 5a (this change): Actor extension + CEO gates + decoy tools — the conservative foundation
2. Phase 5b (future, post-Phase-7): Autonomous detection engine with real ML data — the intelligent layer on top

### Risks

- **MercadoLibre TOS**: Fake listings violate ML's terms of service if detected. The CEO must understand the legal risk. The system should NEVER autonomously create decoys — always gated behind explicit CEO approval with warning.
- **Competitor retaliation**: If competitors detect honey-pot operations, it can escalate into price wars or reputation attacks. The guardrail should include a warning mechanism.
- **Data fidelity**: Without ML API integration, probe detection operates on simulated data. This risks false positives (CEO alerted about phantom probing) or false negatives (real probing undetected).
- **Strategy parser ambiguity**: "probá competidores" vs "no competir en" are semantically close but operationally opposite. The parser must disambiguate probing from exclusion clearly.
- **Cortex graph pollution**: Repeated decoy operations with no real outcomes could create misleading Hebbian patterns if not properly scoped. Decoy-related nodes should be tagged with a `probe: true` metadata flag to distinguish from real business learning.

### Ready for Proposal
Yes — sufficient exploration to proceed with a proposal for the conservative Approach 3, structured to evolve into Approach 4 post-Phase-7.
