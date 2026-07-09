# Delta for specialist-daemons

## ADDED Requirements

### Requirement: ownedEcommerceDaemon

`ownedEcommerceDaemon` MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. It SHALL read owned ecommerce evidence (storefront projections, catalog readiness, SEO/GEO positioning) via `OperationalReadModelReader`, detect actionable signals, and enqueue CEO proposals. It SHALL set `noMutationExecuted: true`. It SHALL be a proposal-only daemon under CEO orchestration.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Storefront candidate detected | Catalog items meet owned-ecommerce criteria | Daemon investigates | CEO proposal enqueued with ranked storefront recommendations |
| No candidates | No catalog items qualify | Daemon investigates | Empty findings, proposalEnqueued: false |
| Proposal includes evidence | Storefront recommendation generated | Proposal enqueued | Recommendation includes evidence IDs, risks, and approval needs |
| No direct user interaction | Daemon has findings | investigate() returns | Proposal routed to CEO lane only; no Telegram/user message |
| Error during evidence read | Read model fails | investigate() throws | Error propagated to scheduler for message fail |

### Requirement: unansweredQuestionsDaemon

`unansweredQuestionsDaemon` MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. It SHALL scan buyer questions via `OperationalReadModelReader`, detect questions older than a configurable deadline without seller response, and enqueue CEO proposals. It SHALL set `noMutationExecuted: true`. It SHALL NOT answer questions directly.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Unanswered question older than deadline | Question age > 24h, no response | Daemon investigates | CEO proposal with question text and recommended response |
| All questions answered | All questions have seller responses | Daemon investigates | Empty findings, proposalEnqueued: false |
| Multiple unanswered | 3 questions overdue | Daemon investigates | Single CEO proposal with all 3 questions aggregated |
| Deadline is configurable | `MSL_UNANSWERED_QUESTIONS_DEADLINE_HOURS` set to 48 | Question age is 30h | Not yet flagged (below threshold) |
| No questions data | Read model has no question snapshots | Daemon investigates | Empty findings, no error |

## MODIFIED Requirements

### Requirement: Shared Daemon Contract

Every daemon MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. `DaemonResult` MUST have `{ findings: DaemonFinding[]; proposalEnqueued: boolean }`. Each finding MUST include `{ kind: string; severity: "info"|"warning"|"critical"; summary: string; evidenceIds: string[] }`. Daemons SHOULD use `searchSnapshots()` instead of `listSnapshots()` + manual filtering. The daemon registry SHALL include `morningReportDaemon`, `eodSummaryDaemon`, `ownedEcommerceDaemon`, and `unansweredQuestionsDaemon` following this contract.
(Previously: Shared contract existed but only 9 daemons conformed; morning-report, eod-summary, owned-ecommerce, and unanswered-questions daemons did not exist or were not registered.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Findings returned | Daemon detects signals | investigate() completes | DaemonResult with findings array |
| No findings | No signals detected | investigate() completes | Empty findings, proposalEnqueued: false |
| Error during investigation | Evidence read fails | investigate() throws | Error propagated to scheduler for message fail |
| All 13 daemons conform | Each daemon in handler map | Contract checked | Every daemon exports investigate() → Promise<DaemonResult> |
