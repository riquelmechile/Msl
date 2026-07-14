type EconomicSanitizedPrimitive = null | boolean | number | string;
export type EconomicSanitizedRecord = {
  readonly [key: string]: EconomicSanitizedValue;
};
export type EconomicSanitizedList = ReadonlyArray<EconomicSanitizedValue>;
export type EconomicSanitizedValue =
  EconomicSanitizedPrimitive | EconomicSanitizedList | EconomicSanitizedRecord;

const LIMITS = {
  maxDepth: 6,
  maxObjectKeys: 50,
  maxArrayItems: 50,
  maxStringLength: 300,
  maxOutputCharacters: 10_000,
  maxNodes: 1_000,
} as const;

const POLLUTION_KEY = /^(?:__proto__|prototype|constructor)$/i;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER = /\bbearer\s+[a-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){2}\b/g;
const CREDENTIAL_URL = /\bhttps?:\/\/[^\s/@]+:[^\s/@]+@[^\s/]+[^\s]*/gi;
const SENSITIVE_ASSIGNMENT =
  /\b(?:access[_-]?token|refresh[_-]?token|token|authorization|cookie|client[_-]?secret|secret|password|api[_-]?key|encryption[_-]?key|oauth[_-]?state|raw(?:[_-]?payload)?|payload|request|response|body)\s*[=:]\s*[^\s,;]+/gi;
