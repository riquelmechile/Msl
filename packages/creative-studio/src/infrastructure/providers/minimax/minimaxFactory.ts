import { MinimaxClient } from "./minimax-client.js";
import {
  MinimaxFakeTransport,
  MinimaxRealTransport,
  type MinimaxTransport,
} from "./minimaxTransport.js";

/**
 * Creates a MiniMax transport from environment variables.
 *
 * If MINIMAX_API_KEY is present, returns a MinimaxRealTransport configured from
 * MINIMAX_API_HOST (or MINIMAX_BASE_URL) with a default 30s timeout.
 * Otherwise returns a MinimaxFakeTransport for safe no-network operation.
 */
export function createMinimaxProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): MinimaxTransport {
  const apiKey = env["MINIMAX_API_KEY"]?.trim();
  if (apiKey) {
    const apiHost =
      env["MINIMAX_API_HOST"]?.trim() ||
      env["MINIMAX_BASE_URL"]?.trim() ||
      "https://api.minimaxi.com";

    const client = new MinimaxClient({
      apiKey,
      apiHost,
      timeoutMs: 30000,
    });

    return new MinimaxRealTransport(client);
  }

  return new MinimaxFakeTransport();
}
