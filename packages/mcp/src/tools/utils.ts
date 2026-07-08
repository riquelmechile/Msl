import type { McpServerConfig } from "../index.js";

// ── Shared result helpers ────────────────────────────────────────────

export type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export function jsonResult(value: unknown, isError = false): McpToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function unauthorizedResult(): McpToolResult {
  return blockedResult(
    "unauthorized",
    "Unauthorized MCP request. Provide a valid MSL MCP API key.",
  );
}

export type SyncProductBlockedReason =
  | "unauthorized"
  | "missing-account-roles"
  | "unsafe-direction"
  | "missing-target"
  | "invalid-target"
  | "missing-rationale"
  | "missing-evidence"
  | "credential-like-payload"
  | "invalid-expires-at"
  | "expired-proposal"
  | "approval-required"
  | "invalid-risk"
  | "unsupported-sync-intent"
  | "unsupported-site"
  | "unsupported-target"
  | "reserved-action-id"
  | "prepare-write-unavailable"
  | "prepare-write-failed";

export function blockedResult(reason: SyncProductBlockedReason, message: string): McpToolResult {
  return jsonResult({ status: "blocked", reason, message }, true);
}

// ── Shared utilities ─────────────────────────────────────────────────

export function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

export function parseStrictIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return parsed.toISOString() === normalized ? parsed : null;
}

export function approvalStorageMetadata(storage: McpServerConfig["approvalStorage"]): {
  approvalPersistence: "in-memory-only" | "sqlite" | "sqlite-unavailable";
  persistentApprovalStorage: boolean;
  approvalStorageDegraded?: true;
} {
  if (storage === "sqlite") {
    return { approvalPersistence: "sqlite", persistentApprovalStorage: true };
  }

  if (storage === "sqlite-unavailable") {
    return {
      approvalPersistence: "sqlite-unavailable",
      persistentApprovalStorage: false,
      approvalStorageDegraded: true,
    };
  }

  return { approvalPersistence: "in-memory-only", persistentApprovalStorage: false };
}

// ── Credential-like content detection (shared by writeTools + productAdsTools) ──

const CREDENTIAL_LIKE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth|client[_-]?secret|secret|password|passwd|credential|db[_-]?path|database[_-]?(?:path|url)|sqlite)/i;
const CREDENTIAL_LIKE_VALUE_PATTERNS = [
  /^(?:api[_-]?key|msl[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|password|passwd|credential|db[_-]?path|database[_-]?(?:path|url)|sqlite)$/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|password|credential|db\s*path|db[_-]?path|database\s*path|database[_-]?path)\s*[:=]/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:sk|pk|xox[baprs]|gh[pousr])_[A-Za-z0-9_=-]{12,}\b/i,
  /\b[A-Za-z0-9._%+-]+\.(?:sqlite|sqlite3|db)\b/i,
  /(?:^|\s)(?:sqlite|file):\/\//i,
  /(?:^|\s)(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)\.(?:sqlite|sqlite3|db)\b/i,
];

export function containsCredentialLikeContent(value: unknown): boolean {
  if (typeof value === "string") {
    return CREDENTIAL_LIKE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsCredentialLikeContent(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        CREDENTIAL_LIKE_KEY_PATTERN.test(key) || containsCredentialLikeContent(child),
    );
  }

  return false;
}
