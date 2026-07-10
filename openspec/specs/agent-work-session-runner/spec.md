# agent-work-session-runner Specification

## Purpose

Orchestrator for the full agent work cycle: signals → wake → session → prompt → DeepSeek → parse → record → propose → learn → cortex → complete. Dependency injection for testability; 0 HTTP in tests.

## Requirements

### Requirement: Full Session Cycle

Runner MUST execute: detect signals → `shouldWake` → `startSession` → `buildPrompt` → DeepSeek call → parse output → record observations/proposals/lessons → CEO inbox → Cortex → `completeSession`. All per seller.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Normal cycle | Signals detected, wake policy says yes | Runner cycles | Session starts, DeepSeek called, observations/proposals recorded, session completed |
| Agent doesn't wake | `shouldWakeUp()` returns false | Runner evaluates | No DeepSeek call, session skipped |
| DeepSeek fails | Transport throws network error | DeepSeek called | Session status `failed`, `errorJson` stored, process ends cleanly |
| Invalid output | DeepSeek returns non-JSON or schema mismatch | Output parsed | Saved as `errorJson`, no proposals extracted, session completes |
| Writes only via gates | Output contains proposal | Runner processes | Proposal goes through approval pipeline, noMutationExecuted guarantee maintained |

### Requirement: Dependency Injection

Runner MUST accept: `workSessionStore`, `accountAssetStore`, `cortex`, `ceoInboxStore`, `messageBus`, `deepSeekTransport`, `clock`, `logger`. Tests SHALL use `FakeTransport` for 0 real HTTP.

#### Scenario: Fake transport in tests

- GIVEN `FakeTransport` with canned responses
- WHEN runner cycles
- THEN 0 real HTTP calls, session completes with fake output

### Requirement: Seller-Gated Execution

Runner MUST process one seller per invocation. Parallel loops for multi-seller handled externally. No Plasticov/Maustian mixing within single runner invocation.

### Requirement: Lesson Recording

After parse, runner MUST extract lessons from DeepSeek output and record via `addLesson()`. Lessons with `transferable: true` become available for cross-agent reuse within same seller.

#### Scenario: Lesson extracted and recorded

- GIVEN DeepSeek output includes `lessons: [{lesson: "margin below 30% triggers restock", transferable: true}]`
- WHEN runner processes output
- THEN lesson stored with agentId, sellerId, sessionId, transferable flag

### Requirement: Cortex Recording

After completion, runner MUST call Cortex bridge to record session, observations, and lessons as graph nodes/edges scoped to `sellerId`.

### Requirement: CEO Inbox Integration

Proposals from DeepSeek output MUST be enqueued to CEO inbox via message bus. Each proposal SHALL carry `sessionId`, `sellerId`, and `noMutationExecuted: true`.
