# webhook-ingestor Specification

## Purpose

HTTP webhook ingestion endpoint for external events (MercadoLibre notifications, supplier updates, shipping callbacks) that feeds the agent message bus with structured event payloads for daemon processing.

## Requirements

### Requirement: Webhook Ingestion Endpoint

`MercadoLibreWebhookIngestor` MUST expose an HTTP endpoint (`POST /webhooks/mercadolibre`) that accepts JSON payloads. Valid payloads MUST be enqueued to the agent message bus with `senderAgentId = "webhook"` and `receiverAgentId` derived from the notification topic. The ingestor SHALL return 202 Accepted on successful enqueue and 400 Bad Request on invalid payloads.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid order notification | JSON with topic="orders", resource valid | POST /webhooks/mercadolibre | 202; message enqueued to operations-manager lane |
| Valid question notification | JSON with topic="questions" | POST /webhooks/mercadolibre | 202; message enqueued to operations-manager lane |
| Invalid payload | Malformed JSON | POST /webhooks/mercadolibre | 400; error logged; no message enqueued |
| Unknown topic | JSON with topic="unknown" | POST /webhooks/mercadolibre | 202; message enqueued to CEO lane with unknown topic tag |
| Rate limited | >100 requests in 1 minute | POST /webhooks/mercadolibre | 429 with Retry-After header |

### Requirement: Notification Topic Routing

The ingestor MUST map MercadoLibre notification topics to agent lanes: `orders` → `operations-manager`, `questions` → `unanswered-questions` (or operations-manager if unanswered-questions daemon not registered), `claims` → `operations-manager`, `items` → `market-catalog`, `shipments` → `operations-manager`. The mapping SHALL be configurable via `MSL_WEBHOOK_TOPIC_MAP` env var (JSON).

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Order notification routed | ML sends order status change | Ingestor processes | Message enqueued to operations-manager with order details |
| Question notification routed | ML sends new buyer question | Ingestor processes | Message enqueued to unanswered-questions with question_id |
| Custom topic map | MSL_WEBHOOK_TOPIC_MAP overrides defaults | Ingestor processes | Overridden routing applied |
| Topic with no mapping | Unrecognized topic, no default in config | Ingestor processes | Message enqueued to CEO lane with original topic preserved |

### Requirement: Idempotent Ingestion

The ingestor MUST deduplicate webhook deliveries by ML `resource` ID combined with the notification `topic`. If a webhook with the same resource+topic combination has already been processed within a configurable window (default: 5 minutes), the ingestor SHALL return 200 OK without enqueuing a new message. The dedupe key MUST be stored via the bus `dedupe_key` mechanism.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| First delivery | New order notification with resource "order-42" | POST received | Message enqueued; dedupe_key set |
| Duplicate within window | Same resource+topic within 5 min | POST received | 200; no new message; deduplication confirmed |
| Duplicate outside window | Same resource+topic after 5 min | POST received | 202; new message enqueued (may be a legitimate update) |
| Different topic, same resource | Same resource ID, different topic | POST received | 202; separate message enqueued (different dedupe_key) |
