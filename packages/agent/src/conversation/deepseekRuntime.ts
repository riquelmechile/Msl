export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
export const DEEPSEEK_BASE_URL_ENV = "DEEPSEEK_BASE_URL";
export const DEEPSEEK_MODEL_ENV = "DEEPSEEK_MODEL";

export type DeepSeekEnv = Partial<
  Pick<NodeJS.ProcessEnv, "DEEPSEEK_API_KEY" | "DEEPSEEK_BASE_URL" | "DEEPSEEK_MODEL">
>;

export type DeepSeekRuntimeConfig = {
  apiKey?: string;
  baseURL: string;
  model: string;
  credentialRef?: string;
};

export type DeepSeekRoutingInput = {
  laneId?: string;
  sellerId?: string;
  agentId?: string;
};

export function resolveDeepSeekRuntimeConfig(env: DeepSeekEnv = process.env): DeepSeekRuntimeConfig {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  const baseURL = env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_DEEPSEEK_BASE_URL;
  const model = env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;

  return {
    ...(apiKey ? { apiKey, credentialRef: `env:${DEEPSEEK_API_KEY_ENV}` } : {}),
    baseURL,
    model,
  };
}

export function resolveDeepSeekCredentialRef(
  input: DeepSeekRoutingInput & { envKey?: string } = {},
): string {
  const lane = sanitizeDeepSeekUserIdPart(input.laneId ?? "ceo");
  const seller = sanitizeDeepSeekUserIdPart(input.sellerId ?? "global");
  const agent = input.agentId ? `:agent:${sanitizeDeepSeekUserIdPart(input.agentId)}` : "";
  return `env:${input.envKey ?? DEEPSEEK_API_KEY_ENV}:lane:${lane}:seller:${seller}${agent}`;
}

export function resolveDeepSeekUserId(input: DeepSeekRoutingInput = {}): string {
  const lane = sanitizeDeepSeekUserIdPart(input.laneId ?? "ceo");
  const seller = sanitizeDeepSeekUserIdPart(input.sellerId ?? "global");
  const agent = input.agentId ? `-agent-${sanitizeDeepSeekUserIdPart(input.agentId)}` : "";
  return truncateStableUserId(`msl-lane-${lane}-seller-${seller}${agent}`);
}

export function deepSeekChatCompletionExtraBody(userId?: string): Record<string, string> | undefined {
  const normalized = userId?.trim();
  return normalized ? { user_id: normalized } : undefined;
}

export function buildDeepSeekChatCompletionRequest<T extends Record<string, unknown>>(
  input: T & { userId?: string },
): T & { extra_body?: Record<string, string> } {
  const { userId, ...request } = input;
  const extraBody = deepSeekChatCompletionExtraBody(userId);
  return extraBody ? ({ ...request, extra_body: extraBody } as T & { extra_body: Record<string, string> }) : (request as T);
}

function sanitizeDeepSeekUserIdPart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return sanitized || "unknown";
}

function truncateStableUserId(value: string): string {
  return value.length <= 128 ? value : value.slice(0, 128).replace(/-+$/g, "");
}
