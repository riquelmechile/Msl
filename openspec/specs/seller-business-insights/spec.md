# Seller Business Insights Specification

## Purpose

Define daily explainable insights for a MercadoLibre Chile seller using an arbitrage/dropshipping operating model.

## Requirements

### Requirement: Daily Executive Summary

The system MUST produce a concise daily summary of sales, margin signals, pending actions, claims, customer issues, reputation risks, and priority opportunities.

#### Scenario: Seller requests daily summary

- GIVEN fresh or acceptable cached business data exists
- WHEN the seller asks for today's summary
- THEN the system MUST rank priorities by profit, urgency, and reputation risk

#### Scenario: Data is stale for critical priorities

- GIVEN critical data is stale
- WHEN the seller requests the summary
- THEN the system MUST disclose the stale area and refresh before final guidance when possible

### Requirement: Opportunity and Risk Explanation

The system MUST explain recommendations in terms of profit, margin, supplier sourcing after sale, customer treatment, claims, and reputation impact.

#### Scenario: Agent recommends an action

- GIVEN the agent identifies an opportunity or risk
- WHEN it recommends action
- THEN it MUST include the business reason and expected tradeoff

#### Scenario: Recommendation confidence is low

- GIVEN the available evidence is incomplete or uncertain
- WHEN the agent proposes an action
- THEN it MUST mark confidence as low and request seller review

### Requirement: Read-First Recommendation Evidence

The system MUST cite source, freshness, confidence, and partial coverage when recommendations use refreshed MercadoLibre capability evidence for listing quality, category attributes/specs, pictures, shipping, visits/metrics, reputation, questions, or messages. Recommendations MUST NOT imply mutation ability unless a separate approved execution capability exists.

#### Scenario: Evidence supports recommendation

- GIVEN fresh or acceptable safe-read evidence exists for the relevant seller area
- WHEN the system explains an opportunity or risk
- THEN it MUST cite the evidence source, area, freshness, and confidence level
- AND it MUST disclose whether coverage is complete or partial
- AND it MUST avoid implying unverified mutation capability

#### Scenario: Evidence is partial, stale, or unsupported

- GIVEN evidence is stale, missing, unsupported for `MLC`, or incomplete
- WHEN the system produces guidance
- THEN it MUST mark the recommendation as partial or low confidence
- AND it SHOULD request confirmation or more evidence before proposing action
