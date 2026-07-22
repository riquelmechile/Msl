# creative-video-task-store Specification

## Purpose

Durable video task persistence for restart-safe async MiniMax video polling. Provider task state tracked separately from job state. `VideoTaskStore` port supports create, resume, timeout, and TTL cleanup with seller isolation.

## Requirements

### Requirement: Durable Task Persistence with Recovery Identity

`VideoTaskStore` SHALL persist every video task with: `taskId` (primary), stable `jobId`, `sellerId`, bus message/correlation identity, `provider` (MiniMax video only), `model`, duration/profile, `state` (`polling | completed | failed`), `providerTaskId`, `createdAt`, `updatedAt`, `deadline`, reference metadata, output metadata. State SHALL survive daemon restart.

#### Scenario: Task created

- GIVEN video job with `jobId=J42`, `sellerId=S1`
- WHEN persisted
- THEN all identity fields written; `state=polling`

#### Scenario: Survives restart

- GIVEN task `polling`; daemon restarts
- WHEN store reloaded
- THEN full identity restored; polling resumes

### Requirement: Seller-Isolated Resume with Budget Check

After restart, all `polling` tasks SHALL reload and resume polling scoped to original `sellerId`. Budget SHALL be checked via `DurableCostLedger.canAfford()` before every resumed provider call; polling itself is NOT a new charge or generation attempt. SHALL NOT reference other sellers' assets. `completed` or `failed` tasks SHALL NOT re-poll.

#### Scenario: Resume polling

- GIVEN 3 tasks `polling`; restart
- WHEN store queried
- THEN all 3 reloaded; polling resumes; budget checked per resumed call

#### Scenario: Completed skipped

- GIVEN task `completed`
- WHEN store queried
- THEN skipped

#### Scenario: Cross-seller isolation

- GIVEN task `sellerId=S1` resumed
- WHEN provider call prepared
- THEN S1 context only; no S2 assets accessed

### Requirement: Timeout with Partial-Output Invariant

Tasks exceeding deadline (`MSL_CREATIVE_VIDEO_TASK_TIMEOUT_MS`, default 300s) SHALL apply partial-output invariant before terminal resolution. ≥1 valid video asset → retain assets; transition job to `needs-human-review` (provider task may be `completed` with `partial=true`); resolve bus message; CEO alerted with partial outcome. Zero valid assets → job `failed`; task `failed`; CEO alerted with `taskId`, `jobId`, `sellerId`, `providerTaskId`; `bus.fail()` exactly once. Provider task state SHALL never be `needs-human-review` — that is a job-level state only.

#### Scenario: Timeout with valid asset

- GIVEN polling exceeds 300s; ≥1 valid video asset produced
- WHEN timeout triggers
- THEN job → `needs-human-review`; assets retained; provider task `completed` with `partial=true`; CEO alerted

#### Scenario: Timeout zero assets

- GIVEN polling exceeds 300s; zero valid assets
- WHEN timeout triggers
- THEN job `failed`; task `failed`; CEO alerted; `bus.fail()` once

#### Scenario: Alert content on failure

- GIVEN task → `failed` on timeout
- WHEN alert emitted
- THEN includes `taskId`, `jobId`, `sellerId`, `providerTaskId`

### Requirement: Terminal Bus Accuracy

Terminal state (completed or failed): daemon SHALL call `bus.resolve()` or `bus.fail()` exactly once per task, keyed by correlation identity. No orphaned bus messages.

#### Scenario: Completed

- GIVEN polling returns `success`
- WHEN finalized
- THEN `bus.resolve()` called; task `completed`

#### Scenario: Failed

- GIVEN timeout or provider error
- WHEN finalized
- THEN `bus.fail()` with reason; task `failed`

#### Scenario: Crash recovery

- GIVEN daemon restarts after crash
- WHEN store checked
- THEN terminal tasks verified; orphans resolved

### Requirement: TTL Cleanup

TTL sweep SHALL remove ONLY terminal tasks (`completed` or `failed`) where `updatedAt` exceeds 24h. SHALL NOT remove active `polling` tasks regardless of age. Seller-scoped.

#### Scenario: Terminal cleanup

- GIVEN task `failed`; `updatedAt` >24h ago
- WHEN TTL sweep runs
- THEN row removed

#### Scenario: Active polling preserved

- GIVEN task `polling`; `createdAt` >24h ago
- WHEN TTL sweep runs
- THEN row preserved; polling continues
