# Delta for Conversational Business Agent

## ADDED Requirements

### Requirement: Opt-In DeepSeek Tool Smoke Validation

The system MUST provide an optional live DeepSeek smoke validation for function-calling contract evidence. The smoke MUST require both a valid provider API key and an explicit live-smoke opt-in gate before any paid provider call. It MUST use only synthetic prompt content and a synthetic non-personal `user_id` for provider lane/cache isolation, and MUST NOT include real seller, catalog, MercadoLibre, account, token, or business data in requests or logs.

#### Scenario: Live smoke is explicitly enabled

- GIVEN `DEEPSEEK_API_KEY` is present and the live-smoke opt-in flag is enabled
- WHEN the DeepSeek tool smoke is run
- THEN exactly one non-streaming live provider request MAY be made
- AND the request MUST include a synthetic `user_id` not derived from personal or business data

#### Scenario: Opt-in gate is missing

- GIVEN `DEEPSEEK_API_KEY` is missing or the live-smoke opt-in flag is disabled
- WHEN the DeepSeek tool smoke is requested
- THEN the system MUST stop before any provider call
- AND it MUST explain that live paid smoke execution requires explicit opt-in

#### Scenario: Provider contract evidence is validated

- GIVEN DeepSeek returns a chat completion response
- WHEN the smoke validates the response
- THEN it MUST require `finish_reason` to be `tool_calls`
- AND it MUST require a `delegate_to_subagent` tool call with parseable JSON arguments

#### Scenario: Cache telemetry is absent or first-run miss

- GIVEN the provider omits cache counters or returns zero cache-hit tokens
- WHEN smoke validation evaluates usage telemetry
- THEN it MUST NOT fail solely because first-run cache hit evidence is absent
- AND any returned cache counters MUST be finite non-negative numbers

#### Scenario: Logs are safe for review

- GIVEN the smoke reports request or response evidence
- WHEN output is written to logs
- THEN it MUST redact secrets and avoid printing headers, environment dumps, raw API keys, or real business identifiers
