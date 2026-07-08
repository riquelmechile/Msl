import OpenAI from "openai";
import { getDeepSeekClient as getSharedDeepSeekClient } from "../deepseekClient.js";
import { resolveDeepSeekRuntimeConfig, type DeepSeekRuntimeConfig } from "../deepseekRuntime.js";
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

export function createDeepSeekClient(
  runtime: DeepSeekRuntimeConfig = resolveDeepSeekRuntimeConfig(),
): OpenAI | null {
  if (!runtime.apiKey) return null;
  return getSharedDeepSeekClient(runtime.apiKey, runtime.baseURL);
}
