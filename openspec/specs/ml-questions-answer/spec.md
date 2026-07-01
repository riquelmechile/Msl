# ml-questions-answer Specification

## Purpose

Prepare an answer to a buyer question via `POST /answers`. This is a prepare-only capability — the typed client method prepares the payload; execution through the approval pipeline is deferred to a future slice. No direct MCP execution.

## Requirements

### Requirement: Question Answer Preparation

The system MUST expose a typed client method that prepares an `MlcPreparedAction` for `POST /answers`. The method SHALL accept `{ question_id, text }` and return a prepared payload with `requiresApproval: true` and `noMutationExecuted: true`. The method MUST NOT execute the POST directly.

#### Scenario: Valid answer is prepared

- GIVEN a valid MLC question ID and answer text
- WHEN `answerQuestion` is called with `{ question_id, text }`
- THEN it MUST return a prepared action with `status: "pending"`, `requiresApproval: true`, and redacted payload summary

#### Scenario: Invalid or missing question ID

- GIVEN a question ID that is malformed, missing, or references a non-existent question
- WHEN `answerQuestion` is called
- THEN it MUST return a controlled blocked response with reason `invalid-question-id` and SHALL NOT prepare the action

#### Scenario: OAuth token missing or insufficient scope

- GIVEN the seller token is expired or lacks `questions` write scope
- WHEN `answerQuestion` is called
- THEN it MUST return `ReconnectRequired` or `insufficient-scope` and SHALL NOT prepare the action

### Requirement: Runtime Surface Classification

The capability MUST be classified as `prepare-only` with runtime surface `prepared-action`. The MCP tool surface MUST NOT expose direct `POST /answers` execution. Execution SHALL be deferred to a future approved slice via the prepare → approve → execute → audit pipeline.

| Field | Value |
|-------|-------|
| Classification | `prepare-only` |
| Endpoint | `POST /answers` |
| Site support | MLC (Chile) |
| Runtime surface | `prepared-action` |
| Confidence | Low |
