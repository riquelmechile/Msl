import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { StorefrontProjection } from "@msl/domain";

export const STOREFRONT_PROJECTION_LOCALE = "es-CL";

export type ProjectionLoadResult =
  | { status: "found"; projection: StorefrontProjection }
  | { status: "missing" }
  | { status: "invalid"; reason: "malformed-id" | "unreadable" | "invalid-json" | "invalid-shape" };

const projectionIdPattern = /^[a-zA-Z0-9_-]+$/;
const safeProjectionStringPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const currencyCodePattern = /^[A-Z]{3}$/;
const projectionDataRelativePath = join("data", "storefront-projections");

export function isValidProjectionId(projectionId: string): boolean {
  return projectionIdPattern.test(projectionId);
}

export async function resolveProjectionDirectory(cwd = process.cwd()): Promise<string> {
  const candidates = [
    join(cwd, projectionDataRelativePath),
    join(cwd, "apps", "web", projectionDataRelativePath),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported workspace/app cwd layout.
    }
  }

  return candidates[0] as string;
}

export async function listStoredProjectionIds(
  projectionDirectory?: string,
): Promise<Array<{ projectionId: string }>> {
  const directory = projectionDirectory ?? (await resolveProjectionDirectory());
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    const reason = getFileErrorCode(error) ?? "unknown";
    console.warn("Storefront projection directory is not readable", { directory, reason });
    return [];
  }

  const projectionIds: Array<{ projectionId: string }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const projectionId = entry.replace(/\.json$/, "");
    if (!isValidProjectionId(projectionId)) continue;
    const result = await loadStoredProjectionResult(projectionId, directory);
    if (result.status === "found") projectionIds.push({ projectionId });
  }

  return projectionIds;
}

export async function loadStoredProjectionResult(
  projectionId: string,
  projectionDirectory?: string,
): Promise<ProjectionLoadResult> {
  if (!isValidProjectionId(projectionId)) return { status: "invalid", reason: "malformed-id" };

  const directory = projectionDirectory ?? (await resolveProjectionDirectory());
  let raw: string;
  try {
    raw = await readFile(join(directory, `${projectionId}.json`), "utf8");
  } catch (error) {
    const code = getFileErrorCode(error);
    return code === "ENOENT" ? { status: "missing" } : { status: "invalid", reason: "unreadable" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isStorefrontProjection(parsed, projectionId)) {
      return { status: "invalid", reason: "invalid-shape" };
    }
    return { status: "found", projection: parsed };
  } catch {
    return { status: "invalid", reason: "invalid-json" };
  }
}

export async function loadStoredProjection(
  projectionId: string,
  projectionDirectory?: string,
): Promise<StorefrontProjection | undefined> {
  const result = await loadStoredProjectionResult(projectionId, projectionDirectory);
  return result.status === "found" ? result.projection : undefined;
}

export function formatProjectionPrice(value: number, currency: string): string {
  return new Intl.NumberFormat(STOREFRONT_PROJECTION_LOCALE, {
    style: "currency",
    currency,
  }).format(value);
}

export function isValidProjectionCurrency(currency: string): boolean {
  if (!currencyCodePattern.test(currency)) return false;

  try {
    new Intl.NumberFormat(STOREFRONT_PROJECTION_LOCALE, {
      style: "currency",
      currency,
    });
    return true;
  } catch {
    return false;
  }
}

function isStorefrontProjection(value: unknown, expectedId: string): value is StorefrontProjection {
  if (!isRecord(value)) return false;
  if (value.id !== expectedId) return false;
  if (!isProjectionStatus(value.status)) return false;
  if (!isRecord(value.content) || typeof value.content.seoTitle !== "string") return false;
  if (typeof value.content.geoCopy !== "string" || !isRecord(value.content.schemaMetadata))
    return false;
  if (!Array.isArray(value.content.claims) || !value.content.claims.every(isEvidenceClaim)) {
    return false;
  }
  if (!isRecord(value.catalog) || typeof value.catalog.collectionHandle !== "string") return false;
  if (!Array.isArray(value.catalog.products) || !value.catalog.products.every(isCatalogProduct)) {
    return false;
  }
  if (!Array.isArray(value.media) || !value.media.every(isOptimizedMedia)) return false;
  if (!isRecord(value.readiness)) return false;
  if (!isReadinessStatus(value.readiness.status) || !Array.isArray(value.readiness.checks))
    return false;
  if (!value.readiness.checks.every(isReadinessCheck)) return false;
  if (typeof value.readiness.generatedAt !== "string") return false;
  if (!hasSafeCandidateIds(value.candidateIds, value.readiness)) return false;
  if (!isStringArray(value.evidenceIds) || typeof value.generatedAt !== "string") return false;

  return true;
}

