import type { MlcListingSummary } from "@msl/mercadolibre";
import { KIND_FRESHNESS_TTL } from "./constants.js";

// ── Shared helpers used across ingestion modules ──────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function todayLabel(): string {
  return new Date().toISOString().slice(0, 10);
}

export function categoryBreakdownFromMetadata(
  value: unknown,
): Array<{ categoryId: string; orderCount: number; totalAmount: number }> {
  if (!Array.isArray(value)) return [];
  const breakdown: Array<{ categoryId: string; orderCount: number; totalAmount: number }> = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) continue;
    const record = entry;
    breakdown.push({
      categoryId: metadataString(record.categoryId, "unknown"),
      orderCount: Number(record.orderCount ?? 0),
      totalAmount: Number(record.totalAmount ?? 0),
    });
  }
  return breakdown;
}

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// ── Pagination ────────────────────────────────────────────────────────

export type PaginationConfig = { maxPages: number; pageSize?: number };

export async function paginateAll<T>(
  fetchPage: (offset: number) => Promise<{ total: number; results: T[] }>,
  config: PaginationConfig,
): Promise<T[]> {
  const pageSize = config.pageSize ?? 200;
  const allResults: T[] = [];
  let pagesFetched = 0;
  let offset = 0;

  while (pagesFetched < config.maxPages) {
    const { total, results } = await fetchPage(offset);

    if (results.length === 0) break;

    allResults.push(...results);
    pagesFetched++;

    if (allResults.length >= total || results.length < pageSize) break;

    offset += pageSize;
  }

  return allResults;
}

// ── Pricing helpers ───────────────────────────────────────────────────

export function isGracefulPricingNoDataError(error: unknown): boolean {
  if (!isRecord(error)) {
    const message = String(error).toLowerCase();
    return /unauthori[sz]ed|forbidden|not.?found|catalog|price.?to.?win|no.?data|unsupported/.test(
      message,
    );
  }

  const status = Number(error.status ?? error.statusCode ?? error.code);
  if ([401, 403, 404].includes(status)) return true;

  const message = metadataString(error.message).toLowerCase();
  return /unauthori[sz]ed|forbidden|not.?found|catalog|price.?to.?win|no.?data|unsupported/.test(
    message,
  );
}

export function selectRotatedPricingListings(
  sellerId: string,
  listings: ReadonlyArray<MlcListingSummary>,
  maxItems: number,
  checkpointCapturedAt?: string,
): ReadonlyArray<MlcListingSummary> {
  if (maxItems <= 0) return [];

  const candidates = listings
    .filter((listing) => typeof listing.id === "string" && listing.id.length > 0)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  if (candidates.length <= maxItems) return candidates;

  const seed = `${sellerId}:${checkpointCapturedAt ?? "initial"}`;
  const start = hashString(seed) % candidates.length;

  return Array.from(
    { length: maxItems },
    (_, index) => candidates[(start + index) % candidates.length]!,
  );
}

// ── Freshness skip-gate ───────────────────────────────────────────────

export async function withFreshnessSkip<T>(
  config: {
    operationalStore?: {
      getCheckpoint: (
        sellerId: string,
        kind: string,
      ) => Promise<{ last_captured_at: string } | null>;
    };
  },
  sellerId: string,
  kind: keyof typeof KIND_FRESHNESS_TTL,
  processor: () => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!config.operationalStore) return processor();
  try {
    const checkpoint = await config.operationalStore.getCheckpoint(sellerId, kind);
    if (checkpoint) {
      const age = Date.now() - new Date(checkpoint.last_captured_at).getTime();
      if (age < KIND_FRESHNESS_TTL[kind]) {
        console.log(
          `[background-ingestion] Skipping ${kind} for ${sellerId} — checkpoint is fresh (${Math.round(age / 1000)}s old, TTL: ${Math.round(KIND_FRESHNESS_TTL[kind] / 1000)}s)`,
        );
        return fallback;
      }
    }
  } catch {
    // proceed if checkpoint check fails
  }
  return processor();
}
