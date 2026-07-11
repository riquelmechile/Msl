import { createLogger } from "../conversation/observability.js";
import type { Logger } from "../conversation/observability.js";

// ── Types ────────────────────────────────────────────────────────────

/**
 * Structured logger for daemons and stores.
 *
 * Every log entry emitted via `info`, `warn`, or `error` is a JSON object
 * containing `{ level, component, msg, ts, correlationId }`.  Context
 * objects are sanitised before emission: secrets are redacted and
 * `prompt`/`content` keys are stripped.
 */
export interface DaemonLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}

/** Store-level logger — same shape as {@link DaemonLogger}. */
export type StoreLogger = DaemonLogger;

// ── Sensitive-key detection ──────────────────────────────────────────

/** Keys that MUST be redacted to `"[REDACTED]"`. */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();

  // "key" as a standalone word boundary — catches apiKey, access_key, etc.
  if (lower === "key" || lower.endsWith("_key")) return true;

  // CamelCase Key suffix — apiKey, accessKey, secretKey, …
  if (/[A-Z]key$/i.test(key)) return true;

  if (lower.includes("token")) return true;
  if (lower.includes("secret")) return true;
  if (lower.includes("password")) return true;
  if (lower.includes("credential")) return true;
  if (lower.includes("authorization")) return true;
  if (lower === "auth" || lower.startsWith("auth_")) return true;
  if (lower === "apikey" || lower.includes("api_key")) return true;

  return false;
}

/** Keys that MUST be redacted to `"[REDACTED: prompt]"`. */
const PROMPT_CONTENT_KEYS = new Set(["prompt", "content"]);

function isPromptContentKey(key: string): boolean {
  return PROMPT_CONTENT_KEYS.has(key);
}

// ── Sanitizer ────────────────────────────────────────────────────────

/**
 * Recursively sanitise a log-context object.
 *
 * - `prompt` and `content` keys are replaced with `"[REDACTED: prompt]"`.
 * - Keys matching API-key / token / secret patterns are replaced with
 *   `"[REDACTED]"`.
 * - Nested objects and arrays are traversed recursively.
 * - Primitives pass through unchanged.
 * - `null` and `undefined` pass through unchanged.
 */
export function sanitizeContext(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeContext);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isPromptContentKey(key)) {
      result[key] = "[REDACTED: prompt]";
      continue;
    }
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    if (typeof value === "object" && value !== null) {
      result[key] = sanitizeContext(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── No-op logger ─────────────────────────────────────────────────────

function noopLogger(): DaemonLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

// ── Logger factories ─────────────────────────────────────────────────

/**
 * Create a structured logger for a daemon handler.
 *
 * @param name         Component name used in the `component` field.
 * @param correlationId  UUID v4 generated at the entry-point of the daemon
 *                       handler invocation.  All log entries produced by
 *                       this logger instance will carry this ID.
 *
 * When `MSL_STRUCTURED_LOGGING_ENABLED` is not `"true"` the returned
 * logger is a no-op.
 */
export function createDaemonLogger(
  name: string,
  correlationId: string,
): DaemonLogger {
  const enabled = process.env.MSL_STRUCTURED_LOGGING_ENABLED === "true";
  if (!enabled) return noopLogger();

  const base: Logger = createLogger(name);

  return {
    info(msg: string, ctx?: Record<string, unknown>): void {
      const sanitized = ctx
        ? (sanitizeContext(ctx) as Record<string, unknown>)
        : undefined;
      base.info(msg, { ...sanitized, correlationId });
    },

    warn(msg: string, ctx?: Record<string, unknown>): void {
      const sanitized = ctx
        ? (sanitizeContext(ctx) as Record<string, unknown>)
        : undefined;
      base.warn(msg, { ...sanitized, correlationId });
    },

    error(msg: string, err?: Error, ctx?: Record<string, unknown>): void {
      const sanitized = ctx
        ? (sanitizeContext(ctx) as Record<string, unknown>)
        : undefined;
      base.error(msg, err, { ...sanitized, correlationId });
    },
  };
}

/**
 * Create a structured logger for a store module.
 *
 * Behaviour is identical to {@link createDaemonLogger}: the underlying
 * {@link createLogger} is shared, and both daemon and store loggers carry
 * the same `correlationId` when wired through the daemon handler.
 *
 * @param name         Component name (e.g. `"economic-outcome-store"`).
 * @param correlationId  Inherited from the daemon handler invocation.
 */
export function createStoreLogger(
  name: string,
  correlationId: string,
): StoreLogger {
  return createDaemonLogger(name, correlationId);
}
