# Delta for agent-message-bus

## ADDED Requirements

### Requirement: Daemon Proposal Enqueue Contract

Daemons that enqueue CEO proposals via `enqueue()` MUST set `senderAgentId` to the daemon's lane identifier and `receiverAgentId` to `"ceo"`. The `payloadJson` MUST be valid JSON containing at minimum `{ type: "proposal", summary, findings, recommendedAction }`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Valid proposal enqueued | Daemon has findings | enqueue with senderAgentId="market-catalog", receiverAgentId="ceo" | Message persisted with correct sender/receiver |
| Missing required fields | payloadJson lacks "type" or "summary" | enqueue called | Message still persisted (bus enforces no schema) |
| Dedupe prevents duplicates | Daemon enqueues same dedupeKey | enqueue called second time | First message returned, no duplicate |

### Requirement: Daemon Polling Receptor

The message bus SHALL accept `claimNext(receiverAgentId)` calls from the daemon scheduler where `receiverAgentId` matches an agent's lane ID. Messages enqueued with `receiverAgentId` matching `cost-supplier`, `market-catalog`, `creative-commercial`, `ceo`, or other valid lane IDs MUST be claimable.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Daemon claims its messages | Pending message for "market-catalog" | claimNext("market-catalog") | Message returned in processing state |
| CEO lane messages not claimable by daemon | Pending message for "ceo" | claimNext("market-catalog") | No message returned (wrong receiver) |
| Priority order preserved | Messages at priority 1 and 5 for same agent | claimNext(agentId) | Priority 1 returned first |
