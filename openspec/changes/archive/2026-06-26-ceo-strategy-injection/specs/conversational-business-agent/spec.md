# Delta for Conversational Business Agent

## ADDED Requirements

### Requirement: Strategy-Aware System Prompt

The system MUST inject active CEO strategies into Block A of the system prompt under an `## Estrategia del CEO` section, rendering each strategy rule as a human-readable Spanish directive. `buildSystemPrompt(sellerName, strategies)` MUST accept an optional strategies parameter.

#### Scenario: Active strategies injected

- GIVEN active strategies exist for margin, stock priority, and category exclusion
- WHEN `buildSystemPrompt` is called with the strategies parameter
- THEN Block A MUST include an `## Estrategia del CEO` section listing all active rules in Spanish

#### Scenario: No active strategies

- GIVEN no active strategies exist in the database
- WHEN `buildSystemPrompt` is called
- THEN the `## Estrategia del CEO` section MUST be omitted entirely

#### Scenario: Cache invalidation on strategy change

- GIVEN Block A is cached from a prior conversation
- WHEN an active strategy is created, updated, or deactivated
- THEN the system MUST regenerate Block A with the updated strategies
- AND accept the one-time cache miss cost

### Requirement: Strategy Management via Conversation

The system MUST allow the CEO to create, list, update, and archive strategies through natural Spanish conversation without leaving the chat interface.

#### Scenario: CEO lists active strategies

- GIVEN strategies exist in the database
- WHEN the CEO types "listá mis estrategias" or equivalent
- THEN the agent MUST return a Spanish summary of all active strategies with rule types and values

#### Scenario: CEO updates a strategy

- GIVEN an active margin strategy exists for "electrónica"
- WHEN the CEO types "cambiá margen a 45%"
- THEN the system MUST parse the new strategy, deactivate the old one, and confirm the update in Spanish

#### Scenario: CEO archives a strategy

- GIVEN an active strategy exists
- WHEN the CEO requests archiving it (e.g., "dejá de priorizar stock")
- THEN the system MUST deactivate the strategy and confirm in Spanish

### Requirement: Strategy Conflict Resolution

The system MUST detect when multiple active strategies conflict and SHOULD resolve using deterministic ordering (newer overrides older) with LLM reconciliation guidance in the system prompt.

#### Scenario: Conflicting margin and competitive strategies

- GIVEN active strategies include "margen 50% en electrónica" and "igualá precio de competidor X en electrónica"
- WHEN the agent evaluates proposals in the "electrónica" category
- THEN Block A MUST instruct the LLM to reconcile conflicts with the newer strategy taking priority

#### Scenario: Non-conflicting strategies coexist

- GIVEN active strategies target different categories
- WHEN Block A is assembled
- THEN all strategies MUST be included without conflict warnings
