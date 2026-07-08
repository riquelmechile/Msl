# Delta for ml-image-orchestration

## ADDED Requirements

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
