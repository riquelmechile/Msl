# Delta for creative-studio-minimax

## ADDED Requirements

### Requirement: Exponential Backoff Retry Policy

The MiniMax client MUST implement `MinimaxRetryPolicy` with exponential backoff for transient failures (network errors, 429 rate limits, 5xx server errors). Retry MUST use a base delay of 1000ms with a multiplier of 2, capped at 3 retries. Non-retryable errors (401 auth, 400 bad request, content rejection) MUST fail immediately without retry. The policy SHALL respect `MINIMAX_REQUEST_TIMEOUT_MS` for each individual attempt.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Network timeout | POST to MiniMax times out (attempt 1) | Retry policy triggers | Retry after 1000ms delay; max 3 attempts total |
| Rate limited (429) | API returns 429 on attempt 1 | Retry policy triggers | Retry after 1000ms; if retries exhausted, job failed |
| Exponential backoff | Attempt 1 fails, attempt 2 fails | Retry policy computes delay | Delay doubles: 1000ms → 2000ms → 4000ms |
| Auth failure (401) | API returns 401 | Retry policy evaluates | No retry; immediate fail with auth-error status |
| Content rejection | API rejects content policy | Retry policy evaluates | No retry; immediate fail with content-rejected status |
| Max retries exhausted | 3 attempts all fail | Policy completes | Job status set to provider-error with attempt count |
| Timeout per attempt | MINIMAX_REQUEST_TIMEOUT_MS=30000 | Single attempt exceeds 30s | Attempt fails; retry if under max |

### Requirement: Creative Job Queue Persistence

`CreativeJobQueueSQLite` MUST provide a SQLite-backed persistent job queue for creative-studio work items. Jobs MUST be stored with `job_id`, `kind`, `channel`, `status`, `payload_json`, `result_json`, `created_at`, `updated_at`. The queue SHALL survive process restarts and SHALL be used by the creative-studio daemon instead of in-memory-only bus message reliance.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Job enqueued | valid CreativeJobRequest | enqueueJob(request) | Row inserted with status="pending" |
| Job claimed | Pending job exists | claimNextJob() | Job status="processing", returned to worker |
| Job persists restart | Job in queue, process restarts | Queue reinitialized | Pending/processing jobs still present in SQLite |
| Job completed | Job processing succeeds | completeJob(jobId, result) | Job status="completed", result_json set |
| Job failed | Job processing fails | failJob(jobId, error) | Job status="failed", error persisted |

## MODIFIED Requirements

### Requirement: Error Handling

The provider SHALL map MiniMax API errors to structured statuses. Auth failure (401) SHALL map to `auth-error`. Rate limit (429) SHALL map to `rate-limited` with exponential backoff retry via `MinimaxRetryPolicy`. Insufficient balance SHALL map to `insufficient-funds`. Content policy rejection SHALL map to `content-rejected`. Network/timeout errors SHALL retry with exponential backoff (base 1000ms, max 3 retries) before final `provider-error` status.
(Previously: Error handling mapped statuses but had NO retry logic — every failure was final.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Auth failure | API returns 401 | Provider calls MiniMax | Job status `auth-error`; logged; no retry |
| Rate limited | API returns 429 | Provider calls MiniMax | Job status `rate-limited`; retry after backoff (up to 3 attempts) |
| Insufficient balance | API returns balance error | Provider calls MiniMax | Job status `insufficient-funds`; alert CEO |
| Sensitive content | API rejects prompt as policy violation | Provider calls MiniMax | Job status `content-rejected`; prompt logged |
| Network error | Connection timeout | Provider calls MiniMax | Retry with backoff; `provider-error` only after 3 failed attempts |
