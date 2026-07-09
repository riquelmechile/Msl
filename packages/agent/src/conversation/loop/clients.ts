import OpenAI from "openai";
import { getDeepSeekClient as getSharedDeepSeekClient } from "../deepseekClient.js";
import { resolveDeepSeekRuntimeConfig, type DeepSeekRuntimeConfig } from "../deepseekRuntime.js";
import type { DeepSeekTransport, DeepSeekChatRequest } from "../transports/deepseekTransport.js";
import type { ToolDefinition } from "../tools.js";

// ── Types ──────────────────────────────────────────────────────────────

export type OpenAiFunctionToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/** Return type for the LLM client's chat method. */
export type LlmChatResult = {
  content: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
  usage?: {
    provider: string;
    model: string;
    usage: Record<string, unknown>;
  };
};

// ── Tool definitions ───────────────────────────────────────────────────

export function createOpenAiToolDefinitions(
  tools: Iterable<ToolDefinition>,
): OpenAiFunctionToolDefinition[] {
  return Array.from(tools, (tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// ── DeepSeek client ────────────────────────────────────────────────────

/**
 * Creates an OpenAI-compatible client for the DeepSeek API.
 *
 * @deprecated Use `createLlmClientFromTransport` with a DeepSeekTransport instead.
 * This function will be removed in a future version.
 */
export function createDeepSeekClient(
  runtime: DeepSeekRuntimeConfig = resolveDeepSeekRuntimeConfig(),
): OpenAI | null {
  if (!runtime.apiKey) return null;
  return getSharedDeepSeekClient(runtime.apiKey, runtime.baseURL);
}

// ── Transport-based LlmClient ──────────────────────────────────────────

/**
 * Wraps a DeepSeekTransport into the LlmClient interface.
 *
 * This is the preferred way to create an LLM client. Use
 * `createDeepSeekProviderFromEnv(process.env)` to obtain a transport,
 * then pass it to this function.
 */
export function createLlmClientFromTransport(
  transport: DeepSeekTransport,
  model: string,
  toolMap: Map<string, ToolDefinition>,
  userId?: string,
  sellerId?: string,
) {
  const openAiTools = createOpenAiToolDefinitions(toolMap.values());

  const extraBody: Record<string, string> | undefined = userId?.trim()
    ? { user_id: userId.trim() }
    : undefined;

  void sellerId; // kept for future routing — reserved parameter

  return {
    async chat(messages: Array<{ role: string; content: string }>): Promise<LlmChatResult> {
      const request: DeepSeekChatRequest = {
        model,
        messages,
        stream: false,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: "auto" as const } : {}),
        ...(extraBody ? { extra_body: extraBody } : {}),
      };

      const response = await transport.createChatCompletion(request);

      const choice = response.choices[0];
      const toolCalls = choice?.message?.tool_calls?.map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          /* invalid JSON — return empty args */
        }
        return { name: tc.function.name, arguments: args };
      });

      const result: LlmChatResult = {
        content: choice?.message?.content ?? "",
      };
      if (toolCalls && toolCalls.length > 0) {
        result.toolCalls = toolCalls;
      }
      if (response.usage) {
        result.usage = {
          provider: "deepseek",
          model,
          usage: response.usage,
        };
      }
      return result;
    },

    async *stream(messages: Array<{ role: string; content: string }>) {
      const request: DeepSeekChatRequest = {
        model,
        messages,
        stream: true,
        ...(openAiTools.length > 0 ? { tools: openAiTools, tool_choice: "auto" as const } : {}),
        ...(extraBody ? { extra_body: extraBody } : {}),
      };

      for await (const chunk of transport.streamChatCompletion(request)) {
        yield chunk;
      }
    },
  };
}
