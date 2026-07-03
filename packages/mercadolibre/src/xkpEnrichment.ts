import type {
  SupplierId,
  SupplierItemId,
  SupplierItemSnapshot,
  SupplierStockObservation,
} from "@msl/domain";

import type { SupplierEvidence, SupplierSourceAdapter } from "./supplierSource.js";

export type XkpEnrichmentRecord = {
  supplierItemId: SupplierItemId;
  title?: string;
  photos?: readonly string[];
  specs?: Readonly<Record<string, string>>;
  categoryId?: string;
  price?: number;
  currency?: string;
  stock?: unknown;
};

export type XkpEnrichmentClient = {
  fetchEnrichment(input: {
    supplierId: SupplierId;
    itemIds?: readonly SupplierItemId[];
  }): Promise<readonly XkpEnrichmentRecord[]>;
};

export function createXkpEnrichmentAdapter(options: {
  client: XkpEnrichmentClient;
  now?: () => Date;
}): SupplierSourceAdapter {
  const now = options.now ?? (() => new Date());

  return {
    source: "xkp-enrichment",
    async collect(input) {
      const capturedAt = now().toISOString();
      const request: { supplierId: SupplierId; itemIds?: readonly SupplierItemId[] } = {
        supplierId: input.supplierId,
      };
      if (input.itemIds !== undefined) request.itemIds = input.itemIds;
      const records = await options.client.fetchEnrichment(request);
      const evidence = records.map((record) =>
        createXkpEvidence(input.supplierId, record, capturedAt),
      );
      const items = records.map((record, index) =>
        normalizeXkpItem(input.supplierId, record, evidence[index]!.id, capturedAt),
      );

      return {
        supplierId: input.supplierId,
        source: "xkp-enrichment",
        items,
        stockObservations: records.map((record, index) =>
          normalizeIgnoredXkpStock(input.supplierId, record, evidence[index]!.id, capturedAt),
        ),
        evidence,
      };
    },
  };
}

function normalizeXkpItem(
  supplierId: SupplierId,
  record: XkpEnrichmentRecord,
  evidenceId: string,
  capturedAt: string,
): SupplierItemSnapshot {
  const item: SupplierItemSnapshot = {
    supplierId,
    supplierItemId: record.supplierItemId,
    title: record.title ?? record.supplierItemId,
    snapshot: {
      photos: record.photos ?? [],
      specs: record.specs ?? {},
      stockIgnored: record.stock !== undefined,
    },
    source: "xkp-enrichment",
    confidence: "medium",
    freshness: "fresh",
    evidenceId,
    capturedAt,
  };
  if (record.categoryId !== undefined) item.categoryId = record.categoryId;
  if (record.price !== undefined) item.price = record.price;
  if (record.currency !== undefined) item.currency = record.currency;
  return item;
}

function normalizeIgnoredXkpStock(
  supplierId: SupplierId,
  record: XkpEnrichmentRecord,
  evidenceId: string,
  capturedAt: string,
): SupplierStockObservation {
  return {
    id: `xkp-ignored-stock:${supplierId}:${record.supplierItemId}:${capturedAt}`,
    supplierId,
    supplierItemId: record.supplierItemId,
    source: "xkp-enrichment",
    authority: "catalog-enrichment",
    quantity: null,
    status: "unknown",
    confidence: "medium",
    evidenceId,
    capturedAt,
  };
}

function createXkpEvidence(
  supplierId: SupplierId,
  record: XkpEnrichmentRecord,
  capturedAt: string,
): SupplierEvidence {
  return {
    id: `xkp-enrichment:${supplierId}:${record.supplierItemId}:${capturedAt}`,
    supplierId,
    supplierItemId: record.supplierItemId,
    source: "xkp-enrichment",
    confidence: "medium",
    freshness: "fresh",
    capturedAt,
    summary: "XKP enrichment captured catalog data only; stock is not authoritative.",
    metadata: {
      hasPhotos: (record.photos?.length ?? 0) > 0,
      hasSpecs: record.specs !== undefined,
      stockIgnored: record.stock !== undefined,
    },
  };
}
