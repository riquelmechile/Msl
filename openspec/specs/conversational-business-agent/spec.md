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
