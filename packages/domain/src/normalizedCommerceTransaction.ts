import type { Currency, Money } from "./money.js";

// ── Type ────────────────────────────────────────────────────────────────────

export type NormalizedCommerceTransaction = {
  readonly transactionId: string;
  readonly sellerId: string;
  readonly accountId?: string;
  readonly channel: string; // "mercadolibre"
  readonly orderId: string;
  readonly packId?: string;
  readonly paymentId?: string;
  readonly shipmentId?: string;
  readonly itemId: string;
  readonly variationId?: string;
  readonly sku?: string;
  readonly quantity: number; // integer
  readonly unitPrice: Money; // { amountMinor, currency }
  readonly grossRevenue: Money;
  readonly currency: Currency;
  readonly orderStatus: string;
  readonly paymentStatus?: string;
  readonly shipmentStatus?: string;
  readonly occurredAt: number; // epoch ms
  readonly updatedAt: number;
  readonly sourceVersion: string; // ML API response version or timestamp
  readonly sourceEvidenceIds: readonly string[];
  readonly ingestionRunId: string;
  readonly noExternalMutationExecuted: true;
};

// ── Errors ──────────────────────────────────────────────────────────────────

export class NormalizedCommerceTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NormalizedCommerceTransactionError";
  }
}

// ── Guards ──────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isValidMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.amountMinor === "number" &&
    Number.isFinite(m.amountMinor) &&
    Number.isInteger(m.amountMinor) &&
    (m.currency === "CLP" || m.currency === "USD")
  );
}

// ── Factory ─────────────────────────────────────────────────────────────────

export type CreateNormalizedCommerceTransactionInput = {
  readonly transactionId: string;
  readonly sellerId: string;
  readonly accountId?: string;
  readonly channel: string;
  readonly orderId: string;
  readonly packId?: string;
  readonly paymentId?: string;
  readonly shipmentId?: string;
  readonly itemId: string;
  readonly variationId?: string;
  readonly sku?: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly grossRevenue: Money;
  readonly currency: Currency;
  readonly orderStatus: string;
  readonly paymentStatus?: string;
  readonly shipmentStatus?: string;
  readonly occurredAt: number;
  readonly updatedAt: number;
  readonly sourceVersion: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly ingestionRunId: string;
};

export type CreateNormalizedCommerceTransactionResult =
  | { success: true; transaction: NormalizedCommerceTransaction }
  | { success: false; error: NormalizedCommerceTransactionError };

export function createNormalizedCommerceTransaction(
  input: CreateNormalizedCommerceTransactionInput,
): CreateNormalizedCommerceTransactionResult {
  // Validate transactionId
  if (!isNonEmptyString(input.transactionId)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "transactionId must be a non-empty string",
      ),
    };
  }

  // Validate sellerId
  if (!isNonEmptyString(input.sellerId)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "sellerId must be a non-empty string",
      ),
    };
  }

  // Validate channel
  if (!isNonEmptyString(input.channel)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "channel must be a non-empty string",
      ),
    };
  }

  // Validate orderId
  if (!isNonEmptyString(input.orderId)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "orderId must be a non-empty string",
      ),
    };
  }

  // Validate itemId
  if (!isNonEmptyString(input.itemId)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "itemId must be a non-empty string",
      ),
    };
  }

  // Validate quantity
  if (!isPositiveInteger(input.quantity)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "quantity must be a positive integer",
      ),
    };
  }

  // Validate unitPrice
  if (!isValidMoney(input.unitPrice)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "unitPrice must be a valid Money with integer amountMinor and known currency",
      ),
    };
  }

  // Validate grossRevenue
  if (!isValidMoney(input.grossRevenue)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "grossRevenue must be a valid Money with integer amountMinor and known currency",
      ),
    };
  }

  // Validate currency consistency
  if (input.unitPrice.currency !== input.grossRevenue.currency) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        `Currency mismatch: unitPrice is ${input.unitPrice.currency} but grossRevenue is ${input.grossRevenue.currency}`,
      ),
    };
  }

  // Validate orderStatus
  if (!isNonEmptyString(input.orderStatus)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "orderStatus must be a non-empty string",
      ),
    };
  }

  // Validate occurredAt
  if (typeof input.occurredAt !== "number" || !Number.isFinite(input.occurredAt)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "occurredAt must be a finite number (epoch ms)",
      ),
    };
  }

  // Validate updatedAt
  if (typeof input.updatedAt !== "number" || !Number.isFinite(input.updatedAt)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "updatedAt must be a finite number (epoch ms)",
      ),
    };
  }

  // Validate sourceVersion
  if (!isNonEmptyString(input.sourceVersion)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "sourceVersion must be a non-empty string",
      ),
    };
  }

  // Validate sourceEvidenceIds
  if (!Array.isArray(input.sourceEvidenceIds)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "sourceEvidenceIds must be an array of strings",
      ),
    };
  }

  // Validate ingestionRunId
  if (!isNonEmptyString(input.ingestionRunId)) {
    return {
      success: false,
      error: new NormalizedCommerceTransactionError(
        "ingestionRunId must be a non-empty string",
      ),
    };
  }

  const transaction: NormalizedCommerceTransaction = {
    transactionId: input.transactionId,
    sellerId: input.sellerId,
    ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
    channel: input.channel,
    orderId: input.orderId,
    ...(input.packId !== undefined ? { packId: input.packId } : {}),
    ...(input.paymentId !== undefined ? { paymentId: input.paymentId } : {}),
    ...(input.shipmentId !== undefined ? { shipmentId: input.shipmentId } : {}),
    itemId: input.itemId,
    ...(input.variationId !== undefined ? { variationId: input.variationId } : {}),
    ...(input.sku !== undefined ? { sku: input.sku } : {}),
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    grossRevenue: input.grossRevenue,
    currency: input.currency,
    orderStatus: input.orderStatus,
    ...(input.paymentStatus !== undefined ? { paymentStatus: input.paymentStatus } : {}),
    ...(input.shipmentStatus !== undefined ? { shipmentStatus: input.shipmentStatus } : {}),
    occurredAt: input.occurredAt,
    updatedAt: input.updatedAt,
    sourceVersion: input.sourceVersion,
    sourceEvidenceIds: input.sourceEvidenceIds,
    ingestionRunId: input.ingestionRunId,
    noExternalMutationExecuted: true,
  };

  return { success: true, transaction };
}
