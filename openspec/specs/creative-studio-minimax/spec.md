# creative-studio-minimax Specification

## Purpose

MiniMax API provider for image and video generation within the Creative Studio Agent. Handles synchronous image calls, asynchronous video polling, ML format compliance, rate limiting, and error mapping.

## Requirements

### Requirement: Image Generation

The provider SHALL call MiniMax `POST /v1/image_generation` with model `image-01`, a prompt (max 1500 chars), and `subject_reference` array for image-to-image tasks. Response format SHALL be `url`. Auth SHALL use `MINIMAX_API_KEY` header.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Text-to-image | Prompt provided, no subject_reference | Provider calls image_generation | Images returned via URLs |
| Image-to-image | Reference image URL in subject_reference | Provider calls image_generation | Generated image preserves subject characteristics |
| Empty prompt | Prompt is empty or over 1500 chars | Provider validates | Error before API call |
| API key missing | `MINIMAX_API_KEY` unset | Provider initializes | Returns empty findings; no API call |

### Requirement: ML Format Compliance

Generated images for MercadoLibre channel SHALL be produced at 1200×1200 px (`aspect_ratio: "1:1"`, `width: 1200, height: 1200`), JPEG format, RGB colorspace. The provider SHALL request `response_format: "url"` for downstream download and ML pre-diagnosis.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| ML product image | Channel `mercadolibre`, kind `product-cover-i2i` | Image generated | 1200×1200, JPEG, RGB, via URL |
| Non-ML channel | Channel `storefront` | Image generated | Resolution may vary by channel constraint |
| Resize needed | Generated at 1024×1024 (aspect_ratio only) | Post-processing | Resized to target dimensions per channel |

### Requirement: Video Generation

The provider SHALL call MiniMax `POST /v1/video_generation` for video jobs, poll `GET /v1/query/video_generation?task_id={id}` for async status, and download via `GET /v1/files/retrieve?file_id={id}`. Polling SHALL use configurable interval (default 5s) with max 60 attempts (5 min timeout).

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Video submitted | Valid prompt and reference frame | Provider calls video_generation | Returns `task_id`, status `processing` |
| Video completes | task_id in polling | Status returns `success` with file_id | File downloaded and persisted locally |
| Video fails | task_id in polling | Status returns `failed` or timeout | Job marked failed with reason |
| Poll exhausted | 60 attempts without success | Poll loop exits | Job failed with timeout reason |

### Requirement: ML Clips Video Format

Video generated for `ml-clip-vertical` kind SHALL be produced in 9:16 vertical orientation, max 60s duration. Until ML exposes a Clips upload API, output SHALL be stored locally for manual CEO upload. Model SHALL be `MiniMax-Hailuo-2.3` with resolution 1080P.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| ML clip 30s | Kind `ml-clip-vertical-30s` | Video generated | 9:16, 30s, 1080P, stored locally |
| ML clip 60s | Kind with 60s duration | Video generated | 9:16, 60s, stored locally — no upload |
| Duration exceeds max | Requested duration > 60s | Provider validates | Rejected — ML Clips max is 60s |

### Requirement: Rate Limiting

The provider SHALL limit concurrent MiniMax calls to `MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS` (default 3). Additional jobs SHALL queue internally. Minimum cooldown between calls SHALL be `MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS` (default 2000ms).

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Within limit | 2 concurrent jobs, max 3 | New job arrives | Job dispatched immediately |
| At limit | 3 concurrent jobs, max 3 | New job arrives | Job queued until slot opens |
| Cooldown enforced | Last call < 2000ms ago | Next job ready | Next call delayed until cooldown expires |

### Requirement: Error Handling

The provider SHALL map MiniMax API errors to structured statuses. Auth failure (401) SHALL map to `auth-error`. Rate limit (429) SHALL map to `rate-limited` with retry. Insufficient balance SHALL map to `insufficient-funds`. Content policy rejection SHALL map to `content-rejected`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Auth failure | API returns 401 | Provider calls MiniMax | Job status `auth-error`; logged; no retry |
| Rate limited | API returns 429 | Provider calls MiniMax | Job status `rate-limited`; retry after backoff |
| Insufficient balance | API returns balance error | Provider calls MiniMax | Job status `insufficient-funds`; alert CEO |
| Sensitive content | API rejects prompt as policy violation | Provider calls MiniMax | Job status `content-rejected`; prompt logged |
| Network error | Connection timeout | Provider calls MiniMax | Job status `provider-error`; retry up to 3 times |
