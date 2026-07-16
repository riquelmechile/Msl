# product-launch-domain Specification

## Purpose

`ProductLaunch` entity and state machine for the full intelligent product launch pipeline. Defines the lifecycle from a CEO Telegram photo through recognition, research, image generation, competition analysis, listing composition, approval, and outcome capture for Cortex learning.

## Requirements

### Requirement: ProductLaunch State Machine

The `ProductLaunch` entity MUST track its progress through defined states. Transitions MUST be validated — only valid state transitions are permitted. The state machine SHALL accumulate product context progressively at each stage.

| State | Description |
|-------|-------------|
| `photo_received` | Photo saved, awaiting recognition |
| `recognizing` | DeepSeek Vision analyzing photo |
| `researching` | Web search for specs, descriptions, images |
| `sourcing_images` | Downloading reference images from internet |
| `generating_creative` | MiniMax generating professional images |
| `analyzing_competition` | ML competition data + pricing analysis |
| `composing_listing` | Account-aware listing assembly |
| `awaiting_approval` | Listing preview sent to CEO |
| `approved` | CEO approved — ready to publish |
| `rejected` | CEO rejected — launch halted |
| `ready_to_publish` | Validated listing package, write gate blocked |

#### Scenario: Normal pipeline progression

- GIVEN a `ProductLaunch` in `photo_received`
- WHEN recognition completes successfully
- THEN state transitions to `recognizing` → `researching` → … → `awaiting_approval`

#### Scenario: Invalid transition prevented

- GIVEN a `ProductLaunch` in `photo_received`
- WHEN code attempts to transition directly to `composing_listing`
- THEN the transition is rejected as invalid

### Requirement: Product Context Accumulation

Each pipeline stage MUST append data to the launch's product context: recognition results, research data, sourced image URIs, generated image URIs, competition insights, and the composed listing payload.

#### Scenario: Context grows through pipeline

- GIVEN a launch entering `composing_listing`
- WHEN the composer reads the product context
- THEN all prior-stage data (recognition, research, images, competition) is available

### Requirement: Launch Outcome Data Model

A completed launch MUST produce an outcome record containing: product identity, ML category, final listing payload, image URIs, pricing strategy, and supplier selection. This outcome SHALL feed Cortex learning.

#### Scenario: Outcome feeds Cortex

- GIVEN a launch in `approved`
- WHEN the pipeline completes
- THEN an outcome record is produced with all launch data accessible for Cortex ingestion
