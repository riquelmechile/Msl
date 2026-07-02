# Proposal: DeepSeek Tool Smoke Test

## Intent

Validate the official DeepSeek V4 function-calling path for `delegate_to_subagent` with one safe live provider smoke, proving forced tool-call round-tripping before relying on production agent behavior.

## Scope

### In Scope
- Add an explicit opt-in smoke script/command guarded by `DEEPSEEK_API_KEY` and a live-smoke flag.
- Use cheap `deepseek-v4-flash` by default, with override support for live verification.
- Send only synthetic prompts, synthetic `user_id`, and the `delegate_to_subagent` tool schema.
- Verify official contract fields: `tools`, forced named `tool_choice`, `finish_reason: "tool_calls"`, `message.tool_calls`, `user_id`, and cache telemetry fields when present.

### Out of Scope
- Full agent conversation or prompt persuasion.
- Catalog ingestion, MercadoLibre data, seller data, or real business identifiers.
- Production tool execution or external mutation.
- Requiring cache hit on first run.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `conversational-business-agent`: DeepSeek integration gains an explicit live smoke for official function-calling and cache telemetry contract validation.
- `multi-agent-orchestration`: Delegation lanes gain provider smoke evidence for proposal-only `delegate_to_subagent` tool-call routing.

## Approach

Create a standalone smoke runner under `scripts/` and wire a package command that never runs in normal tests/CI. The request forces `delegate_to_subagent` through named `tool_choice`, uses `stream: false`, logs redacted evidence, and asserts stable provider-contract facts only. Cache counters are validated as finite non-negative numbers only if returned.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `scripts/` | New | Opt-in live DeepSeek smoke runner. |
| `package.json` | Modified | Adds explicit smoke command. |
| `packages/agent/src/conversation/tools.ts` | Reused | Source of safe `delegate_to_subagent` schema/contract. |
| `openspec/specs/*` | Modified | Delta specs for live smoke expectations. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Paid/API call runs accidentally | Low | Require API key plus explicit live-smoke flag. |
| Provider flake/rate limit | Med | Treat as opt-in smoke evidence, not unit-test truth. |
| Secret leakage in logs | Low | Redact errors and avoid headers/env dumps. |
| Cache counters absent/zero | Med | Do not fail unless present counters are invalid. |

## Rollback Plan

Remove the smoke script, package command, and delta specs. No persisted business data or production state is mutated.

## Dependencies

- DeepSeek API key with access to `deepseek-v4-flash`.
- Official DeepSeek OpenAI-compatible chat completions API.

## Success Criteria

- [ ] Smoke is impossible to run without explicit opt-in gates.
- [ ] Live response returns `finish_reason: "tool_calls"` and `message.tool_calls[0].function.name === "delegate_to_subagent"`.
- [ ] Synthetic `user_id` is sent for KVCache/scheduling isolation.
- [ ] Cache telemetry, if present, is redacted and non-flaky.
