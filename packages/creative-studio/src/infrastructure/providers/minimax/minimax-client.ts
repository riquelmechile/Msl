

// ── MiniMax API error codes ──────────────────────────────────────────

export type MinimaxErrorCode =
  | 0 // success
  | 1002 // rate limit
  | 1004 // auth failure
  | 1008 // insufficient balance
  | 1026 // content safety
  | 2049; // token auth failure (alternative)

export type MinimaxStatusCategory =
  | "success"
  | "auth_error"
  | "rate_limited"
  | "insufficient_balance"
  | "content_blocked"
  | "provider_error";

export type MinimaxApiError = {
  status_code: MinimaxErrorCode;
  status_message: string;
}

export type MinimaxBaseResponse = {
  base_resp: MinimaxApiError;
}

// ── Client ───────────────────────────────────────────────────────────

export type MinimaxClientConfig = {
  apiKey: string;
  apiHost: string;
  timeoutMs: number;
}

export class MinimaxClient {
  private readonly apiKey: string;
  private readonly apiHost: string;
  private readonly timeoutMs: number;

  constructor(config: MinimaxClientConfig) {
    if (!config.apiKey) {
      throw new Error(
        "MinimaxClient: apiKey is required. Set MINIMAX_API_KEY environment variable.",
      );
    }
    this.apiKey = config.apiKey;
    this.apiHost = config.apiHost.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
  }

  /**
   * Generic HTTP POST to the MiniMax API.
   * Handles auth headers, timeout, and error classification.
   */
  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.apiHost}${path.startsWith("/") ? path : `/${path}`}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(bodyText);  // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      } catch {
        // Non-JSON response
        throw classifyError(0, `Non-JSON response (${response.status}): ${bodyText.slice(0, 200)}`);
      }

      const maybeBaseResp = (data)["base_resp"] as
        MinimaxApiError | undefined;

      // Check HTTP-level errors first
      if (response.status === 401) {
        throw classifyError(1004, maybeBaseResp?.status_message ?? "Unauthorized");
      }
      if (response.status === 429) {
        throw classifyError(1002, maybeBaseResp?.status_message ?? "Rate limited");
      }
      if (!response.ok) {
        throw classifyError(0, `HTTP ${response.status}: ${bodyText.slice(0, 200)}`);
      }

      // Check MiniMax API-level errors
      if (
        maybeBaseResp &&
        maybeBaseResp.status_code !== 0 &&
        maybeBaseResp.status_code !== undefined
      ) {
        throw classifyError(maybeBaseResp.status_code, data as unknown as MinimaxBaseResponse);
      }

      return data as T;
    } catch (err) {
      if (err instanceof MinimaxRequestError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new MinimaxRequestError(
          "provider_error",
          `Request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new MinimaxRequestError(
        "provider_error",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ── Error class ──────────────────────────────────────────────────────

export class MinimaxRequestError extends Error {
  readonly category: MinimaxStatusCategory;
  readonly statusCode?: MinimaxErrorCode;

  constructor(category: MinimaxStatusCategory, message: string, statusCode?: MinimaxErrorCode) {
    super(message);
    this.name = "MinimaxRequestError";
    this.category = category;
    if (statusCode !== undefined) {
      this.statusCode = statusCode;
    }
  }
}

// ── Error classifier ─────────────────────────────────────────────────

function classifyError(
  statusCode: MinimaxErrorCode | 0,
  responseOrMessage: MinimaxBaseResponse | string,
): MinimaxRequestError {
  const message =
    typeof responseOrMessage === "string"
      ? responseOrMessage
      : (responseOrMessage.base_resp?.status_message ?? "Unknown MiniMax error");

  switch (statusCode) {
    case 1004:
    case 2049:
      return new MinimaxRequestError("auth_error", message, statusCode);
    case 1002:
      return new MinimaxRequestError("rate_limited", message, statusCode);
    case 1008:
      return new MinimaxRequestError("insufficient_balance", message, statusCode);
    case 1026:
      return new MinimaxRequestError("content_blocked", message, statusCode);
    default:
      return new MinimaxRequestError("provider_error", message, statusCode);
  }
}
