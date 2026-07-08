# Delta for product-ads-profitability-daemon

## ADDED Requirements

### Requirement: CEO Consumption Pipeline Targeting

The daemon MUST enqueue profitability proposals with `receiverAgentId` set to `product-ads-ceo-profitability` so the CEO profitability handler can claim them. Proposals SHALL carry the full payload: `{ type: "proposal", summary, findings[], recommendedAction }`. The `dedupeKey` MUST match the daemon's recommendation identity `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{signalTierOrType}` to prevent duplicate enqueues.

#### Scenario: Proposal enqueued for CEO profitability lane
- GIVEN the daemon generates findings for seller S
- WHEN enqueue is called
- THEN `receiverAgentId` SHALL be `product-ads-ceo-profitability`

#### Scenario: Dedupe prevents duplicate enqueue
- GIVEN a proposal with the same recommendation identity was already enqueued
- WHEN enqueue is called again with the same dedupeKey
- THEN the message bus SHALL return the existing message without creating a duplicate
