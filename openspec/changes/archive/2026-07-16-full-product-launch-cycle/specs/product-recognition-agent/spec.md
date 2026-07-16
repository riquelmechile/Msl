# product-recognition-agent Specification

## Purpose

DeepSeek Vision agent that analyzes CEO-submitted product photos. Identifies the main product, isolates it from background/other objects, and produces structured recognition results. When confidence is low, escalates to the CEO for more input.

## Requirements

### Requirement: Photo Analysis and Product Identification

The agent MUST analyze submitted photos using DeepSeek Vision and return a product identity: brand, model, color, and category. It MUST isolate the main product and ignore background objects, boxes, and unrelated items. It SHOULD suggest search terms for `ProductResearchAgent`.

#### Scenario: Clear product photo

- GIVEN a photo of a single Nike Air Max 270 clearly visible
- WHEN the agent analyzes it
- THEN product identity is returned: brand=Nike, model=Air Max 270 React, color=black/white
- AND search terms like "Nike Air Max 270 React specs" are suggested

#### Scenario: Photo with background objects

- GIVEN a photo where the product sits next to a box and a water bottle
- WHEN the agent analyzes it
- THEN only the main product is identified and background objects are ignored in the result

### Requirement: Low-Confidence Escalation

The agent MUST evaluate recognition confidence. When confidence is low (ambiguous product, poor lighting, unrecognizable item), the agent MUST ask the CEO for more photos or a product link. The pipeline MUST NOT proceed past `recognizing` until resolution.

#### Scenario: Confidence too low to proceed

- GIVEN a blurry, dark photo where the product is unrecognizable
- WHEN the agent analyzes it
- THEN the agent requests more photos or a product link from the CEO via Telegram
- AND the launch remains in `recognizing` state

#### Scenario: Multiple products in photo

- GIVEN a photo containing three different products
- WHEN the agent detects multiple products
- THEN the agent asks the CEO which product to launch
- AND the launch remains in `recognizing` state until the CEO responds

### Requirement: Structured Output

Recognition results MUST be structured: brand, model, color, category prediction, confidence score, and suggested search terms. Results MUST be stored in the launch's product context.

#### Scenario: Structured output stored

- GIVEN a successful recognition
- WHEN results are returned
- THEN the product context receives structured fields: `{brand, model, color, category, confidence}`
