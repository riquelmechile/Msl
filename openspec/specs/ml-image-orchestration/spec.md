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

---

## ADDED: Runtime Implementation (Slice 3)

### Requirement: Image Associate Client Method

The client MUST expose `associateImageToItem(sellerId, { itemId, pictureId })` returning `MlcImageAssociateSnapshot`.

### Requirement: Image Orchestration Prepared Action

The MCP tool surface MUST expose `prepare_image_orchestration` as a prepare-only tool accepting `{ sellerId, itemId, pictureUrl, categoryId, title? }`. It SHALL construct a multi-step flow (diagnose → upload → associate → check) without executing any mutations, returning `MlcImageOrchestrationSummary` with `requiresApproval: true` and `noMutationExecuted: true`.