const SENSITIVE_QUERY =
  /([?&](?:access[_-]?token|refresh[_-]?token|token|authorization|cookie|client[_-]?secret|secret|password|api[_-]?key|encryption[_-]?key|oauth[_-]?state)=)[^&#\s]*/gi;
const INTERNAL_PATH = /(?:^|\s)(?:\/[\w.-]+){2,}(?::\d+(?::\d+)?)?/g;
const STACK_LINE = /^\s*at\s+.*$/gim;
const SECRET_LIKE_LONG_VALUE = /\b(?:[A-Za-z0-9+/_=-]{32,})\b/g;

type SanitizationState = {
  remainingNodes: number;
  seen: WeakSet<object>;
};

function consumeNode(state: SanitizationState): boolean {
  if (state.remainingNodes <= 0) return false;
  state.remainingNodes -= 1;
  return true;
}

function sanitizeEconomicString(value: string): string {
  const boundedInput = value.slice(0, LIMITS.maxStringLength + 1);
  const sanitized = boundedInput
    .replace(STACK_LINE, "[stack]")
    .replace(CREDENTIAL_URL, "[credential-url]")
    .replace(SENSITIVE_QUERY, "$1[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[jwt]")
    .replace(EMAIL, "[email]")
    .replace(SENSITIVE_ASSIGNMENT, (match) => `${match.split(/[=:]/, 1)[0]}=[redacted]`)
    .replace(INTERNAL_PATH, " [path]")
    .replace(SECRET_LIKE_LONG_VALUE, "[redacted]")
    .trim();
  return sanitized.length > LIMITS.maxStringLength
    ? `${sanitized.slice(0, LIMITS.maxStringLength - 1)}…`
    : sanitized;
}

function isPlainObject(value: object): boolean {
  try {
    const prototype: object | null = Reflect.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replaceAll(/[_-]/g, "").toLowerCase();
  return new Set([
    "accesstoken",
    "refreshtoken",
    "token",
    "authorization",
    "cookie",
    "clientsecret",
    "secret",
    "password",
    "apikey",
    "encryptionkey",
    "oauthstate",
    "headers",
    "raw",
    "rawpayload",
    "payload",
    "request",
    "response",
    "body",
    "buyer",
    "email",
    "phone",
    "address",
    "document",
    "rut",
    "firstname",
    "lastname",
  ]).has(normalized);
}

function sanitizeValue(
  value: unknown,
  state: SanitizationState,
  depth: number,
): EconomicSanitizedValue {
  if (!consumeNode(state)) return "[node-budget-exhausted]";
  if (value === null) return null;
  if (typeof value === "string") return sanitizeEconomicString(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[non-finite-number]";
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    return `[unsupported:${typeof value}]`;
  }
  if (depth >= LIMITS.maxDepth) return "[max-depth]";
  if (value instanceof Error) return sanitizeError(value);
  if (state.seen.has(value)) return "[cycle]";
  state.seen.add(value);

  if (Array.isArray(value)) return sanitizeArray(value, state, depth + 1);
  if (!isPlainObject(value)) return "[unsupported-object]";
  return sanitizeObject(value, state, depth + 1);
}

function sanitizeError(error: Error): EconomicSanitizedRecord {
  const descriptor = Object.getOwnPropertyDescriptor(error, "message");
  return {
    name: "Error",
    message:
      descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
        ? sanitizeEconomicString(descriptor.value)
        : "[error]",
  };
}

function sanitizeArray(
  values: readonly unknown[],
  state: SanitizationState,
  depth: number,
): EconomicSanitizedList {
  const result: EconomicSanitizedValue[] = [];
  const length = Math.min(values.length, LIMITS.maxArrayItems);
  for (let index = 0; index < length; index += 1) {
    try {
      result.push(sanitizeValue(values.at(index), state, depth));
    } catch {
      result.push("[unreadable]");
    }
  }
  if (values.length > LIMITS.maxArrayItems) result.push("[truncated-items]");
  return result;
}

function sanitizeObject(
  value: object,
  state: SanitizationState,
  depth: number,
): EconomicSanitizedRecord {
  const result: Record<string, EconomicSanitizedValue> = {};
  let keys: string[];
  try {
    keys = Object.getOwnPropertyNames(value).sort().slice(0, LIMITS.maxObjectKeys);
  } catch {
    return { value: "[unreadable-object]" };
  }
  for (const key of keys) {
    if (POLLUTION_KEY.test(key)) continue;
    if (isSensitiveKey(key)) {
      result[key] = "[redacted]";
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      result[key] = "[getter-omitted]";
      continue;
    }
    result[key] = sanitizeValue(descriptor.value, state, depth);
  }
  return result;
}

/** Produces a bounded JSON-safe economic boundary value without reading getters. */
export function sanitizeEconomicDetails(value: unknown): EconomicSanitizedValue {
  const sanitized = sanitizeValue(
    value,
    { remainingNodes: LIMITS.maxNodes, seen: new WeakSet() },
    0,
  );
  return enforceOutputBudget(sanitized);
}

/**
 * Enforces the public 10,000-character JSON serialization budget after every
 * value, key, delimiter, number, boolean, null, and truncation marker exists.
 * The node cap above prevents adversarial nested containers from consuming
 * unbounded CPU or memory before this exact final serialization check.
 */
function enforceOutputBudget(value: EconomicSanitizedValue): EconomicSanitizedValue {
  try {
    if (JSON.stringify(value).length <= LIMITS.maxOutputCharacters) return value;
  } catch {
    // Sanitized values are designed to stringify, but retain a safe boundary
    // if a hostile platform object violates that assumption.
  }
  return { truncated: "[output-budget-exhausted]" };
}

/** Produces a bounded JSON-safe record for CLI result envelopes. */
export function sanitizeEconomicRecord(value: unknown): EconomicSanitizedRecord {
  const sanitized = sanitizeEconomicDetails(value);
  if (isSanitizedRecord(sanitized)) {
    return sanitized;
  }
  return { value: sanitized };
}

function isSanitizedRecord(value: EconomicSanitizedValue): value is EconomicSanitizedRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Backwards-compatible alias for existing economic output callers. */
export function sanitizeEconomicOutput(value: unknown): EconomicSanitizedValue {
  return sanitizeEconomicDetails(value);
}

/** Produces a bounded error message that cannot reveal PII, credentials, or stack paths. */
export function safeEconomicErrorMessage(error: unknown): string {
  const sanitized = sanitizeEconomicDetails(error);
  if (typeof sanitized === "string") return sanitized;
  if (isSanitizedRecord(sanitized)) {
    const message = sanitized.message;
    return typeof message === "string" ? message : "Economic operation failed.";
  }
  return "Economic operation failed.";
}
