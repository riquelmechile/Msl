# Delta for multi-agent-orchestration

## MODIFIED Requirements

### Requirement: Forced Delegation Tool-Call Smoke

The system MUST validate provider support for proposal-only specialist delegation by forcing the named `delegate_to_subagent` tool in the optional DeepSeek live smoke. The smoke MUST validate only the returned tool-call contract and MUST NOT execute the returned delegation tool call or perform any business mutation.
(Previously: Smoke existed but `request_agent_evidence` was synchronous only — no durable bus enqueue.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Named delegation tool is forced | Optional live DeepSeek smoke is enabled | Provider request created | `tool_choice` MUST force the named `delegate_to_subagent` function |
| Delegation tool call is returned | DeepSeek returns a tool-call response | Smoke validates first tool call | Tool name equals `delegate_to_subagent`; args are valid JSON |
| Returned tool call is not executed | Valid `delegate_to_subagent` returned | Smoke validation completes | Treated as provider-contract evidence; no mutation executed |
| Invalid tool contract fails safely | DeepSeek returns non-tool finish or malformed JSON | Smoke validates response | Smoke fails with redacted diagnostic; no retry with broader tools |

## ADDED Requirements

### Requirement: Durable Evidence Request via Message Bus

`request_agent_evidence` in `workforceTools.ts` MUST enqueue a durable bus message to the target agent's lane via `bus.enqueue()` BEFORE returning the synchronous `AgentEvidenceResponse`. The message MUST include `sender_agent_id = CEO agent ID`, `receiver_agent_id = target agent lane ID`, `message_type = "evidence_request"`, `payload_json` with the request context, and a `dedupe_key` based on the request parameters. The synchronous response contract MUST remain unchanged for LLM loop compatibility.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| CEO requests evidence from market-catalog | Valid request params | request_agent_evidence called | Message enqueued to market-catalog lane; synchronous response returned |
| Target agent is suspended | Agent status is "suspended" | request_agent_evidence called | No message enqueued; response indicates agent unavailable |
| Duplicate request | Same params as previous request | request_agent_evidence called | Dedupe key prevents second message; synchronous response still returned |
| Target agent busy | Agent status is "busy" | request_agent_evidence called | Message enqueued (queued for later); synchronous response indicates agent will process when available |
| Scheduler picks up evidence request | Message pending for target agent | Next scheduler cycle | Target daemon claims message, investigates, enqueues CEO proposal with evidence |
| Message survives restart | Evidence request enqueued, process restarts | System restarts | Message still in bus (SQLite-backed); picked up on next scheduler cycle |

### Requirement: Evidence Request Audit Trail

Every `request_agent_evidence` call MUST include `correlation_id` and `action_id` in the enqueued message. The correlation chain (request → daemon investigation → CEO proposal) MUST be traceable via `correlation_id` across bus messages.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Correlation chain preserved | CEO requests evidence (corr-1) | Daemon responds with proposal (corr-1) | Both messages share correlation_id |
| Action traceable | request_agent_evidence(actionId="act-1") | Message enqueued | Message has action_id="act-1"; proposal references action_id |
