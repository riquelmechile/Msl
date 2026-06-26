# Delta for actor-simulation

## MODIFIED Requirements

### Requirement: Actor Persona Profiles

The system MUST maintain persona profiles for 3 actor types (comprador, proveedor, competidor) as Cortex graph nodes with Chilean market metadata. `GraphEngine.seedActorNodes()` MUST create or update these nodes. The competidor persona MUST include counterintelligence metadata: `probe_patterns[]` (observed probing behaviors) and `threat_level` (low | medium | high) computed from Hebbian probe edges.

| Actor      | Key Metadata                                                                   |
|------------|--------------------------------------------------------------------------------|
| comprador  | price_sensitivity, trust_drivers, shipping_preference                          |
| proveedor  | min_order, lead_time_days, negotiation_levers                                  |
| competidor | avg_price, strategy, listing_count, probe_patterns, threat_level               |

(Previously: competidor persona lacked counterintelligence fields.)

#### Scenario: Profile seeding on init

- GIVEN the Cortex graph is initialized
- WHEN `seedActorNodes()` is called
- THEN 3 actor nodes MUST be created with Spanish metadata
- AND existing nodes MUST be updated, not duplicated

#### Scenario: Actor profiles in cortex traversal

- GIVEN actor nodes seeded
- WHEN `GraphEngine.traverse()` runs on a pricing query
- THEN top-3 activated actor profiles MUST appear in traversal context

## ADDED Requirements

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
