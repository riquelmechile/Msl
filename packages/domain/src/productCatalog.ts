import type { ProductLaunchStatus } from "./productLaunch.js";

// ── Catalog Entry Types ──────────────────────────────────────────────

export type ProductCatalogEntry = {
  productId: string;
  gtin?: string;
  brand?: string;
  model?: string;
  categoryMl?: string;
  attributesJson?: string;
  firstSeenAt?: string;
  lastLaunchedAt?: string;
};

export type ProductImageEntry = {
  imageId: string;
  productId: string;
  url: string;
  source: "lens" | "minimax" | "web" | "ceo_telegram";
  qualityScore?: number;
  width?: number;
  height?: number;
  mlDiagnosticJson?: string;
  createdAt?: string;
};

export type ProductLaunchEntry = {
  launchId: string;
  productId: string;
  sellerId: string;
  chatId?: string;
  mlItemId?: string;
  listingType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  title?: string;
  description?: string;
  qualityScorePredicted?: number;
  qualityScoreActual?: number;
  costTotalUsd?: number;
  status: ProductLaunchStatus;
  createdAt: string;
  completedAt?: string;
};

export type ProductLaunchStoreInput = {
  launchId?: string;
  productId: string;
  sellerId: string;
  chatId?: string;
  mlItemId?: string;
  listingType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  title?: string;
  description?: string;
  qualityScorePredicted?: number;
  qualityScoreActual?: number;
  costTotalUsd?: number;
  status: ProductLaunchStatus;
  createdAt: string;
  completedAt?: string;
};

export type ProductLaunchDetailsUpdate = Partial<
  Pick<
    ProductLaunchEntry,
    | "mlItemId"
    | "listingType"
    | "priceAmount"
    | "priceCurrency"
    | "title"
    | "description"
    | "qualityScorePredicted"
    | "qualityScoreActual"
  >
>;

export type ProductLaunchCostInput = {
  eventKey: string;
  launchId: string;
  sellerId: string;
  source: "google_lens" | "deepseek" | "minimax";
  operation: string;
  amountUsd: number;
  measuredAt: string;
};

// ── Store Interface ──────────────────────────────────────────────────

export type ProductCatalogStore = {
  upsertProduct(product: ProductCatalogEntry): ProductCatalogEntry;
  getProduct(productId: string): ProductCatalogEntry | undefined;
  upsertImage(image: ProductImageEntry): ProductImageEntry;
  getImages(productId: string): ProductImageEntry[];
  createLaunch(input: ProductLaunchStoreInput): ProductLaunchEntry;
  getLaunch(launchId: string): ProductLaunchEntry | undefined;
  getLaunchForSeller(launchId: string, sellerId: string): ProductLaunchEntry | undefined;
  updateLaunchStatus(launchId: string, status: ProductLaunchStatus): ProductLaunchEntry;
  transitionLaunchStatus(
    launchId: string,
    sellerId: string,
    expectedStatus: ProductLaunchStatus,
    status: ProductLaunchStatus,
  ): ProductLaunchEntry | undefined;
  updateLaunchDetails(
    launchId: string,
    sellerId: string,
    updates: ProductLaunchDetailsUpdate,
  ): ProductLaunchEntry;
  recordLaunchCost(input: ProductLaunchCostInput): { recorded: boolean; totalUsd: number };
  getLaunchesByProduct(productId: string): ProductLaunchEntry[];
  /** Get the first non-terminal launch for a seller and Telegram chat. */
  getPendingLaunchByChatId(chatId: string, sellerId: string): ProductLaunchEntry | undefined;
};
