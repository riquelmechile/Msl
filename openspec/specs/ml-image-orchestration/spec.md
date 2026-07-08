# ml-image-orchestration Specification

## Purpose

Define the typed orchestration contract for the 4-step image flow: diagnose → upload → associate → check moderation. This is a `prepare-only` capability — the spec defines the sequenced flow but does NOT execute mutations. Implementation is deferred to a future execution slice with approval pipeline maturity.

## Requirements

### Requirement: Image Orchestration Flow Definition

The system MUST define a typed 4-step sequenced flow for image lifecycle management. Each step SHALL be individually typed with pre-conditions and expected outputs. The flow MUST require approval gates at each mutation step (upload, associate).

| Step | Method | Endpoint | Classification |
|------|--------|----------|----------------|
| 1. Diagnose | `diagnoseImage()` | `POST /moderations/pictures/diagnostic` | `safe-read` (read-only diagnostic) |
| 2. Upload | `uploadImage()` | `POST /pictures/items/upload` | `prepare-only` (mutates CDN) |
| 3. Associate | `updateItem()` | `PUT /items/{id}` | `prepare-only` (mutates listing) |
| 4. Check | `getModerationStatus()` | `GET /moderations/last_moderation/{id}` | `safe-read` |

#### Scenario: Full flow sequence defined

- GIVEN a picture URL, category ID, and item ID
- WHEN the flow spec is evaluated
- THEN it MUST define: (1) diagnose image against category, (2) upload if no blocking issues, (3) associate uploaded picture to listing pictures array, (4) read moderation status post-association
- AND each mutation step MUST declare `requiresApproval: true`

#### Scenario: Diagnostic step fails

- GIVEN the diagnostic returns `hasIssues: true`
- WHEN the flow is evaluated
- THEN the flow MUST surface detection details and SHALL NOT proceed to upload

#### Scenario: Upload step requires approval gate

- GIVEN diagnostic passes with no issues
- WHEN flow reaches the upload step
- THEN the flow MUST require an explicit approval before uploading to ML CDN

### Requirement: Prepare-Only Classification

The orchestration flow MUST be classified as `prepare-only`. It SHALL NOT execute mutations directly. The typed contract defines the flow structure for a future agent to chain the steps with approval gates.

#### Scenario: No mutation executed by spec

- GIVEN the image orchestration flow is defined
- WHEN the runtime evaluates the capability
- THEN `noMutationExecuted` MUST be `true`
- AND `requiresApproval` MUST be `true` per mutation step
- AND the runtime surface MUST be `prepared-action` only

### Requirement: Runtime Surface Classification

| Field | Value |
|-------|-------|
| Classification | `prepare-only` |
| Steps | 4 (diagnose → upload → associate → check) |
| Site support | MLC-to-confirm |
| Runtime surface | `prepared-action` |
| Confidence | Medium |

### Requirement: Associate Image to Item Client Method

The system MUST expose `associateImageToItem(sellerId, input)` on `MlcApiClient` that reads the current item's pictures array and returns an associative summary. This is a safe-read operation that prepares the association data without executing the PUT.

#### Scenario: Item has existing pictures

- GIVEN a valid MLC item with existing pictures
- WHEN `associateImageToItem(sellerId, { itemId, pictureId })` is called
- THEN the summary MUST return the itemId, pictureId, and current status
- AND `noMutationExecuted` MUST be `true`

### Requirement: Image Orchestration Prepared Action

The system MUST define a prepared action `prepare_image_orchestration` that encodes the 4-step flow (diagnose → upload → associate → check) as a typed summary. The action SHALL NOT execute any mutations.

#### Scenario: Orchestration flow prepared

- GIVEN itemId, pictureUrl, categoryId, and optional title
- WHEN `prepare_image_orchestration` is invoked
- THEN it MUST return `MlcImageOrchestrationSummary` with 4 steps
- AND each mutation step (upload, associate) MUST declare `requiresApproval: true`
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Orchestration requires approval

- GIVEN an orchestration flow is prepared
- WHEN the runtime evaluates the action metadata
- THEN `requiresApproval` MUST be `true`
- AND the runtime surface MUST be `prepared-action` only
- AND the action MUST NOT execute any MercadoLibre API mutations

### Requirement: Creative Studio Pre-Diagnosis Integration

When the Creative Studio Agent generates images for channel `mercadolibre`, it SHALL call `POST /moderations/pictures/diagnostic` with the appropriate `picture_type`, `category_id`, and `title` BEFORE returning the `CreativeExecutionResult`. This pre-diagnosis SHALL be a non-blocking validation step — it informs but does not prevent result delivery.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| ML product cover | Generated image, channel `mercadolibre`, `pictureType: "thumbnail"` | Pre-diagnosis runs | Diagnostic result attached to output |
| Pre-diagnosis passes | No detections found | Result assembled | `mlDiagnostic.passed: true`, detections empty |
| Pre-diagnosis finds issues | white_background detected | Result assembled | `mlDiagnostic.passed: false`, detection details included |
| Non-ML channel | Channel `storefront` or `instagram` | Pre-diagnosis skipped | No `mlDiagnostic` in output |

### Requirement: Diagnostic Metadata in CreativeExecutionResult

`CreativeExecutionResult.outputs` SHALL include an `mlDiagnostic` field per asset containing: `passed` (boolean), `picture_type` (string), and `detections` array. Each detection SHALL include `name` (`white_background`, `minimum_size`, `text_logo`, `watermark`) and `wordings` with kind/value pairs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Clean diagnostic | Pre-diagnosis returns no issues | Output assembled | `mlDiagnostic: { passed: true, picture_type: "thumbnail", detections: [] }` |
| Multiple detections | white_background and text_logo found | Output assembled | Both detections listed with wordings |
| Diagnostic unavailable | ML diagnostic API unreachable | Output assembled | `mlDiagnostic` omitted; non-blocking |

### Requirement: No Upload Without CEO Approval

Generated assets SHALL NOT be uploaded to the MercadoLibre CDN (`POST /pictures/items/upload`) or associated with listings (`PUT /items/{id}`) until after CEO approval via the existing `prepare-only` flow. The pre-diagnosis step SHALL NOT trigger upload — it SHALL only validate format readiness.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Asset ready, not approved | Pre-diagnosis passed, CEO not yet approved | Result returned | Asset stored locally; no upload to ML CDN |
| CEO approves | CEO calls `approve_creative_asset` | Approval recorded | Existing ML orchestration flow (step 2: upload, step 3: associate) handles publication |
| Pre-diagnosis failed | white_background detected | Asset returned | Failed diagnostic surfaced; CEO can still approve with awareness |
