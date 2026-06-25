# AI Growth Creative Expansion Specification

## Purpose

Define AI-assisted growth capabilities that discover opportunities and draft creative assets for seller approval.

## Requirements

### Requirement: AI Opportunity Radar

The system MUST track relevant AI launches, marketplace trends, and growth experiments that could improve MercadoLibre Chile selling outcomes.

#### Scenario: New opportunity is found

- GIVEN a relevant AI or marketplace opportunity is detected
- WHEN the agent presents it
- THEN it MUST explain the seller value, effort, risk, and suggested experiment

#### Scenario: Opportunity is irrelevant

- GIVEN an opportunity does not fit the seller's model or `MLC`
- WHEN evaluating it
- THEN the system SHOULD suppress or down-rank it with rationale

### Requirement: Creative Asset Drafts

The system MUST draft product photo improvements, short video or reels-style concepts, and related growth assets without publishing or applying them automatically.

#### Scenario: Seller requests creative improvement

- GIVEN the seller requests a product photo or short video draft
- WHEN the agent prepares the asset concept
- THEN it MUST provide a preview, usage intent, and expected listing benefit

#### Scenario: Publication is requested

- GIVEN a draft creative asset exists
- WHEN publication or listing application is requested
- THEN the system MUST require explicit human approval before any change
