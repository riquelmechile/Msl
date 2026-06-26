# actor-simulation Specification

## Purpose

Internal simulation models for buyer (comprador), supplier (proveedor), and competitor (competidor) counter-party behavior grounded in MercadoLibre Chile market realities. Provides on-demand LLM simulation via `simulate_actor` tool with Hebbian learning feedback from confirmed seller outcomes.

## Requirements

### Requirement: Actor Persona Profiles

The system MUST maintain persona profiles for 3 actor types (comprador, proveedor, competidor) as Cortex graph nodes with Chilean market metadata. `GraphEngine.seedActorNodes()` MUST create or update these nodes. The competidor persona MUST include counterintelligence metadata: `probe_patterns[]` (observed probing behaviors) and `threat_level` (low | medium | high) computed from Hebbian probe edges.

| Actor | Key Metadata |
|-------|-------------|
| comprador | price_sensitivity, trust_drivers, shipping_preference |
| proveedor | min_order, lead_time_days, negotiation_levers |
| competidor | avg_price, strategy, listing_count, probe_patterns, threat_level |

#### Scenario: Profile seeding on init

- GIVEN the Cortex graph is initialized
- WHEN `seedActorNodes()` is called
- THEN 3 actor nodes MUST be created with Spanish metadata
- AND existing nodes MUST be updated, not duplicated

#### Scenario: Actor profiles in cortex traversal

- GIVEN actor nodes seeded
- WHEN `GraphEngine.traverse()` runs on a pricing query
- THEN top-3 activated actor profiles MUST appear in traversal context

---

### Requirement: simulate_actor Tool

The system MUST expose a `simulate_actor(name, query)` tool that executes a focused LLM call with actor-specific curated Spanish system prompt. Valid names: `comprador`, `proveedor`, `competidor`.

#### Scenario: Valid actor simulation

- GIVEN `simulate_actor("comprador", "¿Comprarías a $15.000 con envío gratis?")`
- WHEN the tool executes
- THEN a focused LLM call with comprador persona prompt MUST return structured Spanish output with reasoning

#### Scenario: Invalid actor name

- GIVEN `simulate_actor("unknown", query)`
- WHEN the tool executes
- THEN it MUST return error listing valid actor names

#### Scenario: Empty query

- GIVEN `simulate_actor("proveedor", "")`
- WHEN the tool executes
- THEN it MUST return error requiring non-empty query

---

### Requirement: Actor Simulation Tracking

The system MUST persist each simulation consultation in an `actor_simulations` table with columns: id, actor_name, query, result_summary, outcome_status (pending|confirmed|rejected), created_at, resolved_at.

#### Scenario: Consultation logged

- GIVEN `simulate_actor` is called
- WHEN tool executes
- THEN a row MUST be inserted with `outcome_status = "pending"`

#### Scenario: Outcome confirmed

- GIVEN seller confirms outcome from a simulation
- WHEN `reinforceActorOutcome(simulationId)` is called
- THEN the row's `outcome_status` MUST update to `"confirmed"` with `resolved_at` timestamp

---

### Requirement: Hebbian Actor Learning

The system MUST adjust actor profile edges via `reinforceActorOutcome(nodeId)` (+0.1) and `penalizeActorOutcome(nodeId)` (−0.15), clamped to [0, 1]. Learning triggers from confirmed seller outcomes.

#### Scenario: Positive reinforcement

- GIVEN a confirmed successful outcome linked to actor node
- WHEN `reinforceActorOutcome(nodeId)` is called
- THEN connected edges MUST strengthen by +0.1 and `last_activated` MUST update

#### Scenario: Negative penalization

- GIVEN a rejected or incorrect simulation outcome
- WHEN `penalizeActorOutcome(nodeId)` is called
- THEN connected edges MUST weaken by −0.15 and `last_activated` MUST update

#### Scenario: Boundary clamping

- GIVEN edge weight 0.05; WHEN penalized → clamped to 0.0
- GIVEN edge weight 0.95; WHEN reinforced → clamped to 1.0

---

### Requirement: CEO Strategy Guardrail

The system MUST validate actor-advised proposals against CEO strategies. `strategyValidator` runs AFTER actor consultation; CEO strategies override actor advice when they conflict.

#### Scenario: Actor contradicts CEO margin floor

- GIVEN actor simulation suggests lower price (below CEO margin minimum)
- WHEN `strategyValidator` processes the proposal
- THEN it MUST reject the actor-advised price and enforce CEO margin floor

#### Scenario: Actor aligns with all strategies

- GIVEN actor advice respects all active CEO strategies
- WHEN `strategyValidator` processes the proposal
- THEN it MUST pass without modification

---

### Requirement: simulate_counterintelligence Tool

The system MUST expose a `simulate_counterintelligence(actor_name, query)` tool focused on competitor probing analysis. It SHALL use the enhanced competidor persona prompt with counterintelligence awareness and return structured analysis: detected probing indicators, behavioral pattern classification, and recommended response.

#### Scenario: Counterintelligence analysis on competidor

- GIVEN `simulate_counterintelligence("competidor", "analizá patrón de preguntas en electrónica")`
- WHEN the tool executes
- THEN output MUST include detected indicators, pattern classification, and recommended action in Spanish

#### Scenario: Invalid actor for counterintelligence

- GIVEN `simulate_counterintelligence("comprador", query)`
- WHEN the tool executes
- THEN it MUST return error stating only "competidor" is valid for counterintelligence

#### Scenario: No probe patterns detected

- GIVEN `simulate_counterintelligence("competidor", "analizá categoría sin actividad")`
- WHEN analysis runs on a category with no suspicious patterns
- THEN output MUST indicate "no se detectaron patrones de sondeo" with confidence 0
