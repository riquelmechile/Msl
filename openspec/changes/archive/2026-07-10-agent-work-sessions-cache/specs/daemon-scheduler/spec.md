# Delta for daemon-scheduler

## ADDED Requirements

### Requirement: Session-Aware Dispatch (Opt-In)

The scheduler SHALL support optional `enableWorkSessions` and `workSessionRunner` config. When `enableWorkSessions=false`, current behavior unchanged. When `true`, daemon tick SHALL check session state before dispatch, using `signalsHash` deduplication to avoid duplicate sessions per `sellerId`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Sessions disabled | `enableWorkSessions=false` | Daemon tick fires | Current behavior: handler dispatched directly, no session check |
| Sessions enabled, new signals | `enableWorkSessions=true`, fresh signals | Tick fires | Runner invoked with session context per seller |
| Sessions enabled, same hash | `enableWorkSessions=true`, `signalsHash` same as last session | Tick fires | Session skipped, no handler dispatch |
| Seller ID preserved | Sessions enabled, multi-seller config | Tick fires | Each seller dispatched independently, no cross-contamination |

### Requirement: Session-Aware Daemon Hooks for 6 Lanes

Work session runner SHALL be applied initially to: `unanswered-questions`, `product-ads-profitability`, `creative-assets`, `operations-manager`, `morning-report`, `eod-summary`. Other lanes remain stateless.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Lane with session hook | `unanswered-questions` lane tick fires, sessions enabled | Dispatch | Runner starts session, builds prompt, calls DeepSeek |
| Lane without session hook | `cost-supplier` lane tick fires, sessions enabled | Dispatch | Runs as before, no session overhead |

### Requirement: Signals Hash Deduplication

Before dispatch with work sessions enabled, scheduler SHALL compute `hashAgentSignals(signals)` and compare with `getLastSessionForSignals()`. Matching hash + recent run → dispatch skipped.

## MODIFIED Requirements

### Requirement: Extended Handler Map

`daemonHandlerMap` MUST include: `morning-report`→morningReportDaemon, `eod-summary`→eodSummaryDaemon, `owned-ecommerce`→ownedEcommerceDaemon, `unanswered-questions`→unansweredQuestionsDaemon.
(Previously: documented as separate requirement; here consolidated.)

### Requirement: Agent-to-Daemon Handler Map

Handler map SHALL cover 13 lanes. When `enableWorkSessions=true`, the first 6 session-enabled lanes SHALL be dispatched through `workSessionRunner` instead of directly.
(Previously: all lanes dispatched directly to daemon handler.)

## REMOVED Requirements

_None._
