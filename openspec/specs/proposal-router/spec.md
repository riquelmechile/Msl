# proposal-router Specification

## Purpose

Persistent CEO proposal inbox with normalization, prioritization, and routing to Telegram and web approval queue. Replaces fire-and-forget CEO message consumption with structured proposal management.

## Requirements

### Requirement: CeoInboxStore Persistence

SQLite `agent_proposals` table with: `proposal_id` (TEXT UNIQUE), `message_id` (FK→agent_message_bus), `sender_agent_id`, `seller_id`, `proposal_type`, `summary`, `findings_json`, `recommended_action`, `priority`, `urgency` (low/medium/high/critical), `status` (pending/routed/acknowledged/approved/rejected/archived/invalid), `routed_to`, `routed_at`, timestamps. Uses `CREATE TABLE IF NOT EXISTS`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Proposal stored | Daemon enqueues CEO proposal | insertProposal() | Row inserted; status=pending |
| Duplicate proposal_id | Existing proposal with same id | insertProposal() | No duplicate; existing returned |
| Priority ordering | Priorities 1, 3, 5 pending | getPending(sortBy="priority") | Priority 1 returned first |
| Seller filter | Proposals for sellers A, B | getPending(sellerId="A") | Only seller A returned |

### Requirement: Proposal Normalization

`ProposalRouter.normalize(proposal)` MUST validate: type="proposal", summary (max 500 chars), findings (min 1), recommendedAction. Missing required fields → `status="invalid"` with reason. Urgency MAY be inferred from finding severity.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid proposal | All required fields present | normalize() | status="pending" |
| Missing summary | Summary absent | normalize() | status="invalid", reason="missing_summary" |
| Empty findings | findings=[] | normalize() | status="invalid", reason="empty_findings" |
| Summary truncated | 800-char summary | normalize() | Truncated to 500; proposal valid |
| Urgency inferred | Critical-severity finding, no urgency field | normalize() | urgency="high" inferred |

### Requirement: Telegram Routing

`ProposalRouter.routeToTelegram(proposal)` SHALL format and send via Telegram bot: summary, top 3 findings with severity badges, recommended action, inline approval buttons. Sets `routed_to="telegram"` and `routed_at` after send. Critical urgency includes push notification.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Telegram route | Valid proposal, bot configured | routeToTelegram() | Message sent with summary + buttons |
| Critical urgency | urgency="critical" | Route to Telegram | ⚠️ prefix + push notification |
| Telegram not configured | No bot token | routeToTelegram() | Proposal stays pending; no error |
| Many findings | 7 findings | Route to Telegram | Top 3 only; "view all" link appended |

### Requirement: CEO Lane Integration

Scheduler CEO consumption MUST delegate to `ProposalRouter.ingestCeoMessage(claim)` instead of auto-resolving. Extracts payload, normalizes, persists to CeoInboxStore, routes to destinations, then resolves bus message with `proposal_id` as result.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| CEO message ingested | Bus message for receiver="ceo" | ingestCeoMessage() | Stored + routed + bus resolved with proposal_id |
| Invalid CEO message | Payload not a valid proposal | ingestCeoMessage() | Bus message failed with reason; no proposal created |
| Store before resolve | ingestCeoMessage called | Execution order | Proposal persisted first; bus resolve only after success |
