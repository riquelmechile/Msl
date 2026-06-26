# Delta for conversational-business-agent

## ADDED Requirements

### Requirement: Actor Profile Injection in Cortex Context

The system MUST include activated actor profile nodes in `get_business_context` tool output as part of Block C context injection. Actor profiles SHALL be capped at 200 tokens per actor, limited to top-3 most activated.

#### Scenario: Actor profiles included

- GIVEN actor profile nodes exist in Cortex with activation above threshold
- WHEN `get_business_context` is called for a pricing-related query
- THEN the output MUST include an `actor_profiles` section with node metadata (price_sensitivity, negotiation_levers, strategy)
- AND each profile MUST be ≤ 200 tokens

#### Scenario: No actor profiles active

- GIVEN no actor nodes have been seeded or activation is below threshold
- WHEN `get_business_context` is called
- THEN the output MUST omit the `actor_profiles` section entirely

#### Scenario: Actor count capped at 3

- GIVEN 5 actor nodes are activated above threshold
- WHEN context is assembled
- THEN only the top-3 by activation score MUST be included

---

### Requirement: simulate_actor Tool Routing

The agent loop MUST register `simulate_actor` as an available tool and route its invocations. After tool execution, results MUST be injected back into conversation context before final response synthesis. The tool SHALL NOT be called on simple informational queries.

#### Scenario: Tool registered and available

- GIVEN the agent loop initializes
- WHEN tools are registered
- THEN `simulate_actor` MUST appear in the LLM tool list alongside `get_business_context` and `prepare_action`

#### Scenario: Tool invocation and synthesis

- GIVEN the main LLM emits a `simulate_actor("comprador", query)` tool call
- WHEN `agentLoop` processes the turn
- THEN the tool MUST execute and its result MUST be added to the messages array
- AND the main LLM MUST synthesize actor insights into the final response

#### Scenario: Tool not called on simple queries

- GIVEN seller asks "¿cuántas ventas tuve hoy?"
- WHEN the agent processes the message
- THEN `simulate_actor` SHALL NOT be invoked (no counter-party modeling needed)

---

### Requirement: Actor Persona Section in System Prompt

The system MUST inject an `## Actores del Mercado` section into Block A of the system prompt when actor profiles are active. The section SHALL describe actor personas in Spanish with Chilean market context. It MUST be omitted when no profiles are seeded.

#### Scenario: Active actor profiles injected

- GIVEN at least one actor profile node is seeded in Cortex
- WHEN `buildSystemPrompt(sellerName, strategies, actorProfiles)` is called
- THEN Block A MUST include `## Actores del Mercado` with persona descriptions in Spanish
- AND each description MUST include typical behaviors for MercadoLibre Chile

#### Scenario: No actor profiles seeded

- GIVEN no actor profile nodes exist in Cortex
- WHEN `buildSystemPrompt` is called
- THEN the `## Actores del Mercado` section MUST be omitted entirely

#### Scenario: Cache invalidation on actor profile change

- GIVEN Block A is cached from a prior conversation
- WHEN an actor profile node is seeded, updated, or removed
- THEN the system MUST regenerate Block A with updated actor personas
- AND accept the one-time cache miss cost
