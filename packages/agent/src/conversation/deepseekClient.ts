import OpenAI from "openai";

let sharedClient: OpenAI | null = null;

/**
 * Returns a shared singleton OpenAI client configured for the DeepSeek API.
 *
 * Uses a single TCP connection + TLS handshake across all callers instead of
 * creating separate instances per module. The singleton is lazily created on
 * first call and reused for the lifetime of the process.
 *
 * @param apiKey DeepSeek API key.
 * @param baseURL DeepSeek base URL (defaults to https://api.deepseek.com).
 * @returns The shared OpenAI client instance.
 */
export function getDeepSeekClient(apiKey: string, baseURL?: string): OpenAI {
  if (!sharedClient) {
    sharedClient = new OpenAI({
      apiKey,
      baseURL: baseURL ?? "https://api.deepseek.com",
      maxRetries: 3,
      timeout: 60000,
    });
  }
  return sharedClient;
}

/** For testing — reset the singleton so the next call creates a fresh client. */
export function resetDeepSeekClient(): void {
  sharedClient = null;
}
