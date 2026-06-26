# Conversational Business Agent Specification

## Purpose

Define the Spanish-facing chat agent that learns the seller's business judgment for MercadoLibre Chile operations. Responses are LLM-generated via DeepSeek, not template-matched.

## Requirements

### Requirement: Natural Language Intent Inference

The system MUST infer seller intent from natural Spanish without topic enums, commands, or menus.

#### Scenario: Seller asks about margins

- GIVEN the seller writes "cómo andamos con los márgenes"
- WHEN the agent processes the message
- THEN it MUST identify margin-analysis intent and respond accordingly

#### Scenario: Vague question

- GIVEN the seller asks a vague question
- WHEN the agent cannot determine a specific intent
- THEN it MUST ask clarifying questions in Spanish

### Requirement: DeepSeek LLM Integration

The system MUST use DeepSeek v4 Flash via `openai` npm with `baseURL: "https://api.deepseek.com"`. Falls back to mock or noop client on failure.

#### Scenario: Valid API key

- GIVEN a valid `DEEPSEEK_API_KEY` environment variable is set
- WHEN the agent is created
- THEN it MUST use a real OpenAI client configured for the DeepSeek API

#### Scenario: No API key

- GIVEN `DEEPSEEK_API_KEY` is not set
- WHEN the agent is created
- THEN it MUST fall back to the configured mock or noop client

### Requirement: 3-Block Prefix-Anchored Cache

The system MUST assemble prompts as Block A (system prompt ~5K, immutable) + Block B (daily aggregates ~15K, 24h refresh) at prefix for caching, then Block C (Cortex context) per query.

#### Scenario: New conversation

- GIVEN a new conversation starts
- WHEN messages are assembled for the LLM
- THEN Block A must appear first, Block B second (~20K cacheable prefix)

#### Scenario: Cached prefix

- GIVEN Blocks A+B are cached from a prior turn
- WHEN a new message is sent
- THEN only Block C and the user message incur cost

### Requirement: Cortex Context via Tool

The system MUST expose `get_business_context` tool reading `GraphEngine.traverse().context`. Agent calls it on demand.

#### Scenario: Category context available

- GIVEN the seller asks about a category
- WHEN the agent calls the tool
- THEN it MUST return Cortex neural context for that category

#### Scenario: No learned data

- GIVEN the Cortex has no learned data for the query
- WHEN the agent calls the tool
- THEN it MUST return empty context without error

### Requirement: Conversation State

The system MUST maintain message history across turns; truncate oldest when context window overflows while preserving recent turns.

#### Scenario: Prior messages included

- GIVEN a conversation has 5 prior messages
- WHEN a new message is sent
- THEN those 5 prior messages MUST be included in the request

#### Scenario: Context window overflow

- GIVEN the message count exceeds the context window limit
- WHEN messages are appended
- THEN the oldest messages MUST be evicted while preserving recent ones

### Requirement: Streaming Responses

The system MUST stream LLM responses token-by-token for real-time UX.

#### Scenario: Tokens delivered as produced

- GIVEN a question is received
- WHEN the LLM generates a response
- THEN tokens MUST be yielded as `StreamingChunk` items with `delta` and `done` fields

#### Scenario: Input blocked during streaming

- GIVEN input fails guardrails (non-Spanish or harmful)
- WHEN `converseStream` is called
- THEN a single chunk with blocked reason and `done: true` MUST be yielded

### Requirement: Spanish Business Conversation

The system MUST provide a Spanish conversational interface for questions, case review, and daily business reasoning. Responses are LLM-generated via DeepSeek, not template-matched.

#### Scenario: Seller asks for business advice

- GIVEN the seller asks in Spanish about a MercadoLibre business case
- WHEN the agent answers
- THEN it MUST respond in Spanish with a clear recommendation and rationale

#### Scenario: Missing operational context

- GIVEN the seller asks a question without enough context
- WHEN the agent cannot produce a reliable answer
- THEN it MUST ask for the missing context instead of guessing

#### Scenario: Streaming delivery

- GIVEN the seller asks for advice
- WHEN the LLM generates a response
- THEN tokens MUST be streamed token-by-token

### Requirement: Seller Judgment Learning

The system MUST learn seller preferences for margin, profit, customer treatment, claims, reputation risk, and daily priorities from corrections and real cases.

#### Scenario: Seller corrects agent judgment

- GIVEN the seller corrects a recommendation
- WHEN the correction is accepted
- THEN the agent MUST adapt future recommendations to that preference

#### Scenario: Preference conflicts with safety

- GIVEN a learned preference would increase reputation or compliance risk
- WHEN the agent applies the preference
- THEN it MUST explain the risk and require safer confirmation

### Requirement: Business Operating Model Learning

The system MUST learn the seller's business model, operating style, decision criteria, workflows, and repeated tasks before recommending structural automation or specialized agents.

#### Scenario: Seller repeats a workflow

- GIVEN the seller repeatedly performs or asks about the same workflow
- WHEN the agent updates business understanding
- THEN it MUST retain the workflow, decision criteria, and observed outcome as learning evidence

#### Scenario: Automation is premature

- GIVEN the agent lacks enough evidence about the workflow or decision criteria
- WHEN the seller asks for automation or delegation
- THEN it MUST ask for more context instead of proposing specialized agents

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
