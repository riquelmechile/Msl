import type {
  SupplierEvidenceId,
  SupplierId,
  SupplierItemId,
  SupplierItemSnapshot,
  SupplierMirrorConfidence,
  SupplierMirrorFreshness,
  SupplierSourceType,
  SupplierStockObservation,
} from "@msl/domain";

import type { MlcApiClient, MlcListingsSnapshot, MlcListingSummary, MlItem } from "./index.js";

export type SupplierEvidence = {
  id: SupplierEvidenceId;
  supplierId: SupplierId;
  supplierItemId?: SupplierItemId;
  source: SupplierSourceType;
  confidence: SupplierMirrorConfidence;
  freshness: SupplierMirrorFreshness;
  capturedAt: string;
  summary: string;
  metadata: Readonly<Record<string, unknown>>;
};

export type SupplierSourceCollectInput = {
  supplierId: SupplierId;
  lowStockThreshold?: number;
  itemIds?: readonly string[];
};

export type SupplierSourceCollectResult = {
  supplierId: SupplierId;
  source: SupplierSourceType;
  items: readonly SupplierItemSnapshot[];
  stockObservations: readonly SupplierStockObservation[];
  evidence: readonly SupplierEvidence[];
  unsupported?: boolean;
};

export type SupplierSourceAdapter = {
  readonly source: SupplierSourceType;
  collect(input: SupplierSourceCollectInput): Promise<SupplierSourceCollectResult>;
};

export type MercadoLibreSupplierSourceAdapterOptions = {
  client: Pick<MlcApiClient, "getListings" | "getItem">;
  sellerId: string;
  now?: () => Date;
};

export function createMercadoLibreSupplierSourceAdapter(
  options: MercadoLibreSupplierSourceAdapterOptions,
): SupplierSourceAdapter {
  const now = options.now ?? (() => new Date());

  return {
    source: "mercadolibre-api",
    async collect(input) {
      const capturedAt = now().toISOString();
      const listingSnapshot = await options.client.getListings(options.sellerId, {
        status: "active",
      });
      const listingData = listingSnapshotData(listingSnapshot.data);
      const listingIds = input.itemIds ?? listingData.map((listing) => listing.id);
      const mlItems = await Promise.all(
        listingIds.map(async (itemId) => options.client.getItem(options.sellerId, itemId)),
      );

      const items = mlItems.map((item) =>
        normalizeMercadoLibreSupplierItem({ supplierId: input.supplierId, item, capturedAt }),
      );
      const stockObservations = mlItems.map((item) =>
        normalizeMercadoLibreStockObservation({
          supplierId: input.supplierId,
          item,
          lowStockThreshold: input.lowStockThreshold ?? 3,
          capturedAt,
        }),
      );
      const evidence: SupplierEvidence[] = [
        createApiEvidence({
          supplierId: input.supplierId,
          capturedAt,
          summary: "MercadoLibre seller listing search returned supplier item IDs.",
          metadata: {
            sellerId: options.sellerId,
            itemCount: listingIds.length,
            completeness: listingSnapshot.completeness,
            confidence: listingSnapshot.confidence,
          },
        }),
        ...mlItems.map((item) =>
          createApiEvidence({
            supplierId: input.supplierId,
            supplierItemId: item.id,
            capturedAt,
            summary: "MercadoLibre item API returned stock-authoritative item evidence.",
            metadata: { sellerId: options.sellerId, itemId: item.id, status: item.status },
          }),
        ),
      ];

      return {
        supplierId: input.supplierId,
        source: "mercadolibre-api",
        items,
        stockObservations,
        evidence,
      };
    },
  };
}

export function createUnsupportedSupplierSourceAdapter(
  source: SupplierSourceType,
): SupplierSourceAdapter {
  return {
    source,
    collect(input) {
      const capturedAt = new Date().toISOString();
      return Promise.resolve({
        supplierId: input.supplierId,
        source: "unsupported",
        items: [],
        stockObservations: [],
        unsupported: true,
        evidence: [
          {
            id: evidenceId("unsupported", input.supplierId, capturedAt),
            supplierId: input.supplierId,
            source: "unsupported",
            confidence: "low",
            freshness: "fresh",
            capturedAt,
            summary: `Supplier source ${source} is not supported by an enabled adapter.`,
            metadata: { requestedSource: source },
          },
        ],
      });
    },
  };
}

