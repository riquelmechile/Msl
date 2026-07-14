import { createHash } from "node:crypto";

/** Sources that can contribute to an economic ingestion run. */
export const SOURCE_FETCH_KINDS = ["orders", "claims", "items", "product-ads"] as const;
export type SourceFetchKind = (typeof SOURCE_FETCH_KINDS)[number];

/**
 * `success-empty` is the only successful result without records. Every other
 * status represents unavailable, incomplete, or cancelled source work.
 */
export const SOURCE_FETCH_STATUSES = [
  "success-with-data",
  "success-empty",
  "unavailable",
  "unauthorized",
  "forbidden",
  "rate-limited",
  "source-timeout",
  "transient-failure",
  "malformed-response",
  "aborted",
] as const;
export type SourceFetchStatus = (typeof SOURCE_FETCH_STATUSES)[number];

/** Public-safe reason codes. Never attach provider errors, payloads, or headers. */
export const SOURCE_FETCH_REASON_CODES = [
  "no-records",
  "source-unavailable",
  "credentials-rejected",
  "access-denied",
  "rate-limit-exceeded",
  "retry-budget-exhausted",
  "request-timed-out",
  "temporary-provider-failure",
  "invalid-provider-response",
  "global-abort",
] as const;
export type SourceFetchReasonCode = (typeof SOURCE_FETCH_REASON_CODES)[number];

export type SourceFetchCursor = {
  readonly afterOccurredAt: number | null;
  readonly afterSourceRecordId: string | null;
};

type SourceFetchMetrics = {
  readonly source: SourceFetchKind;
  readonly observedAt: number;
  readonly attemptedAt: number | null;
  readonly attempts: number;
  readonly pages: number;
  readonly records: number;
  readonly cursor: SourceFetchCursor;
};

export type SourceFetchResult =
  | (SourceFetchMetrics & {
      readonly status: "success-with-data";
      readonly reasonCode: null;
      readonly retryable: false;
      readonly retryAfterMs: null;
    })
  | (SourceFetchMetrics & {
      readonly status: "success-empty";
      readonly reasonCode: "no-records";
      readonly retryable: false;
      readonly retryAfterMs: null;
    })
  | (SourceFetchMetrics & {
      readonly status: Exclude<SourceFetchStatus, "success-with-data" | "success-empty">;
      readonly reasonCode: Exclude<SourceFetchReasonCode, "no-records">;
      readonly retryable: boolean;
      readonly retryAfterMs: number | null;
    });

export type CreateSourceFetchResultInput = {
  readonly source: SourceFetchKind;
  readonly status: SourceFetchStatus;
  readonly reasonCode?: SourceFetchReasonCode;
  readonly observedAt: number;
  readonly attemptedAt?: number | null;
  readonly attempts: number;
  readonly pages: number;
  readonly records: number;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number | null;
  readonly cursor: SourceFetchCursor;
};

export type CreateSourceFetchResult =
  | { readonly success: true; readonly result: SourceFetchResult }
  | { readonly success: false; readonly reason: "invalid-source-fetch-result" };

export const MAX_SOURCE_FETCH_COUNTER = 1_000_000;
export const MAX_SOURCE_FETCH_CURSOR_ID_LENGTH = 256;
export const MAX_SOURCE_FETCH_RETRY_AFTER_MS = 86_400_000;

export function isSourceFetchKind(value: unknown): value is SourceFetchKind {
  return typeof value === "string" && SOURCE_FETCH_KINDS.includes(value as SourceFetchKind);
}

