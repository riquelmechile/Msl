import {
  DeepSeekFakeTransport,
  DeepSeekRealTransport,
  type DeepSeekTransport,
} from "./deepseekTransport.js";

/**
 * Creates a DeepSeek transport from environment variables.
 *
 * If DEEPSEEK_API_KEY is present, returns a DeepSeekRealTransport configured from
 * DEEPSEEK_BASE_URL (defaults to https://api.deepseek.com). Otherwise returns a
 * DeepSeekFakeTransport for safe no-network operation.
 */
export function createDeepSeekProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): DeepSeekTransport {
  const apiKey = env["DEEPSEEK_API_KEY"]?.trim();
  if (apiKey) {
    const baseURL = env["DEEPSEEK_BASE_URL"]?.trim() ?? "https://api.deepseek.com";
    return new DeepSeekRealTransport(apiKey, baseURL);
  }

  return new DeepSeekFakeTransport();
}
