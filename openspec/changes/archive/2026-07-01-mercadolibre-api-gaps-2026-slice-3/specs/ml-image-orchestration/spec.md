# ml-image-orchestration Specification — Delta (Slice 3)

## ADDED Requirements

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
