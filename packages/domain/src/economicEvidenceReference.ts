import type { CostVerification } from "./economicCost.js";

// ── Type ────────────────────────────────────────────────────────────────────

export type EconomicEvidenceReference = {
  readonly evidenceId: string;
  readonly sellerId: string;
  readonly sourceSystem: string; // "mercadolibre" | "supplier" | "manual" | "derived"
  readonly sourceEntityType: string; // "order" | "payment" | "shipment" | "claim" | "ad" | "item"
  readonly sourceRecordId: string;
  readonly sourceField?: string;
  readonly observedAt: number; // epoch ms
  readonly occurredAt: number;
  readonly sourceVersion: string;
  readonly checksum: string; // SHA-256 hex of selected economic fields
  readonly verification: CostVerification;
  readonly confidence: number; // 0..1
  readonly ingestionRunId: string;
  readonly metadata?: Readonly<Record<string, unknown>>; // safe, bounded metadata only
};

// ── Errors ──────────────────────────────────────────────────────────────────

export class EconomicEvidenceReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EconomicEvidenceReferenceError";
  }
}

// ── Guards ──────────────────────────────────────────────────────────────────

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const VALID_SOURCE_SYSTEMS = ["mercadolibre", "supplier", "manual", "derived"] as const;

const VALID_SOURCE_ENTITY_TYPES = [
  "order",
  "payment",
  "shipment",
  "claim",
  "ad",
  "item",
] as const;

const VALID_VERIFICATION_STATES: readonly CostVerification[] = [
  "unverified",
  "partially_verified",
  "verified",
  "disputed",
];

function isValidVerification(v: unknown): v is CostVerification {
  return (VALID_VERIFICATION_STATES as readonly string[]).includes(v as string);
}

// ── Factory ─────────────────────────────────────────────────────────────────

let evidenceCounter = 0;

export type CreateEconomicEvidenceReferenceInput = {
  readonly sellerId: string;
  readonly sourceSystem: string;
  readonly sourceEntityType: string;
  readonly sourceRecordId: string;
  readonly sourceField?: string;
  readonly observedAt: number;
  readonly occurredAt: number;
  readonly sourceVersion: string;
  readonly checksum: string;
  readonly verification: CostVerification;
  readonly confidence: number;
  readonly ingestionRunId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type CreateEconomicEvidenceReferenceResult =
  | { success: true; evidence: EconomicEvidenceReference }
  | { success: false; error: EconomicEvidenceReferenceError };

export function createEconomicEvidenceReference(
  input: CreateEconomicEvidenceReferenceInput,
): CreateEconomicEvidenceReferenceResult {
  // Validate sellerId
  if (!isNonEmptyString(input.sellerId)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError("sellerId must be a non-empty string"),
    };
  }

  // Validate sourceSystem
  if (!(VALID_SOURCE_SYSTEMS as readonly string[]).includes(input.sourceSystem)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError(
        `sourceSystem must be one of: ${VALID_SOURCE_SYSTEMS.join(", ")}. Got: "${input.sourceSystem}"`,
      ),
    };
  }

  // Validate sourceEntityType
  if (!(VALID_SOURCE_ENTITY_TYPES as readonly string[]).includes(input.sourceEntityType)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError(
        `sourceEntityType must be one of: ${VALID_SOURCE_ENTITY_TYPES.join(", ")}. Got: "${input.sourceEntityType}"`,
      ),
    };
  }

  // Validate sourceRecordId
  if (!isNonEmptyString(input.sourceRecordId)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError(
        "sourceRecordId must be a non-empty string",
      ),
    };
  }

  // Validate confidence
  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError(
        `confidence must be between 0 and 1, got ${input.confidence}`,
      ),
    };
  }

  // Validate verification
  if (!isValidVerification(input.verification)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError(
        `verification must be one of: ${VALID_VERIFICATION_STATES.join(", ")}`,
      ),
    };
  }

  // Validate checksum
  if (!isNonEmptyString(input.checksum)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError("checksum must be a non-empty string"),
    };
  }

  // Validate sourceVersion
  if (!isNonEmptyString(input.sourceVersion)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError("sourceVersion must be a non-empty string"),
    };
  }

  // Validate ingestionRunId
  if (!isNonEmptyString(input.ingestionRunId)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError("ingestionRunId must be a non-empty string"),
    };
  }

  // Validate occurredAt
  if (typeof input.occurredAt !== "number" || !Number.isFinite(input.occurredAt)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError("occurredAt must be a finite number (epoch ms)"),
    };
  }

  // Validate observedAt
  if (typeof input.observedAt !== "number" || !Number.isFinite(input.observedAt)) {
    return {
      success: false,
      error: new EconomicEvidenceReferenceError("observedAt must be a finite number (epoch ms)"),
    };
  }

  evidenceCounter++;
  const evidenceId = `evidence-${evidenceCounter}`;

  return {
    success: true,
    evidence: {
      evidenceId,
      sellerId: input.sellerId,
      sourceSystem: input.sourceSystem,
      sourceEntityType: input.sourceEntityType,
      sourceRecordId: input.sourceRecordId,
      ...(input.sourceField !== undefined ? { sourceField: input.sourceField } : {}),
      observedAt: input.observedAt,
      occurredAt: input.occurredAt,
      sourceVersion: input.sourceVersion,
      checksum: input.checksum,
      verification: input.verification,
      confidence: input.confidence,
      ingestionRunId: input.ingestionRunId,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  };
}
