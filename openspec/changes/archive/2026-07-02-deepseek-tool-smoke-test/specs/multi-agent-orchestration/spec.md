# Delta for Multi-Agent Orchestration

## ADDED Requirements

### Requirement: Forced Delegation Tool-Call Smoke

The system MUST validate provider support for proposal-only specialist delegation by forcing the named `delegate_to_subagent` tool in the optional DeepSeek live smoke. The smoke MUST validate only the returned tool-call contract and MUST NOT execute the returned delegation tool call or perform any business mutation.

#### Scenario: Named delegation tool is forced

- GIVEN the optional live DeepSeek smoke is enabled
- WHEN the provider request is created
- THEN `tool_choice` MUST force the named `delegate_to_subagent` function
- AND the available tool list MUST contain only the delegation schema needed for this smoke

#### Scenario: Delegation tool call is returned

- GIVEN DeepSeek returns a tool-call response
- WHEN the smoke validates the first tool call
- THEN the tool name MUST equal `delegate_to_subagent`
- AND the function arguments MUST be valid JSON for a bounded proposal-only delegation request

#### Scenario: Returned tool call is not executed

- GIVEN a valid `delegate_to_subagent` tool call is returned by DeepSeek
- WHEN smoke validation completes
- THEN the system MUST treat it as provider-contract evidence only
- AND it MUST NOT invoke the local delegation executor or mutate external systems

#### Scenario: Invalid tool contract fails safely

- GIVEN DeepSeek returns a non-tool finish reason, a different tool name, or malformed JSON arguments
- WHEN the smoke validates the response
- THEN the smoke MUST fail with a redacted diagnostic
- AND it MUST NOT retry with broader tools or execute any returned content
