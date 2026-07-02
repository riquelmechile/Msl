# Delta for Conversational Business Agent

## ADDED Requirements

### Requirement: Block B Operational Data Source

The system MUST populate Block B daily aggregates from the operational DB via `OperationalDailyDataSource` implementing `DailyDataSource`. Hardcoded placeholders MUST NOT be used when an operational reader is configured.

#### Scenario: Category stats from operational DB

- GIVEN operational snapshots exist for "electrónica"
- WHEN `getCategoryStats()` is called
- THEN it MUST return per-category stats from operational DB snapshots

#### Scenario: Reader not configured

- GIVEN no operational reader is injected
- WHEN daily aggregates are assembled
- THEN the system MUST fall back to the existing default data source

### Requirement: Per-Lane Operational Evidence in Block C

The system MUST inject per-lane operational evidence into Block C alongside Cortex context during `agentLoop.buildMessages()`. Evidence SHALL be excluded from the cacheable prefix (Blocks A+B).

#### Scenario: Evidence injected for cost lane

- GIVEN the conversation is in the cost lane
- WHEN `buildMessages()` assembles prompt blocks
- THEN Block C MUST include both Cortex context and cost-lane operational evidence with IDs and timestamps

#### Scenario: No evidence available

- GIVEN the operational DB returns no evidence for the current lane
- WHEN `buildMessages()` assembles Block C
- THEN Cortex context MUST be included without operational evidence and no error raised

### Requirement: Operational Freshness Metadata

The system MUST include `captured_at` timestamps in all operational summaries injected into conversation context so the LLM MAY reason about data staleness.

#### Scenario: Timestamp present in summary

- GIVEN a snapshot captured at 2026-07-02T10:00:00Z
- WHEN formatted for prompt injection
- THEN output MUST include the `captured_at` timestamp

#### Scenario: Staleness surfaced

- GIVEN a snapshot older than 24 hours
- WHEN formatted
- THEN output MUST include age information interpretable by the LLM
