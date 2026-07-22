# Delta for creative-studio-minimax

> **Archive note**: Update capability purpose to "MiniMax API provider for video generation." Image generation capability replaced by `creative-image-provider-contracts`. Image format compliance moved to provider-agnostic `creative-image-provider-contracts`.

## ADDED Requirements

### Requirement: MiniMax Video-Only Gate and Prompt Safety

MiniMax SHALL be video only. SHALL NOT receive product image jobs. SHALL NOT send `subject_reference type: "character"` for any request. `first_frame_image` SHALL be used for reference frames. Prompts SHALL use structured tiered format: identity/references first, then allowlisted hints. Raw seller title SHALL NOT reach provider. `prompt_optimizer` SHALL be `false`.

#### Scenario: Video job proceeds

- GIVEN kind `ml-clip-vertical` with valid reference frame
- WHEN provider dispatch evaluated
- THEN MiniMax called for video generation

#### Scenario: Image job blocked

- GIVEN kind `product-cover-i2i` routed to MiniMax
- WHEN provider validates
- THEN rejected; no API call; zero cost

#### Scenario: Character subject_reference blocked

- GIVEN any job with `subject_reference type: "character"`
- WHEN provider validates
- THEN rejected; no API call

#### Scenario: Prompt safety enforced

- GIVEN seller title and reference metadata
- WHEN prompt assembled
- THEN structured format: identity/references + hints; raw title excluded; `prompt_optimizer: false`

## REMOVED Requirements

### Requirement: Image Generation

(Reason: MiniMax image generation replaced by OpenAI/BRIA under `creative-image-provider-contracts`. MiniMax becomes video-only provider.)
(Migration: Product image requests route to `ImageProvider` port; MiniMax rejects image jobs with validation error.)

### Requirement: ML Format Compliance

(Reason: Image format rules (1200×1200, JPEG, RGB) restored as provider-agnostic under `creative-image-provider-contracts`. Compliance enforced by `ImageProvider` adapters regardless of provider.)
(Migration: ML format enforced by `ImageProvider` adapters for all image providers.)

## MODIFIED Requirements

### Requirement: ML Clips Video Format

Video for ML clips SHALL be 9:16 vertical orientation. Maximum duration: 10s at 768P, or 6s at 1080P. Deprecated `ml-clip-vertical-30s` kind SHALL be accepted with `deprecatedSinceVersion` and `removeAfterVersion` metadata, normalized to 10s/768P. Provider SHALL NEVER receive 30s request. After `removeAfterVersion` expiry: validation error; zero provider attempt. Deprecation evidence SHALL be logged on each accepted deprecated kind. Model: `MiniMax-Hailuo-2.3`. Output stored locally for manual CEO upload.
(Previously: 30s and 60s durations allowed at 1080P; no deprecation window.)

#### Scenario: ML clip 10s/768P

- GIVEN kind `ml-clip-vertical`
- WHEN video generated
- THEN 9:16, 10s, 768P

#### Scenario: ML clip 6s/1080P

- GIVEN 1080P resolution requested
- WHEN video generated
- THEN 9:16, max 6s duration, 1080P

#### Scenario: Deprecated 30s accepted in grace window

- GIVEN `ml-clip-vertical-30s`; current version within two release cycles of `deprecatedSinceVersion`
- WHEN request normalized
- THEN 10s/768P sent to provider; deprecation evidence logged; provider never receives 30s

#### Scenario: Deprecated 30s expired

- GIVEN `ml-clip-vertical-30s`; current version exceeds `removeAfterVersion`
- WHEN request validated
- THEN validation error; zero provider attempt; zero cost

#### Scenario: Duration exceeds max

- GIVEN non-deprecated kind requesting >10s
- WHEN request validated
- THEN rejected

### Requirement: Video Generation

SHALL call MiniMax `POST /v1/video_generation` for video jobs. SHALL send `first_frame_image` for reference. SHALL use structured tiered prompt. SHALL set `prompt_optimizer: false`. SHALL normalize duration per clip format rules. SHALL poll `GET /v1/query/video_generation?task_id={id}`. SHALL download via `GET /v1/files/retrieve?file_id={id}`. Polling SHALL use configurable interval (default 5s) with max 60 attempts (5 min timeout). Budget SHALL be checked before every resumed provider call; polling itself is NOT a paid call or new generation attempt.
(Previously: no prompt_optimizer control; no structured prompt; no duration normalization; no per-call budget check.)

#### Scenario: Video submitted

- GIVEN valid prompt, `first_frame_image`, normalized duration, budget ok
- WHEN provider call executes
- THEN returns `task_id`; status `processing`; `prompt_optimizer: false` on provider payload

#### Scenario: Video completes

- GIVEN task_id in polling loop
- WHEN status returns `success` with file_id
- THEN file downloaded and persisted locally

#### Scenario: Video fails

- GIVEN task_id in polling loop
- WHEN status returns `failed` or provider error
- THEN job marked failed with reason

#### Scenario: Poll exhausted with valid asset

- GIVEN 60 attempts without terminal status; ≥1 valid video asset produced
- WHEN poll loop exits
- THEN job → `needs-human-review`; assets retained; CEO alerted

#### Scenario: Poll exhausted zero assets

- GIVEN 60 attempts; zero valid assets
- WHEN poll loop exits
- THEN job → `failed`; timeout; CEO alerted

### Requirement: Creative Job Queue Persistence

`CreativeJobQueueSQLite` MUST provide a SQLite-backed persistent job queue. Jobs stored with `job_id`, `kind`, `channel`, `status`, `payload_json`, `result_json`, `created_at`, `updated_at`. Survives process restarts. On generation success, `completeJob(jobId, result)` SHALL set status to `needs-human-review` (NOT `completed`). CEO approval SHALL transition to `approved | rejected`. On terminal failure with zero valid assets, `failJob(jobId, error)` SHALL set status to `failed`.
(Previously: successful generation set status to `completed`; no `needs-human-review` state; no CEO approval gate.)

#### Scenario: Job enqueued

- GIVEN valid CreativeJobRequest
- WHEN enqueueJob(request)
- THEN row inserted with status="pending"

#### Scenario: Job claimed

- GIVEN pending job exists
- WHEN claimNextJob()
- THEN job status="processing"; returned to worker

#### Scenario: Job persists restart

- GIVEN job in queue; process restarts
- WHEN queue reinitialized
- THEN pending/processing jobs still present in SQLite

#### Scenario: Job succeeds → review

- GIVEN job processing succeeds with valid assets
- WHEN completeJob(jobId, result)
- THEN job status="needs-human-review"; result_json set

#### Scenario: Job failed

- GIVEN job processing fails with zero valid assets
- WHEN failJob(jobId, error)
- THEN job status="failed"; error persisted
