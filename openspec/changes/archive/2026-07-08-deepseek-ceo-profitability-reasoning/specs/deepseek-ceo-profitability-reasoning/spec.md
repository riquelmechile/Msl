# deepseek-ceo-profitability-reasoning Specification

## Purpose

Standalone DeepSeek reasoning wrapper that enriches profitability findings with Cortex seller/campaign/item context, calls DeepSeek Flash with structured JSON output, validates responses against known `proposalType` values, records cost ledger entries, and falls back to the deterministic `SIGNAL_TO_ACTION` map on failure.

## Requirements

### Requirement: Batched DeepSeek Reasoning

The system SHALL receive all profitability findings from a handler cycle as a single batch, enrich them with Cortex context, build a prompt, and call DeepSeek with `response_format: { type: "json_object" }` once per cycle. The LLM SHALL return a structured recommendation per finding.

#### Scenario: Findings enriched and reasoned in a single cycle

- GIVEN a handler cycle produces profitability findings
- WHEN `CeoDeepSeekClient.reason()` is called with all findings
- THEN a single DeepSeek API call SHALL be made
- AND each finding SHALL receive a structured recommendation

#### Scenario: Cold Cortex passes no-history sentinel

- GIVEN Cortex has no historical data for the seller/campaign/item
- WHEN findings are enriched
- THEN the prompt SHALL include "no historical data available"
- AND the LLM SHALL reason on current data alone

### Requirement: Cortex Context Enrichment

The system SHALL query Cortex via `queryByMetadata()` for historical profitability data, cost snapshots, and past outcomes for the target seller/campaign/item before building the LLM prompt.

#### Scenario: Cortex returns historical context

- GIVEN Cortex has profitability records for seller S, campaign C
- WHEN the prompt is built
- THEN historical data SHALL be injected into the prompt

### Requirement: Structured Output Validation

The system SHALL validate every LLM response against known `proposalType` enum values. Invalid or missing `proposalType` SHALL trigger fallback to `SIGNAL_TO_ACTION`.

#### Scenario: Valid proposalType accepted

- GIVEN the LLM returns a JSON response with a known `proposalType`
- WHEN the response is validated
- THEN the recommendation SHALL be returned to the handler

#### Scenario: Invalid proposalType triggers fallback

- GIVEN the LLM returns a `proposalType` not in the known enum
- WHEN the response is validated
- THEN the system SHALL fall back to `SIGNAL_TO_ACTION`

### Requirement: Deterministic Fallback

The system SHALL fall back to the static `SIGNAL_TO_ACTION` map on any DeepSeek error, timeout exceeding 5 seconds, or invalid response. Fallback SHALL be immediate with no retry.

#### Scenario: API unreachable

- GIVEN DeepSeek API is unreachable
- WHEN `reason()` is called
- THEN `SIGNAL_TO_ACTION` SHALL produce the recommendation immediately

#### Scenario: Timeout exceeded

- GIVEN DeepSeek call exceeds 5-second timeout
- WHEN the request is aborted
- THEN `SIGNAL_TO_ACTION` SHALL produce the recommendation immediately

### Requirement: Cost Ledger Integration

The system SHALL call `insertEntry()` on the workforce cost ledger for every DeepSeek API call, recording `department_id: product-ads-ceo-profitability`, token counts, and cost estimates.

#### Scenario: Successful call recorded in ledger

- GIVEN a DeepSeek call completes
- WHEN the response is received
- THEN a ledger entry SHALL be created with `department_id: product-ads-ceo-profitability`

### Requirement: Flash Model with Prefix Caching

The system SHALL use Flash model via `DEEPSEEK_API_KEY` and apply the existing `cacheBlocks` pattern for immutable prompt prefixes. No model tier split SHALL be implemented.

#### Scenario: Cacheable prefix reused across cycles

- GIVEN a stable policy prefix with `cacheBlocks` configuration
- WHEN consecutive handler cycles run
- THEN cache hits SHALL reduce token cost
