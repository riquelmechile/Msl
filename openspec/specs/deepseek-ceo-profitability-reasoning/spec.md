# deepseek-ceo-profitability-reasoning Specification

## Purpose

Standalone DeepSeek reasoning wrapper that enriches profitability findings with Cortex seller/campaign/item context, calls DeepSeek Flash with structured JSON output, validates responses against known `proposalType` values, records cost ledger entries, and falls back to the deterministic `SIGNAL_TO_ACTION` map on failure.

## Requirements

### Requirement: Batched DeepSeek Reasoning

The system SHALL receive all profitability findings from a handler cycle as a single batch, enrich them with Cortex context, and call DeepSeek via `DeepSeekReasoningGateway.reason()` once per cycle.

(Previously: Called DeepSeek directly via `this.openai.chat.completions.create` with inline AbortController)

#### Scenario: Findings reasoned through gateway in a single cycle

- GIVEN a handler cycle produces profitability findings
- WHEN `CeoDeepSeekClient.reason()` is called
- THEN one gateway `reason()` call SHALL be made with `level: recommendation`
- AND each finding SHALL receive a structured recommendation

#### Scenario: Cold Cortex passes no-history sentinel

- GIVEN Cortex has no historical data for the seller/campaign/item
- WHEN findings are enriched
- THEN the prompt SHALL include "no historical data available"

### Requirement: Cortex Context Enrichment

The system SHALL query Cortex via `queryByMetadata()` before building the ReasoningCall. Behavior unchanged — only transport layer changes.

(Previously: Enrichment was identical; only where the prompt was sent changed)

#### Scenario: Cortex returns historical context

- GIVEN Cortex has profitability records for seller S, campaign C
- WHEN the prompt is built
- THEN historical data SHALL be injected into the prompt

### Requirement: Structured Output Validation

The system SHALL validate LLM responses against known `proposalType` enum values. The gateway SHALL perform JSON schema validation; `CeoDeepSeekClient` SHALL retain its `proposalType` enum check. Invalid output SHALL trigger `SIGNAL_TO_ACTION` fallback.

(Previously: Single validation pass in `reason()` with inline JSON.parse + enum check)

#### Scenario: Valid proposalType accepted

- GIVEN the gateway returns `status: "success"` with valid `proposalType`
- WHEN `CeoDeepSeekClient` validates the result
- THEN the recommendation SHALL be returned to the handler

#### Scenario: Invalid proposalType triggers fallback

- GIVEN the LLM returns a `proposalType` not in the known enum
- WHEN validation runs
- THEN `SIGNAL_TO_ACTION` SHALL be used immediately

### Requirement: Deterministic Fallback

The system SHALL fall back to `SIGNAL_TO_ACTION` on any gateway `status: "fallback"` result. Timeout now controlled by gateway per level (15s for recommendation).

(Previously: Client managed its own 5s AbortController timeout)

#### Scenario: Gateway returns fallback

- GIVEN the gateway returns `status: "fallback"` with empty recommendations
- WHEN `reason()` processes the result
- THEN `SIGNAL_TO_ACTION` SHALL produce the recommendation immediately

### Requirement: Cost Ledger Integration

Cost recording SHALL be delegated to the gateway. `CeoDeepSeekClient` SHALL NOT call `insertEntry()` directly.

(Previously: Client called `ledger.insertEntry()` with inline cost metadata extraction)

#### Scenario: Cost recorded by gateway

- GIVEN a DeepSeek call completes through the gateway
- WHEN the handler checks ledger entries
- THEN a ledger entry SHALL exist with `departmentId: product-ads-ceo-profitability`

### Requirement: Flash Model with Prefix Caching

The system SHALL use Flash model via `DEEPSEEK_API_KEY` and apply the existing `cacheBlocks` pattern for immutable prompt prefixes. No model tier split SHALL be implemented.

#### Scenario: Cacheable prefix reused across cycles

- GIVEN a stable policy prefix with `cacheBlocks` configuration
- WHEN consecutive handler cycles run
- THEN cache hits SHALL reduce token cost

### Requirement: Factory Returns Null When No API Key

`createCeoDeepSeekClient()` SHALL return `null` when `DEEPSEEK_API_KEY` is unset. Gateway creation SHALL be lazy — instantiated only when API key is available.

(Previously: Factory created `CeoDeepSeekClientImpl` directly or returned null)

### Requirement: Gateway Routing

`CeoDeepSeekClientImpl` SHALL construct a `ReasoningCall` from findings, Cortex data, and the stable `POLICY_BLOCK`, then delegate to `DeepSeekReasoningGateway.reason()`.

#### Scenario: Client constructs ReasoningCall from findings

- GIVEN `CeoDeepSeekClientImpl.reason()` receives findings and Cortex context
- WHEN it prepares the call
- THEN it SHALL build a `ReasoningCall` with `level: recommendation`, `stablePrefix` from `POLICY_BLOCK`, `cacheableContext` from Cortex data, and `volatileInput` from findings JSON

#### Scenario: Existing tests pass after refactor

- GIVEN the refactored `CeoDeepSeekClientImpl` is tested
- WHEN `npm test` runs in the agent package
- THEN all tests in `ceoDeepSeekClient.test.ts` SHALL pass unchanged