function listingSnapshotData(data: MlcListingsSnapshot["data"]): readonly MlcListingSummary[] {
  if (isListingSummaryArray(data)) {
    return data;
  }
  return [data];
}

function isListingSummaryArray(
  data: MlcListingsSnapshot["data"],
): data is readonly MlcListingSummary[] {
  return Array.isArray(data);
}

function normalizeMercadoLibreSupplierItem(input: {
  supplierId: SupplierId;
  item: MlItem;
  capturedAt: string;
}): SupplierItemSnapshot {
  const snapshot: SupplierItemSnapshot = {
    supplierId: input.supplierId,
    supplierItemId: input.item.id,
    mlItemId: input.item.id,
    title: input.item.title,
    price: input.item.price,
    snapshot: {
      status: input.item.status,
      pictures: input.item.pictures.map((picture) => picture.url),
      attributes: input.item.attributes,
      variations: input.item.variations,
    },
    source: "mercadolibre-api",
    confidence: "high",
    freshness: "fresh",
    evidenceId: evidenceId("ml-api-item", input.supplierId, input.item.id),
    capturedAt: input.capturedAt,
  };
  snapshot.categoryId = input.item.category_id;
  if (input.item.currency_id !== undefined) snapshot.currency = input.item.currency_id;
  const sku = readSellerSku(input.item);
  if (sku !== undefined) snapshot.sku = sku;
  if (input.item.permalink !== undefined) {
    (snapshot.snapshot as Record<string, unknown>).permalink = input.item.permalink;
  }
  return snapshot;
}

function normalizeMercadoLibreStockObservation(input: {
  supplierId: SupplierId;
  item: MlItem;
  lowStockThreshold: number;
  capturedAt: string;
}): SupplierStockObservation {
  const quantity = input.item.available_quantity;
  const status =
    quantity <= 0 ? "out-of-stock" : quantity <= input.lowStockThreshold ? "low-stock" : "in-stock";

  return {
    id: evidenceId("ml-api-stock", input.supplierId, input.item.id, input.capturedAt),
    supplierId: input.supplierId,
    supplierItemId: input.item.id,
    source: "mercadolibre-api",
    authority: "stock-authoritative",
    quantity,
    status,
    confidence: "high",
    evidenceId: evidenceId("ml-api-item", input.supplierId, input.item.id),
    capturedAt: input.capturedAt,
  };
}

function createApiEvidence(input: {
  supplierId: SupplierId;
  supplierItemId?: SupplierItemId;
  capturedAt: string;
  summary: string;
  metadata: Readonly<Record<string, unknown>>;
}): SupplierEvidence {
  const evidence: SupplierEvidence = {
    id: evidenceId(
      "ml-api",
      input.supplierId,
      input.supplierItemId ?? "listing-search",
      input.capturedAt,
    ),
    supplierId: input.supplierId,
    source: "mercadolibre-api",
    confidence: "high",
    freshness: "fresh",
    capturedAt: input.capturedAt,
    summary: input.summary,
    metadata: input.metadata,
  };
  if (input.supplierItemId !== undefined) evidence.supplierItemId = input.supplierItemId;
  return evidence;
}

function readSellerSku(item: MlItem): string | undefined {
  return item.attributes.find((attribute) => attribute.id === "SELLER_SKU")?.value_name;
}

function evidenceId(...parts: readonly string[]): SupplierEvidenceId {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9-]/g, "-")).join(":");
}

export function summarizeListingAsSupplierItem(
  listing: MlcListingSummary,
): Pick<SupplierItemSnapshot, "supplierItemId" | "title" | "price" | "currency" | "categoryId"> {
  const item: Pick<
    SupplierItemSnapshot,
    "supplierItemId" | "title" | "price" | "currency" | "categoryId"
  > = {
    supplierItemId: listing.id,
    title: listing.title ?? listing.id,
  };
  if (listing.price !== undefined) item.price = listing.price;
  if (listing.currencyId !== undefined) item.currency = listing.currencyId;
  if (listing.categoryId !== undefined) item.categoryId = listing.categoryId;
  return item;
}
