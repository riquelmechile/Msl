# image-quality-analyzer Specification

## Purpose

Evaluates uploaded product photo quality and produces a routing decision for the image pipeline: use the original as a MiniMax reference, regenerate with MiniMax but keep the original as reference, or discard entirely and search the internet for better images.

## Requirements

### Requirement: Quality Assessment

The analyzer MUST rate photos on: resolution (pixels), lighting quality, background complexity, and product clarity. It MUST produce a numeric quality score (0–100) along with a per-dimension breakdown.

#### Scenario: High-quality photo

- GIVEN a 1200×1200 well-lit photo on a white background
- WHEN the analyzer processes it
- THEN the score is ≥ 80, and the decision is `USE_AS_REFERENCE`

#### Scenario: Low-quality photo

- GIVEN a 400×300 dark photo with cluttered background
- WHEN the analyzer processes it
- THEN the score is < 40, and the decision is `DISCARD_AND_SEARCH`

### Requirement: Routing Decision

The analyzer MUST produce exactly one decision: `USE_AS_REFERENCE` (photo is good enough as MiniMax reference), `REGENERATE` (photo is usable as reference but needs improvement), or `DISCARD_AND_SEARCH` (photo is unusable, find better images online).

#### Scenario: Medium-quality — regenerate

- GIVEN a photo with good product clarity but moderate lighting
- WHEN the analyzer processes it
- THEN the decision is `REGENERATE` — use photo as subject reference for MiniMax but generate new professional images

#### Scenario: Discard and search

- GIVEN a photo where the product is barely visible
- WHEN the analyzer processes it
- THEN the decision is `DISCARD_AND_SEARCH`
- AND the launch transitions to `sourcing_images` for internet image search

### Requirement: Decision Integration

The routing decision MUST be stored in the launch's product context and MUST determine the next pipeline stage: `USE_AS_REFERENCE` or `REGENERATE` → `generating_creative`, `DISCARD_AND_SEARCH` → `sourcing_images`.

#### Scenario: Decision drives pipeline routing

- GIVEN the analyzer returns `DISCARD_AND_SEARCH`
- WHEN the coordinator reads the decision
- THEN the next stage scheduled is `sourcing_images`, not `generating_creative`
