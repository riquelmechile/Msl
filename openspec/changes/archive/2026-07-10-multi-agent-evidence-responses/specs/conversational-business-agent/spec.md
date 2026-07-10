# Delta for Conversational Business Agent

## ADDED Requirements

### Requirement: Evidence Inspection CEO Tools

The agent loop MUST register three read-only CEO tools. All three SHALL return `noMutationExecuted: true` and MUST NOT execute mutations.

| Tool | Function |
|------|----------|
| `get_evidence_request_status` | Query one request by `correlationId` — returns status, responder, confidence, response |
| `list_pending_evidence_requests` | List queued/claimed requests per seller with kind, priority, age |
| `inspect_candidate_evidence` | Show evidence responses aggregated for a CEO candidate |

#### Scenario: CEO checks request status

- GIVEN an evidence request exists with `correlationId: "corr-1"`
- WHEN the CEO invokes `get_evidence_request_status({ correlationId: "corr-1" })`
- THEN the tool MUST return status, responder, confidence, and response payload
- AND `noMutationExecuted` MUST be `true`

#### Scenario: CEO lists pending requests

- GIVEN 3 pending evidence requests for Plasticov
- WHEN the CEO invokes `list_pending_evidence_requests({ sellerId: "plasticov" })`
- THEN the tool MUST return all queued and claimed requests with kind, priority, and age
- AND MUST NOT return requests from Maustian
- AND `noMutationExecuted` MUST be `true`

#### Scenario: CEO inspects candidate evidence

- GIVEN a candidate has aggregated evidence responses
- WHEN the CEO invokes `inspect_candidate_evidence({ candidateId: "cand-1" })`
- THEN the tool MUST return confidence, blockers, readiness, and per-kind response summaries
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Nonexistent request handled gracefully

- GIVEN no evidence request exists for the given correlationId
- WHEN the CEO invokes `get_evidence_request_status`
- THEN the tool MUST return a controlled response indicating nonexistence
- AND MUST NOT fail or throw

### Requirement: Evidence Message Bus Integration

The agent loop MUST register `evidence-request` and `evidence-response` as supported message types. All evidence messages MUST carry a `correlationId` connecting the request-response chain through the bus. The `correlationId` MUST be traceable across request → daemon investigation → CEO proposal.

#### Scenario: Correlation chain preserved

- GIVEN the CEO lane emits an evidence request with `correlationId: "corr-1"`
- WHEN a responder daemon publishes a response
- THEN the response message MUST carry `correlationId: "corr-1"`
- AND the CEO proposal enriched with that response MUST reference `correlationId: "corr-1"`

#### Scenario: Message types registered at startup

- GIVEN the agent loop initializes
- WHEN message types are registered
- THEN `evidence-request` and `evidence-response` MUST appear alongside existing bus message types