export function isSourceFetchResult(value: unknown): value is SourceFetchResult {
  if (!isPlainRecord(value)) return false;
  const allowedKeys = new Set([
    "status",
    "source",
    "reasonCode",
    "observedAt",
    "attemptedAt",
    "attempts",
    "pages",
    "records",
    "retryable",
    "retryAfterMs",
    "cursor",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (
    !isSourceFetchCursor(value.cursor) ||
    !isSourceFetchKind(value.source) ||
    !isSourceFetchStatus(value.status) ||
    !isFiniteEpoch(value.observedAt) ||
    !isResultNullableEpoch(value.attemptedAt) ||
    !isBoundedCounter(value.attempts) ||
    !isBoundedCounter(value.pages) ||
    !isBoundedCounter(value.records) ||
    (value.attempts === 0) !== (value.attemptedAt === null)
  )
    return false;
  if (value.status === "success-with-data") {
    return (
      value.records > 0 &&
      value.reasonCode === null &&
      value.retryable === false &&
      value.retryAfterMs === null
    );
  }
  if (value.status === "success-empty") {
    return (
      value.records === 0 &&
      value.reasonCode === "no-records" &&
      value.retryable === false &&
      value.retryAfterMs === null
    );
  }
  return (
    value.records === 0 &&
    isSourceFetchReasonCode(value.reasonCode) &&
    value.reasonCode !== "no-records" &&
    typeof value.retryable === "boolean" &&
    isResultNullableRetryAfter(value.retryAfterMs) &&
    (value.status !== "aborted" || (value.retryable === false && value.retryAfterMs === null))
  );
}

/** Creates a bounded, payload-free source-fetch outcome. */
export function createSourceFetchResult(
  input: CreateSourceFetchResultInput,
): CreateSourceFetchResult {
  const cursor = normalizeCursor(input.cursor);
  if (
    !isSourceFetchKind(input.source) ||
    !isSourceFetchStatus(input.status) ||
    !isFiniteEpoch(input.observedAt) ||
    !isNullableEpoch(input.attemptedAt) ||
    !isBoundedCounter(input.attempts) ||
    !isBoundedCounter(input.pages) ||
    !isBoundedCounter(input.records) ||
    cursor === null
  ) {
    return { success: false, reason: "invalid-source-fetch-result" };
  }

  const attemptedAt = input.attemptedAt ?? null;
  if ((input.attempts === 0) !== (attemptedAt === null)) {
    return { success: false, reason: "invalid-source-fetch-result" };
  }

  if (input.status === "success-with-data") {
    if (
      input.records === 0 ||
      (input.reasonCode !== undefined && input.reasonCode !== null) ||
      input.retryable === true
    ) {
      return { success: false, reason: "invalid-source-fetch-result" };
    }
    return {
      success: true,
      result: {
        ...commonResult(input, cursor, attemptedAt),
        status: "success-with-data",
        reasonCode: null,
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  if (input.status === "success-empty") {
    if (input.records !== 0 || input.reasonCode !== "no-records" || input.retryable === true) {
      return { success: false, reason: "invalid-source-fetch-result" };
    }
    return {
      success: true,
      result: {
        ...commonResult(input, cursor, attemptedAt),
        status: "success-empty",
        reasonCode: "no-records",
        retryable: false,
        retryAfterMs: null,
      },
    };
  }

  if (
    !isSourceFetchReasonCode(input.reasonCode) ||
    input.reasonCode === "no-records" ||
    input.records !== 0 ||
    (input.status === "aborted" && (input.retryable === true || input.retryAfterMs !== undefined))
  ) {
    return { success: false, reason: "invalid-source-fetch-result" };
  }

  const retryable = input.retryable ?? defaultRetryable(input.status);
  const retryAfterMs = input.retryAfterMs ?? null;
  if (!isNullableRetryAfter(retryAfterMs)) {
    return { success: false, reason: "invalid-source-fetch-result" };
  }
  return {
    success: true,
    result: {
      source: input.source,
      status: input.status,
      reasonCode: input.reasonCode,
      observedAt: input.observedAt,
      attemptedAt,
      attempts: input.attempts,
      pages: input.pages,
      records: input.records,
      retryable,
      retryAfterMs,
      cursor,
    },
  };
}

export type ClaimsBacklogIdentityInput = {
  readonly sellerId: string;
  readonly range: { readonly from: number | null; readonly to: number | null };
  readonly cursor: SourceFetchCursor;
};

export type ClaimsBacklogIdentity = {
  readonly source: "claims";
  readonly purpose: "claims-recovery";
  readonly key: string;
};

/** Computes the restart-stable, seller-scoped Claims backlog identity. */
export function createClaimsBacklogIdentity(
  input: ClaimsBacklogIdentityInput,
): ClaimsBacklogIdentity | null {
  if (
    !isBoundedIdentifier(input.sellerId) ||
    !isNullableEpoch(input.range.from) ||
    !isNullableEpoch(input.range.to) ||
    (input.range.from !== null && input.range.to !== null && input.range.from > input.range.to) ||
    normalizeCursor(input.cursor) === null
  ) {
    return null;
  }
  const cursor = normalizeCursor(input.cursor);
  if (cursor === null) return null;
  const tuple = [
    input.sellerId,
    "claims",
    nullableNumber(input.range.from),
    nullableNumber(input.range.to),
    nullableNumber(cursor.afterOccurredAt),
    cursor.afterSourceRecordId ?? "<null>",
    "claims-recovery",
  ];
  const canonical = tuple.map((field) => `${field.length}:${field}`).join("|");
  return {
    source: "claims",
    purpose: "claims-recovery",
    key: createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
}

function commonResult(
  input: CreateSourceFetchResultInput,
  cursor: SourceFetchCursor,
  attemptedAt: number | null,
): SourceFetchMetrics {
  return {
    source: input.source,
    observedAt: input.observedAt,
    attemptedAt,
    attempts: input.attempts,
    pages: input.pages,
    records: input.records,
    cursor,
  };
}

function normalizeCursor(cursor: Partial<SourceFetchCursor> | undefined): SourceFetchCursor | null {
  if (
    cursor === undefined ||
    !Object.hasOwn(cursor, "afterOccurredAt") ||
    !Object.hasOwn(cursor, "afterSourceRecordId")
  )
    return null;
  const afterOccurredAt = cursor.afterOccurredAt;
  const afterSourceRecordId = cursor.afterSourceRecordId;
  if (
    !isNullableEpoch(afterOccurredAt) ||
    (afterSourceRecordId !== null && !isBoundedIdentifier(afterSourceRecordId))
  )
    return null;
  return { afterOccurredAt, afterSourceRecordId };
}

function isSourceFetchCursor(value: unknown): value is SourceFetchCursor {
  if (!isPlainRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== "afterOccurredAt" && key !== "afterSourceRecordId"))
    return false;
  return (
    isResultNullableEpoch(value.afterOccurredAt) &&
    (value.afterSourceRecordId === null || isBoundedIdentifier(value.afterSourceRecordId))
  );
}

function isSourceFetchStatus(value: unknown): value is SourceFetchStatus {
  return typeof value === "string" && SOURCE_FETCH_STATUSES.includes(value as SourceFetchStatus);
}

function isSourceFetchReasonCode(value: unknown): value is SourceFetchReasonCode {
  return (
    typeof value === "string" && SOURCE_FETCH_REASON_CODES.includes(value as SourceFetchReasonCode)
  );
}

function defaultRetryable(
  status: Exclude<SourceFetchStatus, "success-with-data" | "success-empty">,
): boolean {
  return status === "rate-limited" || status === "source-timeout" || status === "transient-failure";
}

function isBoundedCounter(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_SOURCE_FETCH_COUNTER
  );
}

function isFiniteEpoch(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0
  );
}

function isNullableEpoch(value: unknown): value is number | null {
  return value === null || value === undefined || isFiniteEpoch(value);
}

function isNullableRetryAfter(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_SOURCE_FETCH_RETRY_AFTER_MS)
  );
}

function isResultNullableEpoch(value: unknown): value is number | null {
  return value === null || isFiniteEpoch(value);
}

function isResultNullableRetryAfter(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= MAX_SOURCE_FETCH_RETRY_AFTER_MS)
  );
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SOURCE_FETCH_CURSOR_ID_LENGTH
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: object | null = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nullableNumber(value: number | null): string {
  return value === null ? "<null>" : String(value);
}
