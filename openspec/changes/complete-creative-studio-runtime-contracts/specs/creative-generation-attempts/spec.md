# creative-generation-attempts Specification

## Purpose

Durable provider generation attempt tracking with stable `generationAttemptId`, state machine, and crash-safety. Shared by video and image generation. Polling existing paid task is NOT a new attempt.

## Requirements

### Requirement: Stable Attempt Identity

Every generation attempt SHALL be assigned a stable `generationAttemptId` linked to: `sellerId`, `jobId`, bus message identity, `provider`, `model`, `estimatedCostUsd`, request hash, reference hashes. Idempotency key SHALL be derived from these fields.

#### Scenario: Attempt identity created

- GIVEN job J42 for seller S1; provider OpenAI; model gpt-image-2; estimated cost $0.015
- WHEN attempt prepared
- THEN `generationAttemptId` assigned; all identity fields written

#### Scenario: Same inputs produce distinct identity for different jobs

- GIVEN two different jobs with same provider/model/cost
- WHEN attempts prepared
- THEN distinct `generationAttemptId` values assigned

### Requirement: Attempt State Machine

States SHALL be: `prepared | submitted | completed | ambiguous | failed`. SHALL persist `prepared` state BEFORE any external provider POST. Transitions: `prepared → submitted` on successful POST dispatch; `submitted → completed` on confirmed success; `submitted → failed` on confirmed failure; `submitted → ambiguous` on crash after POST without durable response.

#### Scenario: Prepared before POST

- GIVEN attempt identity established
- WHEN dispatch begins
- THEN attempt persisted as `prepared`; then provider POST executes

#### Scenario: Successful completion

- GIVEN attempt `submitted`; provider returns success with valid output
- WHEN response processed
- THEN attempt → `completed`

#### Scenario: Confirmed failure

- GIVEN attempt `submitted`; provider returns confirmed error
- WHEN response processed
- THEN attempt → `failed` with reason

### Requirement: Crash Ambiguity and No Blind Retry

Crash after POST without durable provider response: attempt SHALL be marked `ambiguous`. SHALL NOT blindly retry when provider cannot prove idempotency or reconcile the prior request. `ambiguous` attempts SHALL surface for CEO review. Provider idempotency key SHALL be sent where officially supported (e.g., OpenAI).

#### Scenario: Crash after POST

- GIVEN POST sent; process crashes before response received
- WHEN system restarts
- THEN attempt state `ambiguous`; no blind retry

#### Scenario: Provider supports idempotency

- GIVEN provider officially documents idempotency key support
- WHEN POST sent
- THEN idempotency key included in request

#### Scenario: CEO reviews ambiguous

- GIVEN attempt `ambiguous`
- WHEN CEO reviews
- THEN manual reconciliation or retry decision; audited

#### Scenario: Confirmed success after restart (no ambiguity)

- GIVEN provider response received and persisted before crash
- WHEN system restarts
- THEN attempt `completed`; not `ambiguous`

### Requirement: Polling Is Not a New Attempt

Polling an existing video task for status SHALL NOT create a new generation attempt or trigger a budget charge. Only the initial POST submission creates an attempt in `prepared` state. Video submit and image generation SHALL share this safety model.

#### Scenario: Video poll does not create attempt

- GIVEN existing video task with `taskId=T1`; attempt already `submitted` or `completed`
- WHEN polling loop checks status
- THEN no new `generationAttemptId` created; no budget charge

#### Scenario: Initial video submission creates attempt

- GIVEN new video job; no existing task
- WHEN provider POST sent
- THEN one attempt created in `prepared` state before POST; billed once

#### Scenario: Image generation creates attempt

- GIVEN new image job
- WHEN provider POST sent
- THEN one attempt created in `prepared` state before POST; billed once
