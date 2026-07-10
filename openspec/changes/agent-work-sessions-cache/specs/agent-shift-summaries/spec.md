# agent-shift-summaries Specification

## Purpose

Morning brief and end-of-day summaries from DB queries. DeepSeek optional for semantic compression; DB-query-first architecture.

## Requirements

### Requirement: Morning Brief

`createMorningBrief(sellerId)` MUST query session store for overnight observations, pending proposals, and lessons. Output structured for morning-report agent consumption.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Overnight activity | 2 sessions overnight with 5 observations | `createMorningBrief("plasticov")` | Returns observations by kind, pending proposals, confidence recommendations |
| No overnight activity | No sessions since last EOD | Brief queried | Returns "no activity" with empty sections, no error |

### Requirement: End-of-Day Summary

`createEndOfDaySummary(sellerId)` MUST aggregate: what agents observed, proposed, pending, learned, and recommended for tomorrow. SHALL include `confidence` score and `noMutationExecuted` flag.

#### Scenario: Full day summary

- GIVEN 5 sessions across 3 agents for Plasticov today
- WHEN EOD summary created
- THEN includes per-agent breakdown, top observations, pending proposals, lessons, and next-day recommendations

### Requirement: Account Shift Summary

`summarizeAccountShift(sellerId)` MUST produce a seller-scoped summary suitable for Cortex injection. Uses DB queries only; no required LLM call.

#### Scenario: Seller-scoped aggregation

- GIVEN Plasticov has sessions, Maustian has sessions
- WHEN `summarizeAccountShift("plasticov")` called
- THEN only Plasticov data returned

### Requirement: Optional Semantic Compression

DeepSeek MAY be used to compress verbose observation text into concise summaries. If used, MUST be via injected `FakeTransport` in tests. Default path: DB-only, no LLM.

#### Scenario: Compression not available

- GIVEN no DeepSeek transport configured
- WHEN summary created
- THEN raw observation text used, no error

### Requirement: Integration with Morning-Report and EOD-Summary Agents

Output format MUST match existing `morningReportDaemon` and `eodSummaryDaemon` expectations. No breaking changes to those daemon handlers.
