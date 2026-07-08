# ceo-profitability-handler Specification

## Purpose

Daemon handler registered as `product-ads-ceo-profitability` lane. Claims profitability proposals from the agent message bus, maps CFO-grade signals to Product Ads actions with seller approval, manages per-seller Telegram forum topics, and sends proactive deduplicated notifications to both sellers.

## Requirements

### Requirement: Signal-to-Action Mapping

The handler SHALL delegate profitability findings to `CeoDeepSeekClient` for LLM-reasoned recommendations enriched with Cortex context. The LLM SHALL return structured JSON with a valid `proposalType`. The handler SHALL forward valid recommendations to `msl_prepare_product_ads_action` with `requiresApproval: true`.

The existing static `SIGNAL_TO_ACTION` map SHALL be preserved as fallback:

| Signal | Action | Severity |
|--------|--------|----------|
| margin-consuming | pause-campaign | critical |
| scale-candidate | adjust-campaign-budget (increase) | opportunity |
| budget-waste | review-campaign-structure | warning |
| underinvested | adjust-campaign-budget (allocate) | info |
| unit-economics | review-campaign-structure (info-report) | info |

The handler SHALL fall back to the static map immediately when `CeoDeepSeekClient` returns an error, times out, or produces an invalid `proposalType`.

Info-only findings (unit-economics, underinvested) SHALL produce info-report actions without requiring seller approval prompts — LLM or fallback alike.

#### Scenario: LLM produces valid recommendation
- GIVEN a profitability proposal with findings for seller S
- AND `CeoDeepSeekClient.reason()` returns valid recommendations
- WHEN the handler processes findings
- THEN each `msl_prepare_product_ads_action` SHALL use the LLM-reasoned `proposalType`

#### Scenario: LLM unavailable triggers fallback
- GIVEN `CeoDeepSeekClient` fails, times out, or returns invalid `proposalType`
- WHEN the handler processes findings
- THEN the static `SIGNAL_TO_ACTION` map SHALL produce the recommendation immediately

#### Scenario: Margin-consuming ad triggers pause proposal (fallback)
- GIVEN a profitability proposal with a margin-consuming finding for campaign C, seller S
- WHEN the handler processes the finding via fallback
- THEN a `msl_prepare_product_ads_action` SHALL be created with `proposalType: pause-campaign` and `requiresApproval: true`

#### Scenario: Unit-economics finding produces info report (fallback)
- GIVEN a profitability proposal with a unit-economics finding
- WHEN the handler processes the finding via fallback
- THEN a `review-campaign-structure` info-report SHALL be created without requiring seller approval

### Requirement: CEO Proposal Claiming

The handler SHALL claim pending messages from the agent message bus where `receiverAgentId` is `product-ads-ceo-profitability`. On claim success, the handler MUST unpack the profitability payload and process each finding. On completion, the handler MUST `resolve()` the message. On error, the handler MUST `fail()` the message.

#### Scenario: Claims and processes pending proposal
- GIVEN a pending message enqueued for `product-ads-ceo-profitability`
- WHEN the daemon scheduler invokes the handler's investigate()
- THEN the message SHALL be claimed, processed, and resolved

#### Scenario: Errors fail the message safely
- GIVEN processing throws an error mid-cycle
- WHEN the handler catches the error
- THEN the message SHALL be failed on the bus and the handler SHALL not crash

### Requirement: Per-Seller Forum Topic Management

The handler SHALL resolve admin chat IDs from `MSL_TELEGRAM_ADMIN_CHAT_IDS`. For each seller without an existing forum topic, the handler SHALL create one via grammY `createForumTopic` and persist the topic ID. Existing topics SHALL be reused across restarts.

#### Scenario: First-time topic creation
- GIVEN seller S has no persisted forum topic ID
- WHEN the handler processes a proposal for seller S
- THEN a forum topic SHALL be created in the admin chat and the topic ID persisted

#### Scenario: Topic reused after restart
- GIVEN seller S has a persisted forum topic ID from a previous session
- WHEN the handler processes a proposal for seller S
- THEN the existing forum topic SHALL be reused without creating a duplicate

### Requirement: Proactive Notification with 7-Day Dedupe

The handler SHALL send proactive Telegram notifications via `sendProactiveMessage` with `message_thread_id` targeting the seller's forum topic. Notifications SHALL be deduplicated using identity `product-ads-cfo:{sellerId}:{campaignId}:{itemId}:{tier}` with a rolling 7-day lookback. Notifications matching an identity sent within 7 days MUST be suppressed. Both sellers (Plasticov, Maustian) SHALL receive notifications for their respective proposals.

#### Scenario: First notification for a finding
- GIVEN a finding identity has no notification in the past 7 days
- WHEN the handler processes the finding
- THEN a proactive Telegram message SHALL be sent to the seller's forum topic

#### Scenario: Duplicate suppressed within 7 days
- GIVEN the same finding identity was notified 3 days ago
- WHEN the handler processes the finding again
- THEN the notification SHALL be suppressed via dedupe check

#### Scenario: Notification after window expires
- GIVEN the same finding identity was last notified 8 days ago
- WHEN the handler processes the finding
- THEN a new notification SHALL be sent
