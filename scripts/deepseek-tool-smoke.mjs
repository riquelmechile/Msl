const REQUIRED_OPT_IN_VALUE = "1";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DELEGATION_TOOL_NAME = "delegate_to_subagent";

export const SYNTHETIC_USER_ID = "msl-smoke-deepseek-tool-v1";
export const SYNTHETIC_LANE_ID = "market-catalog";
export const SYNTHETIC_SCOPE = "synthetic provider smoke";
export const SYNTHETIC_EVIDENCE_ID = "smoke:evidence:synthetic-1";

export function assertLiveSmokeEnv(env = process.env) {
  if (typeof env.DEEPSEEK_API_KEY !== "string" || env.DEEPSEEK_API_KEY.length === 0) {
    throw new Error("DeepSeek live smoke requires DEEPSEEK_API_KEY before any provider call.");
  }

  if (env.MSL_DEEPSEEK_LIVE_SMOKE !== REQUIRED_OPT_IN_VALUE) {
    throw new Error(
      "DeepSeek live smoke is paid/live and requires explicit opt-in: MSL_DEEPSEEK_LIVE_SMOKE=1.",
    );
  }
}

export function validateCacheTelemetry(usage) {
  const counters = {};

  for (const key of ["prompt_cache_hit_tokens", "prompt_cache_miss_tokens"]) {
    const value = usage?.[key];
    if (value === undefined || value === null) {
      counters[key] = { present: false };
      continue;
    }

    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid DeepSeek cache telemetry: ${key} must be finite and non-negative.`);
    }

    counters[key] = { present: true, value };
  }

  return counters;
}

function parseDelegationArguments(rawArguments) {
  if (typeof rawArguments !== "string" || rawArguments.trim().length === 0) {
    throw new Error("DeepSeek tool call arguments must be a non-empty JSON string.");
  }

  let args;
  try {
    args = JSON.parse(rawArguments);
  } catch {
    throw new Error("DeepSeek tool call arguments were not parseable JSON.");
  }

  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("DeepSeek tool call arguments must decode to an object.");
  }

  if (typeof args.laneId !== "string" || args.laneId.length === 0) {
    throw new Error("DeepSeek tool call arguments must include a valid laneId.");
  }

  if (typeof args.scope !== "string" || args.scope.length === 0) {
    throw new Error("DeepSeek tool call arguments must include a valid scope.");
  }

  return args;
}

export function validateToolCallResponse(response) {
  const choice = response?.choices?.[0];
  if (!choice) {
    throw new Error("DeepSeek response did not include a first choice.");
  }

  if (choice.finish_reason !== "tool_calls") {
    throw new Error(`DeepSeek finish_reason must be tool_calls, received ${choice.finish_reason}.`);
  }

  const toolCall = choice.message?.tool_calls?.[0];
  if (!toolCall) {
    throw new Error("DeepSeek response did not include a first tool call.");
  }

  const toolName = toolCall.function?.name;
  if (toolName !== DELEGATION_TOOL_NAME) {
    throw new Error(`DeepSeek tool name must be ${DELEGATION_TOOL_NAME}, received ${toolName}.`);
  }

  const args = parseDelegationArguments(toolCall.function?.arguments);
  const cacheTelemetry = validateCacheTelemetry(response?.usage);

  return {
    finishReason: choice.finish_reason,
    toolName,
    args,
    cacheTelemetry,
  };
}

export function createDeepSeekToolSmokeRequest({
  model = DEFAULT_MODEL,
  createDelegateToSubagentTool,
  createOpenAiToolDefinitions,
}) {
  const delegateTool = createDelegateToSubagentTool();
  const tools = createOpenAiToolDefinitions([delegateTool]);

  return {
    model,
    stream: false,
    user_id: SYNTHETIC_USER_ID,
    messages: [
      {
        role: "system",
        content:
          "You are validating provider function calling only. Return the forced tool call with synthetic arguments. Do not perform business work.",
      },
      {
        role: "user",
        content:
          `Synthetic smoke validation only. Delegate a proposal-only investigation to lane ${SYNTHETIC_LANE_ID} ` +
          `with scope "${SYNTHETIC_SCOPE}" and evidence ID ${SYNTHETIC_EVIDENCE_ID}.`,
      },
    ],
    tools,
    tool_choice: {
      type: "function",
      function: { name: DELEGATION_TOOL_NAME },
    },
  };
}

export function formatSmokeEvidence({ model, validation }) {
  return {
    model,
    finish_reason: validation.finishReason,
    tool_name: validation.toolName,
    user_id: SYNTHETIC_USER_ID,
    cache_telemetry: validation.cacheTelemetry,
  };
}

async function loadRuntimeDependencies() {
  const [{ default: OpenAI }, agent] = await Promise.all([import("openai"), import("@msl/agent")]);
  return {
    OpenAI,
    createDelegateToSubagentTool: agent.createDelegateToSubagentTool,
    createOpenAiToolDefinitions: agent.createOpenAiToolDefinitions,
  };
}

export async function runDeepSeekToolSmoke({ env = process.env, dependencies } = {}) {
  assertLiveSmokeEnv(env);

  const runtime = dependencies ?? (await loadRuntimeDependencies());
  const model = env.DEEPSEEK_SMOKE_MODEL ?? DEFAULT_MODEL;
  const client = new runtime.OpenAI({
    apiKey: env.DEEPSEEK_API_KEY,
    baseURL: env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
  });

  const request = createDeepSeekToolSmokeRequest({
    model,
    createDelegateToSubagentTool: runtime.createDelegateToSubagentTool,
    createOpenAiToolDefinitions: runtime.createOpenAiToolDefinitions,
  });
  const response = await client.chat.completions.create(request);
  const validation = validateToolCallResponse(response);

  return formatSmokeEvidence({ model, validation });
}

async function main() {
  try {
    const evidence = await runDeepSeekToolSmoke();
    console.log("DeepSeek tool-call smoke passed:");
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DeepSeek smoke failure.";
    console.error(`DeepSeek tool-call smoke failed: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
