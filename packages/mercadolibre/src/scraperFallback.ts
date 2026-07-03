import { createHash } from "node:crypto";

import type {
  SupplierId,
  SupplierItemId,
  SupplierItemSnapshot,
  SupplierMirrorConfidence,
  SupplierStockObservation,
} from "@msl/domain";

import type { SupplierEvidence, SupplierSourceAdapter } from "./supplierSource.js";

export type ScraperFallbackInput = {
  supplierId: SupplierId;
  supplierItemId: SupplierItemId;
  url: string;
  html: string;
  capturedAt: string;
};

export type ScraperFallbackParseResult = {
  item?: SupplierItemSnapshot;
  stockObservation?: SupplierStockObservation;
  evidence: SupplierEvidence;
};

export type ScraperFallbackFetcher = (input: {
  supplierId: SupplierId;
  supplierItemId: SupplierItemId;
}) => Promise<{ url: string; html: string }>;

export function createMercadoLibreScraperFallbackAdapter(options: {
  fetcher: ScraperFallbackFetcher;
  now?: () => Date;
}): SupplierSourceAdapter {
  const now = options.now ?? (() => new Date());

  return {
    source: "mercadolibre-scraper-fallback",
    async collect(input) {
      const itemIds = input.itemIds ?? [];
      const parsed: ScraperFallbackParseResult[] = [];
      for (const supplierItemId of itemIds) {
        const fetched = await options.fetcher({ supplierId: input.supplierId, supplierItemId });
        parsed.push(
          parseMercadoLibreFallbackHtml({
            supplierId: input.supplierId,
            supplierItemId,
            capturedAt: now().toISOString(),
            ...fetched,
          }),
        );
      }

      return {
        supplierId: input.supplierId,
        source: "mercadolibre-scraper-fallback",
        items: parsed.flatMap((result) => (result.item ? [result.item] : [])),
        stockObservations: parsed.flatMap((result) =>
          result.stockObservation ? [result.stockObservation] : [],
        ),
        evidence: parsed.map((result) => result.evidence),
      };
    },
  };
}

export function parseMercadoLibreFallbackHtml(
  input: ScraperFallbackInput,
): ScraperFallbackParseResult {
  const jsonLd = parseJsonLd(input.html);
  const title = textFromMeta(input.html, "og:title") ?? stringValue(jsonLd?.name);
  const offers = asRecord(jsonLd?.offers);
  const price = numberValue(offers?.price) ?? numberFromMeta(input.html, "product:price:amount");
  const currency =
    textFromMeta(input.html, "product:price:currency") ?? stringValue(offers?.priceCurrency);
  const stockText = stringValue(offers?.availability) ?? "";
  const quantity = quantityFromText(input.html);
  const confidence: SupplierMirrorConfidence =
    title || price !== undefined || quantity !== null ? "medium" : "low";
  const evidenceId = `ml-scraper:${input.supplierId}:${input.supplierItemId}:${hash(input.html)}`;
  const evidence: SupplierEvidence = {
    id: evidenceId,
    supplierId: input.supplierId,
    supplierItemId: input.supplierItemId,
    source: "mercadolibre-scraper-fallback",
    confidence,
    freshness: "fresh",
    capturedAt: input.capturedAt,
    summary:
      "MercadoLibre scraper fallback captured isolated non-mutating evidence for an API gap.",
    metadata: { url: input.url, rawHash: hash(input.html), selectors: ["json-ld", "og:title"] },
  };

  let item: SupplierItemSnapshot | undefined;
  if (title) {
    item = {
      supplierId: input.supplierId,
      supplierItemId: input.supplierItemId,
      mlItemId: input.supplierItemId,
      title,
      snapshot: { url: input.url, stockText },
      source: "mercadolibre-scraper-fallback",
      confidence,
      freshness: "fresh",
      evidenceId,
      capturedAt: input.capturedAt,
    };
    if (price !== undefined) item.price = price;
    if (currency !== undefined) item.currency = currency;
  }

  const stockObservation: SupplierStockObservation = {
    id: `ml-scraper-stock:${input.supplierId}:${input.supplierItemId}:${hash(input.html)}`,
    supplierId: input.supplierId,
    supplierItemId: input.supplierItemId,
    source: "mercadolibre-scraper-fallback",
    authority: "fallback-evidence",
    quantity,
    status: quantity === null ? "unknown" : quantity <= 0 ? "out-of-stock" : "in-stock",
    confidence,
    evidenceId,
    capturedAt: input.capturedAt,
  };

  const result: ScraperFallbackParseResult = { stockObservation, evidence };
  if (item !== undefined) result.item = item;
  return result;
}

function parseJsonLd(html: string): Readonly<Record<string, unknown>> | undefined {
  const match = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) return undefined;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function textFromMeta(html: string, property: string): string | undefined {
  const escaped = property.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = html.match(
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
  );
  return match?.[1]?.trim();
}

function numberFromMeta(html: string, property: string): number | undefined {
  const value = textFromMeta(html, property);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function quantityFromText(html: string): number | null {
  const match = html.match(/(?:stock|disponibles?|available)[^0-9]{0,20}(\d+)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
