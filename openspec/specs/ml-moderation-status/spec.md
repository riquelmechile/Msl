# ml-moderation-status Specification

## Purpose

Read image moderation results for an item by reference ID. Surfaced as a safe-read project-owned MCP tool, backed by `GET /moderations/last_moderation/{id}`. No mutation — this spec describes read-only behavior only.

## Requirements

### Requirement: Moderation Status Read

The system MUST return typed moderation status for a given ML item ID via `MlcReadSnapshot<MlcModerationStatusSummary>`. The snapshot SHALL include `source: "ml-api"`, `freshness`, `confidence`, and `noMutationExecuted: true`.

#### Scenario: Successful moderation read

- GIVEN a valid MLC item ID with stored moderation results
- WHEN `ml-moderation-status` is called with that ID
- THEN it MUST return name, ID, date, wordings (REASON/REMEDY), and evidence (text_matched, section_name)
- AND the snapshot MUST carry freshness and confidence metadata

#### Scenario: Item has no moderations

- GIVEN a valid MLC item ID with zero moderation history
- WHEN `ml-moderation-status` is called
- THEN it MUST return an empty result with `blocked: false` and reduced confidence metadata

#### Scenario: OAuth token missing or expired

- GIVEN the seller OAuth token is missing or expired
- WHEN `ml-moderation-status` is called
- THEN it MUST return `ReconnectRequired` and SHALL NOT attempt the API call

#### Scenario: Upstream rate limited

- GIVEN the ML API returns HTTP 429
- WHEN `ml-moderation-status` is called
- THEN it MUST surface `rate-limited` in blocked metadata and SHALL NOT retry

### Requirement: Runtime Surface Classification

The capability MUST be classified as `safe-read` with runtime surface `read-tool`. The MCP tool MUST NOT create approval requests and SHALL NOT execute mutations.

| Field | Value |
|-------|-------|
| Classification | `safe-read` |
| Endpoint | `GET /moderations/last_moderation/{id}` |
| Site support | MLC (Chile) |
| Runtime surface | `read-tool` |
| Confidence | Medium |
