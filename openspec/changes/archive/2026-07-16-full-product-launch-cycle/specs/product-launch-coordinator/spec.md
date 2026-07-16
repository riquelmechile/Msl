# product-launch-coordinator Specification

## Purpose

CEO sub-agent that orchestrates the full product launch pipeline via Work Sessions. Delegates to specialist agents, reports progress to the CEO progressively via Telegram, and handles failures gracefully through CEO escalation.

## Requirements

### Requirement: Pipeline Orchestration via Delegation

The coordinator MUST delegate each pipeline stage to the appropriate specialist agent via the Agent Message Bus using Work Sessions. It MUST NOT perform recognition, research, image analysis, or listing composition itself. Independent stages (research, competition, supplier) MAY run in parallel.

#### Scenario: Full pipeline delegated

- GIVEN a new `ProductLaunch` in `photo_received`
- WHEN the coordinator starts the pipeline
- THEN it delegates to ProductRecognitionAgent → ProductResearchAgent → ImageQualityAnalyzer → ImageSourcingAgent (if needed) → MiniMax (via CreativeStudio) → CompetitionAnalyst → ListingComposer

#### Scenario: Parallel execution

- GIVEN product identity is resolved
- WHEN the coordinator reaches research stage
- THEN ProductResearchAgent and CompetitionAnalyst MAY run concurrently

### Requirement: Progressive CEO Reporting

The coordinator MUST send progress updates to the CEO via Telegram at each pipeline stage transition. Updates MUST include the current stage, a human-readable status, and any action required from the CEO.

#### Scenario: Pipeline progress messages

- GIVEN the pipeline progresses through stages
- WHEN each stage completes
- THEN the CEO receives messages like: "📸 Producto identificado: Nike Air Max 270 React", "🔍 Buscando specs e imágenes…", "🎨 Generando imágenes profesionales…", "📦 Publicación lista para revisar: [preview]"

### Requirement: Graceful Failure Handling

When any stage fails, the coordinator MUST NOT block the pipeline. It MUST escalate to the CEO with a specific, actionable request. Recognized failure modes: low-confidence recognition → ask for more photos; web search failed → fall back to ML catalog; no images found → use original photo; MiniMax unavailable → use best available image.

#### Scenario: Recognition fails — CEO asked for more input

- GIVEN ProductRecognitionAgent returns low confidence
- WHEN the coordinator receives the failure
- THEN it sends the CEO a message requesting more photos or a product link
- AND the launch pauses at `recognizing` until CEO responds

#### Scenario: MiniMax unavailable — graceful degradation

- GIVEN MiniMax API returns an error
- WHEN the coordinator reaches `generating_creative`
- THEN it uses the best available sourced image as the listing photo
- AND reports to CEO: "⚠️ MiniMax no disponible, usando imagen de referencia"

### Requirement: Cache-Optimized DeepSeek Calls

Every DeepSeek call initiated by the coordinator MUST use lane-prefix caching. Shared system prompt prefixes across launches SHALL maximize cache hit rates and minimize LLM cost.

#### Scenario: Lane prefix reduces cost

- GIVEN 5 launches for Plasticov use the same lane prefix
- WHEN DeepSeek calls are made
- THEN cache hits on prefix portion reduce per-launch cost to the estimated model ($0.08–0.10/launch)
