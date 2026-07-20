# Delta for creative-studio-minimax

## ADDED Requirements

### Requirement: Attempt Context Propagation

Paid calls SHALL require `GenerationAttemptContext` with attempt, reservation, and idempotency IDs in responses/evidence. Provider MUST NOT own, select, create, close, or settle attempts/reservations. Selection unchanged.

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Context propagated | Context A/R | MiniMax called | Response/evidence reference A/R |
| Non-owner | Context A | Generation runs | Provider uses A; creates/selects nothing |

## MODIFIED Requirements

### Requirement: Image Generation

Provider SHALL POST `/v1/image_generation` with `image-01`, prompt ≤1500 characters, optional `subject_reference`, URL format, and `MINIMAX_API_KEY`. Paid calls require context evidence; provider MUST NOT create reservations.
(Previously: No attempt context or tracking.)

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Text-to-image | Prompt and context A | API called | URL images reference A |
| Image-to-image | Subject URL | API called | Subject characteristics preserved |
| Invalid prompt | Empty or >1500 characters | Validated | Error before API call |
| Missing key | Key unset | Initialized | Empty findings; no API call |

### Requirement: Video Generation

Provider SHALL POST video generation, poll status, and download files. Polling defaults to configurable 5s, bounded to 60 attempts/five minutes. Polls reuse the attempt without new reservation/charge. Initiation requires context; evidence includes attempt/task IDs. Downloads MUST persist locally.
(Previously: Poll cycles lacked attempt-context reuse.)

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Submitted | Valid prompt/frame/context A | POST succeeds | Task ID returned; evidence references A |
| Poll reuse | Attempt A/task T/reservation R | T polled | No new reservation; result links A |
| Completed | T returns success/file F | Retrieved | File persisted locally; evidence A/T/F |
| Provider failure | T returns failed | Handled | Job failed with reason |
| Poll exhausted | 60 polls/five minutes | Loop exits | Job failed with timeout reason |

### Requirement: Exponential Backoff Retry Policy

`MinimaxRetryPolicy` MUST retry only definitely pre-send failures or 429 proven pre-charge/no-submission. Delay is 1000ms ×2, capped at 3 retries; calls use `MINIMAX_REQUEST_TIMEOUT_MS`. 401, 400, content rejection, unproven 5xx, and possibly-sent network/timeout outcomes MUST NOT retry; the latter become same-attempt `ambiguous`.
(Previously: Network retries lacked pre/post-send distinction.)

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Pre-send error | Refused before body | Policy runs | Retries with bounded backoff |
| Rate limited | 429 plus no-submission proof | Policy runs | `rate-limited`; 1s/2s/4s retry |
| Backoff | Two eligible failures | Delay computed | Delay doubles |
| Auth | 401 | Evaluated | `auth-error`; no retry |
| Content | Policy rejection | Evaluated | `content-rejected`; no retry |
| Exhausted | 3 retries fail pre-send | Policy ends | `provider-error` with count |
| Per-call timeout | Timeout 30000ms; definitely unsent | 30s passes | Call fails; policy remains bounded |
| Possibly sent | Body may be sent; no response | Network/timeout fails | Same attempt `ambiguous`; no retry |

### Requirement: Error Handling

Provider SHALL map 401 to `auth-error`, balance to `insufficient-funds`, content rejection to `content-rejected`, and 429 to `rate-limited`. A 429 MAY retry only with no-submission proof. Pre-send failures MAY retry. Possibly-sent network/timeout outcomes SHALL become `ambiguous` without retry. Provider ownership remains prohibited.
(Previously: Network/timeout and 429 errors retried without charge-ambiguity boundaries.)

| Scenario | GIVEN | WHEN | THEN |
|---|---|---|---|
| Auth failure | 401 | Handled | `auth-error`; logged; no retry |
| Rate limited | 429 with no-charge proof | Handled | Bounded same-attempt retry |
| Balance | Balance error | Handled | `insufficient-funds`; CEO alerted |
| Sensitive content | Policy rejection | Handled | `content-rejected`; prompt logged; no retry |
| Network ambiguity | Dispatch may have sent bytes; no response | Network/timeout fails | Same attempt `ambiguous`; no retry |
