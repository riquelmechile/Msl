const MAX_TOOL_ERROR_TEXT_LENGTH = 500;
const TRUNCATED_SUFFIX = "… [truncated]";

const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]"],
  [/(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/gi, "$1://[REDACTED]"],
  [
    /(["']?\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|password|[a-z0-9_-]*secret[a-z0-9_-]*)\b["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi,
    "$1[REDACTED]",
  ],
  [
    /\b(access_token|refresh_token|id_token|api_key|client_secret|password|[a-z0-9_-]*secret[a-z0-9_-]*)=([^\s&]+)/gi,
    "$1=[REDACTED]",
  ],
];

function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => {
    return text.replace(pattern, replacement);
  }, value);
}

/**
 * Produces short, safe error text for tool output and Cortex persistence.
 *
 * Tool errors may be forwarded to the LLM and persisted by Escribano, so raw
 * upstream strings must not leak bearer tokens, access tokens, or oversized
 * response dumps.
 */
export function sanitizeToolErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const singleLine = raw.replace(/\s+/g, " ").trim();
  const redacted = redactSecrets(singleLine);

  if (redacted.length <= MAX_TOOL_ERROR_TEXT_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_TOOL_ERROR_TEXT_LENGTH - TRUNCATED_SUFFIX.length)}${TRUNCATED_SUFFIX}`;
}

export function sanitizeReturnedToolIssueEntry(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const endpoint = entry.endpoint;
  const message = entry.message;

  if (typeof endpoint === "string") sanitized.endpoint = endpoint;
  if (message !== undefined) sanitized.message = sanitizeToolErrorText(message);

  return sanitized;
}
