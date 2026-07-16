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

// ── Store Interface ──────────────────────────────────────────────────

export interface ProductCatalogStore {
  upsertProduct(product: ProductCatalogEntry): ProductCatalogEntry;
  getProduct(productId: string): ProductCatalogEntry | undefined;
  upsertImage(image: ProductImageEntry): ProductImageEntry;
  getImages(productId: string): ProductImageEntry[];
  createLaunch(input: ProductLaunchStoreInput): ProductLaunchEntry;
  getLaunch(launchId: string): ProductLaunchEntry | undefined;
  updateLaunchStatus(launchId: string, status: ProductLaunchStatus): ProductLaunchEntry;
  getLaunchesByProduct(productId: string): ProductLaunchEntry[];
}
