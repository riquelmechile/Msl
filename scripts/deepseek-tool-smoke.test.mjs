import { describe, expect, it } from "vitest";

import {
  SYNTHETIC_SCOPE,
  assertLiveSmokeEnv,
  createDeepSeekToolSmokeRequest,
  runDeepSeekToolSmoke,
  validateCacheTelemetry,
  validateToolCallResponse,
} from "./deepseek-tool-smoke.mjs";

const validToolCallResponse = {
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        tool_calls: [
          {
            function: {
              name: "delegate_to_subagent",
              arguments: JSON.stringify({ laneId: "market-catalog", scope: SYNTHETIC_SCOPE }),
            },
          },
        ],
      },
    },
  ],
};

function createRuntimeThatFailsOnProviderCall() {
  return {
    OpenAI: class FailingOpenAI {
      constructor() {
        throw new Error("provider client must not be created without env gates");
      }
    },
    createDelegateToSubagentTool: () => ({ name: "delegate_to_subagent", parameters: {} }),
    createOpenAiToolDefinitions: () => [],
  };
}

describe("deepseek tool smoke env gates", () => {
  it("requires an API key before any provider client can be created", async () => {
    await expect(
      runDeepSeekToolSmoke({
        env: { MSL_DEEPSEEK_LIVE_SMOKE: "1" },
        dependencies: createRuntimeThatFailsOnProviderCall(),
      }),
    ).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });

  it("requires explicit live smoke opt-in before any provider client can be created", async () => {
    await expect(
      runDeepSeekToolSmoke({
        env: { DEEPSEEK_API_KEY: "synthetic-key" },
        dependencies: createRuntimeThatFailsOnProviderCall(),
      }),
    ).rejects.toThrow(/MSL_DEEPSEEK_LIVE_SMOKE=1/);
  });

  it("accepts env gates when both API key and opt-in are present", () => {
    expect(() =>
      assertLiveSmokeEnv({ DEEPSEEK_API_KEY: "synthetic-key", MSL_DEEPSEEK_LIVE_SMOKE: "1" }),
    ).not.toThrow();
  });
});

describe("deepseek tool smoke request", () => {
  it("forces the named delegate_to_subagent tool with synthetic user isolation", () => {
    const request = createDeepSeekToolSmokeRequest({
      createDelegateToSubagentTool: () => ({ name: "delegate_to_subagent", parameters: {} }),
      createOpenAiToolDefinitions: (tools) =>
        tools.map((tool) => ({ type: "function", function: tool })),
    });

    expect(request.model).toBe("deepseek-v4-flash");
    expect(request.stream).toBe(false);
    expect(request.user_id).toBe("msl-smoke-deepseek-tool-v1");
    expect(request.tools).toHaveLength(1);
    expect(request.tool_choice).toEqual({
      type: "function",
      function: { name: "delegate_to_subagent" },
    });
  });
});

describe("deepseek tool smoke response validation", () => {
  it("rejects a non-tool finish reason", () => {
    expect(() =>
      validateToolCallResponse({
        choices: [{ ...validToolCallResponse.choices[0], finish_reason: "stop" }],
      }),
    ).toThrow(/finish_reason/);
  });

  it("rejects the wrong tool name", () => {
    expect(() =>
      validateToolCallResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: { tool_calls: [{ function: { name: "other_tool", arguments: "{}" } }] },
          },
        ],
      }),
    ).toThrow(/tool name/);
  });

  it("rejects malformed JSON arguments", () => {
    expect(() =>
      validateToolCallResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              tool_calls: [{ function: { name: "delegate_to_subagent", arguments: "{" } }],
            },
          },
        ],
      }),
    ).toThrow(/parseable JSON/);
  });

  it("accepts valid tool-call evidence", () => {
    expect(validateToolCallResponse(validToolCallResponse)).toMatchObject({
      finishReason: "tool_calls",
      toolName: "delegate_to_subagent",
      args: { laneId: "market-catalog", scope: SYNTHETIC_SCOPE },
    });
  });
});

describe("deepseek cache telemetry validation", () => {
  it("accepts absent counters", () => {
    expect(validateCacheTelemetry(undefined)).toEqual({
      prompt_cache_hit_tokens: { present: false },
      prompt_cache_miss_tokens: { present: false },
    });
  });

  it("accepts zero counters", () => {
    expect(
      validateCacheTelemetry({ prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0 }),
    ).toEqual({
      prompt_cache_hit_tokens: { present: true, value: 0 },
      prompt_cache_miss_tokens: { present: true, value: 0 },
    });
  });

  it("rejects negative, infinite, or non-number counters", () => {
    expect(() => validateCacheTelemetry({ prompt_cache_hit_tokens: -1 })).toThrow(/finite/);
    expect(() => validateCacheTelemetry({ prompt_cache_hit_tokens: Infinity })).toThrow(/finite/);
    expect(() => validateCacheTelemetry({ prompt_cache_hit_tokens: "0" })).toThrow(/finite/);
  });
});
