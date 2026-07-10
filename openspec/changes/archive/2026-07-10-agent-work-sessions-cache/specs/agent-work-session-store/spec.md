# agent-work-session-store Specification

## Purpose

SQLite persistence for agent work sessions, observations, proposals, lessons, and shift summaries. Follows existing store patterns: `CREATE TABLE IF NOT EXISTS`, `columnExists` idempotent migrations, defensive row parsing.

## Requirements

### Requirement: Five-Table Schema

Store MUST maintain 5 tables: `agent_work_sessions`, `agent_observations`, `agent_session_proposals`, `agent_session_lessons`, `agent_shift_summaries`. All SHALL include `seller_id TEXT NOT NULL`. Indexes on `seller_id`, `agent_id`, `lane_id`, `created_at`, `session_id`, `signals_hash`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Session roundtrip | Session with status `running` | `startSession()`, then `listRecentSessionsByAgent()` | Session present with all fields |
| Observation linked | Observation with `sessionId` | `addObservation()` called | Observation stored, queryable by session |
| Proposal link | Proposal enqueued via CEO bus | `addProposalLink()` called | Link stored with `proposalId` and `sessionId` |
| Lesson recorded | Lesson learned during session | `addLesson()` called | Lesson stored with `transferable` flag |
| Reopen across DB close | Session written to file DB, DB closed and reopened | `getSession(id)` called | Session data intact |

### Requirement: Seller Scoping

Every query method MUST filter by `seller_id`. A query for `sellerId = "plasticov"` SHALL NOT return Maustian data.

#### Scenario: Scoped queries

- GIVEN Plasticov has 3 sessions, Maustian has 2
- WHEN `listRecentSessionsByAgent(sellerId: "plasticov")` is called
- THEN only Plasticov's 3 sessions returned

### Requirement: Idempotent Migrations

Schema creation MUST use `CREATE TABLE IF NOT EXISTS`. Column additions MUST use `columnExists()` guard before `ALTER TABLE ADD COLUMN`. No destructive migrations.

#### Scenario: Schema re-creation

- GIVEN tables already exist
- WHEN store factory runs again
- THEN no error, no data loss

### Requirement: Defensive Row Parsing

Malformed rows from migrations MUST return `undefined` instead of crashing. `getSession()`, `listRecentSessionsByAgent()`, etc. SHALL silently skip unparseable rows.

### Requirement: Summarize Shift

`summarizeShift(sellerId, since)` MUST aggregate observations, proposals, and lessons for a time range into a structured summary without LLM call.

#### Scenario: Shift summary with observations

- GIVEN 3 observations and 2 proposals for Plasticov today
- WHEN `summarizeShift("plasticov", since)` is called
- THEN summary includes observation counts by kind, proposal count, lesson count