function isCatalogProduct(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.handle !== "string") return false;
  if (typeof value.title !== "string" || typeof value.description !== "string") return false;
  if (value.categoryId !== undefined && typeof value.categoryId !== "string") return false;
  if (!Array.isArray(value.variants) || !value.variants.every(isCatalogVariant)) return false;
  return isStringArray(value.evidenceIds);
}

function isCatalogVariant(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.sku !== "string" || typeof value.title !== "string") return false;
  if (typeof value.price !== "number" || !Number.isFinite(value.price)) return false;
  if (typeof value.currency !== "string" || !isValidProjectionCurrency(value.currency)) {
    return false;
  }
  if (value.inventoryQuantity !== undefined && typeof value.inventoryQuantity !== "number") {
    return false;
  }
  return isStringArray(value.evidenceIds);
}

function isEvidenceClaim(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.text !== "string") return false;
  if (!isClaimType(value.claimType) || !isClaimStatus(value.status)) return false;
  if (value.redactedReason !== undefined && typeof value.redactedReason !== "string") return false;
  return isStringArray(value.evidenceIds);
}

function isOptimizedMedia(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.src !== "string" || typeof value.alt !== "string") return false;
  if (!isSafeStaticPreviewMediaSrc(value.src)) return false;
  if (typeof value.width !== "number" || !Number.isFinite(value.width)) return false;
  if (typeof value.height !== "number" || !Number.isFinite(value.height)) return false;
  if (typeof value.sizes !== "string" || typeof value.hash !== "string") return false;
  if (typeof value.priority !== "boolean") return false;
  return isStringArray(value.evidenceIds);
}

function isReadinessCheck(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.passed !== "boolean") return false;
  if (!isGuardrailSeverity(value.severity)) return false;
  if (typeof value.code !== "string" || typeof value.redactedMessage !== "string") return false;
  return isStringArray(value.evidenceIds);
}

function isProjectionStatus(value: unknown): value is StorefrontProjection["status"] {
  return value === "preview" || value === "approved" || value === "published";
}

function isReadinessStatus(value: unknown): value is StorefrontProjection["readiness"]["status"] {
  return value === "ready" || value === "blocked" || value === "approval-required";
}

function isClaimType(value: unknown): boolean {
  return (
    value === "availability" ||
    value === "price" ||
    value === "origin" ||
    value === "delivery" ||
    value === "benefit" ||
    value === "superiority"
  );
}

function isClaimStatus(value: unknown): boolean {
  return value === "allowed" || value === "rewritten" || value === "blocked";
}

function isGuardrailSeverity(value: unknown): boolean {
  return value === "block" || value === "approval-required" || value === "warning";
}

function getFileErrorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error ? String(error.code) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasSafeCandidateIds(
  candidateIds: unknown,
  readiness: Record<string, unknown>,
): candidateIds is string[] {
  if (!Array.isArray(candidateIds)) return false;
  if (
    !candidateIds.every(
      (item) => typeof item === "string" && safeProjectionStringPattern.test(item),
    )
  ) {
    return false;
  }
  if (candidateIds.length > 0) return true;

  const checks = readiness.checks;
  if (!Array.isArray(checks)) return false;

  return (
    readiness.status === "blocked" &&
    checks.some((check) => isRecord(check) && check.passed === false && check.severity === "block")
  );
}

function isSafeStaticPreviewMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("data:image/")) return true;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  return false;
}
