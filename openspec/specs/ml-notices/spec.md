# ml-notices Specification

## Purpose

Read seller communications notices with pagination, tags, and category metadata. Surfaced as a safe-read project-owned MCP tool, backed by `GET /communications/notices`. Distinguishes seller vs integrator token contexts. No mutation.

## Requirements

### Requirement: Notices Read with Pagination

The system MUST return typed paginated notices via `MlcReadSnapshot<MlcNoticesSummary>`. Each notice SHALL expose actions, tags, `highlighted` flag, `from_date`, and `dismiss_key`. The snapshot MUST carry `source`, `freshness`, `confidence`, and `noMutationExecuted: true`.

#### Scenario: Seller token returns seller-scoped notices

- GIVEN a valid seller OAuth token
- WHEN `ml-notices` is called with `{ limit, offset }`
- THEN it MUST return paginated seller-scoped notices with `dismiss_key` populated

#### Scenario: Integrator token returns integrator-scoped notices

- GIVEN a valid integrator OAuth token
- WHEN `ml-notices` is called
- THEN it MUST return integrator-scoped notices with `title` and `highlighted` fields

#### Scenario: Pagination returns bounded results

- GIVEN the seller has 50 notices
- WHEN `ml-notices` is called with `{ limit: 10, offset: 0 }`
- THEN it MUST return exactly 10 notices with pagination metadata indicating total count and next offset

#### Scenario: No notices for seller

- GIVEN a valid OAuth token with zero active notices
- WHEN `ml-notices` is called
- THEN it MUST return an empty result with full pagination metadata and reduced confidence

### Requirement: Runtime Surface Classification

The capability MUST be classified as `safe-read` with runtime surface `read-tool`. The MCP tool MUST NOT create approval requests and SHALL NOT execute mutations.

| Field | Value |
|-------|-------|
| Classification | `safe-read` |
| Endpoint | `GET /communications/notices` |
| Site support | MLC (Chile) |
| Runtime surface | `read-tool` |
| Confidence | Medium |
