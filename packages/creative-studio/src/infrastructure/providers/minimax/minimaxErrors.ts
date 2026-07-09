// ── Error types ────────────────────────────────────────────────────────

export type MinimaxErrorCategory =
  | "auth_error"
  | "rate_limited"
  | "insufficient_balance"
  | "content_blocked"
  | "invalid_request"
  | "provider_error"
  | "unknown";

export class MinimaxRequestError extends Error {
  readonly category: MinimaxErrorCategory;
  readonly statusCode: number;

  constructor(category: MinimaxErrorCategory, message: string, statusCode: number) {
    super(message);
    this.name = "MinimaxRequestError";
    this.category = category;
    this.statusCode = statusCode;
  }
}

// ── MiniMax error codes (internal mapping) ────────────────────────────

const MINIMAX_CODE_MAP: Record<number, MinimaxErrorCategory> = {
  1004: "auth_error",
  2049: "auth_error",
  1002: "rate_limited",
  1008: "insufficient_balance",
  1026: "content_blocked",
  1027: "content_blocked",
  2013: "invalid_request",
};

// ── Error classifier ─────────────────────────────────────────────────

/**
 * Classifies a MiniMax error from either HTTP status codes or MiniMax API-level error codes.
 *
 * Looks at the body for a `base_resp.status_code` field to resolve MiniMax-specific codes.
 * Falls back to HTTP status code classification for OpenAI-compatible endpoints.
 */
export function classifyMinimaxError(statusCode: number, body?: unknown): MinimaxErrorCategory {
  // Try MiniMax API-level error codes from body
  if (typeof body === "object" && body !== null) {
    const baseResp = (body as Record<string, unknown>)["base_resp"] as
      { status_code?: number } | undefined;
    if (baseResp?.status_code !== undefined && baseResp.status_code !== 0) {
      const mapped = MINIMAX_CODE_MAP[baseResp.status_code];
      if (mapped) return mapped;
    }
  }

  // HTTP status code classification (for OpenAI-compatible endpoints)
  switch (statusCode) {
    case 401:
      return "auth_error";
    case 429:
      return "rate_limited";
    case 400:
      return "invalid_request";
    case 500:
    case 503:
      return "provider_error";
    default:
      return "unknown";
  }
}
