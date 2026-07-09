// ── Error types ────────────────────────────────────────────────────────

export type DeepSeekErrorCategory =
  | "invalid_request"
  | "auth_error"
  | "insufficient_balance"
  | "invalid_params"
  | "rate_limited"
  | "provider_retryable"
  | "unknown";

export class DeepSeekRequestError extends Error {
  readonly category: DeepSeekErrorCategory;
  readonly statusCode: number;

  constructor(category: DeepSeekErrorCategory, message: string, statusCode: number) {
    super(message);
    this.name = "DeepSeekRequestError";
    this.category = category;
    this.statusCode = statusCode;
  }
}

// ── Error classifier ──────────────────────────────────────────────────

/**
 * Maps DeepSeek HTTP status codes to error categories.
 * Body parameter reserved for future use (e.g. parsing DeepSeek-specific error payloads).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function classifyDeepSeekError(status: number, body?: unknown): DeepSeekErrorCategory {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "auth_error";
    case 402:
      return "insufficient_balance";
    case 422:
      return "invalid_params";
    case 429:
      return "rate_limited";
    case 500:
      return "provider_retryable";
    case 503:
      return "provider_retryable";
    default:
      return "unknown";
  }
}
