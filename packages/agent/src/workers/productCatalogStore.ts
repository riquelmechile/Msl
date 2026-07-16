import crypto from "node:crypto";
import Database from "better-sqlite3";
import { isValidTransition } from "@msl/domain";
import type {
  ProductCatalogEntry,
  ProductCatalogStore,
  ProductImageEntry,
  ProductLaunchEntry,
  ProductLaunchStatus,
  ProductLaunchStoreInput,
} from "@msl/domain";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS product_catalog (
  product_id TEXT PRIMARY KEY,
  gtin TEXT,
  brand TEXT,
  model TEXT,
  category_ml TEXT,
  attributes_json TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_launched_at TEXT
);

CREATE TABLE IF NOT EXISTS product_images (
  image_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product_catalog(product_id),
  url TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('lens','minimax','web','ceo_telegram')),
  quality_score INTEGER,
  width INTEGER,
  height INTEGER,
  ml_diagnostic_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_launches (
  launch_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES product_catalog(product_id),
  seller_id TEXT NOT NULL,
  chat_id TEXT,
  ml_item_id TEXT,
  listing_type TEXT,
  price_amount INTEGER,
  price_currency TEXT,
  title TEXT,
  description TEXT,
  quality_score_predicted INTEGER,
  quality_score_actual INTEGER,
  cost_total_usd REAL,
  status TEXT NOT NULL DEFAULT 'photo_received' CHECK(status IN ('photo_received','recognizing','researching','generating_creative','composing','awaiting_approval','approved','ready_to_publish','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pi_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_pl_product_id ON product_launches(product_id);
CREATE INDEX IF NOT EXISTS idx_pl_status ON product_launches(status);
CREATE INDEX IF NOT EXISTS idx_pl_seller_id ON product_launches(seller_id);
CREATE INDEX IF NOT EXISTS idx_pl_chat_id ON product_launches(chat_id);
`;

// ── Row types (internal — match SQLite columns) ──────────────────────

type ProductCatalogRow = {
  product_id: string;
  gtin: string | null;
  brand: string | null;
  model: string | null;
  category_ml: string | null;
  attributes_json: string | null;
  first_seen_at: string;
  last_launched_at: string | null;
};

type ProductImageRow = {
  image_id: string;
  product_id: string;
  url: string;
  source: "lens" | "minimax" | "web" | "ceo_telegram";
  quality_score: number | null;
  width: number | null;
  height: number | null;
  ml_diagnostic_json: string | null;
  created_at: string;
};

type ProductLaunchRow = {
  launch_id: string;
  product_id: string;
  seller_id: string;
  chat_id: string | null;
  ml_item_id: string | null;
  listing_type: string | null;
  price_amount: number | null;
  price_currency: string | null;
  title: string | null;
  description: string | null;
  quality_score_predicted: number | null;
  quality_score_actual: number | null;
  cost_total_usd: number | null;
  status: ProductLaunchStatus;
  created_at: string;
  completed_at: string | null;
};

// ── Row mappers ──────────────────────────────────────────────────────

function rowToCatalogEntry(row: ProductCatalogRow): ProductCatalogEntry {
  const entry: ProductCatalogEntry = {
    productId: row.product_id,
    firstSeenAt: row.first_seen_at,
  };
  if (row.gtin != null) entry.gtin = row.gtin;
  if (row.brand != null) entry.brand = row.brand;
  if (row.model != null) entry.model = row.model;
  if (row.category_ml != null) entry.categoryMl = row.category_ml;
  if (row.attributes_json != null) entry.attributesJson = row.attributes_json;
  if (row.last_launched_at != null) entry.lastLaunchedAt = row.last_launched_at;
  return entry;
}

function rowToImageEntry(row: ProductImageRow): ProductImageEntry {
  const entry: ProductImageEntry = {
    imageId: row.image_id,
    productId: row.product_id,
    url: row.url,
    source: row.source,
    createdAt: row.created_at,
  };
  if (row.quality_score != null) entry.qualityScore = row.quality_score;
  if (row.width != null) entry.width = row.width;
  if (row.height != null) entry.height = row.height;
  if (row.ml_diagnostic_json != null) entry.mlDiagnosticJson = row.ml_diagnostic_json;
  return entry;
}

function rowToLaunchEntry(row: ProductLaunchRow): ProductLaunchEntry {
  const entry: ProductLaunchEntry = {
    launchId: row.launch_id,
    productId: row.product_id,
    sellerId: row.seller_id,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.chat_id != null) entry.chatId = row.chat_id;
  if (row.ml_item_id != null) entry.mlItemId = row.ml_item_id;
  if (row.listing_type != null) entry.listingType = row.listing_type;
  if (row.price_amount != null) entry.priceAmount = row.price_amount;
  if (row.price_currency != null) entry.priceCurrency = row.price_currency;
  if (row.title != null) entry.title = row.title;
  if (row.description != null) entry.description = row.description;
  if (row.quality_score_predicted != null)
    entry.qualityScorePredicted = row.quality_score_predicted;
  if (row.quality_score_actual != null) entry.qualityScoreActual = row.quality_score_actual;
  if (row.cost_total_usd != null) entry.costTotalUsd = row.cost_total_usd;
  if (row.completed_at != null) entry.completedAt = row.completed_at;
  return entry;
}

// ── Factory ──────────────────────────────────────────────────────────

export function createProductCatalogStore(db: Database.Database): ProductCatalogStore {
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ────────────────────────────────────

  const upsertProductStmt = db.prepare(`
    INSERT INTO product_catalog (product_id, gtin, brand, model, category_ml, attributes_json, last_launched_at)
    VALUES (@productId, @gtin, @brand, @model, @categoryMl, @attributesJson, @lastLaunchedAt)
    ON CONFLICT(product_id) DO UPDATE SET
      gtin = excluded.gtin, brand = excluded.brand, model = excluded.model,
      category_ml = excluded.category_ml, attributes_json = excluded.attributes_json,
      last_launched_at = excluded.last_launched_at
  `);

  const selectProductStmt = db.prepare(`
    SELECT * FROM product_catalog WHERE product_id = ?
  `);

  const upsertImageStmt = db.prepare(`
    INSERT INTO product_images (image_id, product_id, url, source, quality_score, width, height, ml_diagnostic_json)
    VALUES (@imageId, @productId, @url, @source, @qualityScore, @width, @height, @mlDiagnosticJson)
    ON CONFLICT(image_id) DO UPDATE SET
      product_id = excluded.product_id, url = excluded.url, source = excluded.source,
      quality_score = excluded.quality_score, width = excluded.width, height = excluded.height,
      ml_diagnostic_json = excluded.ml_diagnostic_json
  `);

  const selectImagesStmt = db.prepare(`
    SELECT * FROM product_images WHERE product_id = ? ORDER BY created_at DESC
  `);

  const insertLaunchStmt = db.prepare(`
    INSERT INTO product_launches (launch_id, product_id, seller_id, chat_id, ml_item_id, listing_type,
      price_amount, price_currency, title, description, quality_score_predicted,
      quality_score_actual, cost_total_usd, status)
    VALUES (@launchId, @productId, @sellerId, @chatId, @mlItemId, @listingType,
      @priceAmount, @priceCurrency, @title, @description, @qualityScorePredicted,
      @qualityScoreActual, @costTotalUsd, @status)
  `);

  const selectLaunchStmt = db.prepare(`
    SELECT * FROM product_launches WHERE launch_id = ?
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE product_launches SET status = @status, completed_at = @completedAt
    WHERE launch_id = @launchId
  `);

  const selectLaunchesByProductStmt = db.prepare(`
    SELECT * FROM product_launches WHERE product_id = ? ORDER BY created_at DESC
  `);

  const selectPendingByChatIdStmt = db.prepare(`
    SELECT * FROM product_launches
    WHERE chat_id = ? AND status NOT IN ('ready_to_publish', 'rejected')
    ORDER BY created_at DESC LIMIT 1
  `);

  // ── Helpers ────────────────────────────────────────────────

  function getExistingLaunch(launchId: string): ProductLaunchRow | undefined {
    return selectLaunchStmt.get(launchId) as ProductLaunchRow | undefined;
  }

  function assertLaunchExists(launchId: string): ProductLaunchRow {
    const row = getExistingLaunch(launchId);
    if (!row) throw new Error(`ProductLaunch "${launchId}" not found`);
    return row;
  }

  // ── API methods ────────────────────────────────────────────

  const upsertProduct = (product: ProductCatalogEntry): ProductCatalogEntry => {
    upsertProductStmt.run({
      productId: product.productId,
      gtin: product.gtin ?? null,
      brand: product.brand ?? null,
      model: product.model ?? null,
      categoryMl: product.categoryMl ?? null,
      attributesJson: product.attributesJson ?? null,
      lastLaunchedAt: product.lastLaunchedAt ?? null,
    });
    return rowToCatalogEntry(selectProductStmt.get(product.productId) as ProductCatalogRow);
  };

  const getProduct = (productId: string): ProductCatalogEntry | undefined => {
    const row = selectProductStmt.get(productId) as ProductCatalogRow | undefined;
    return row ? rowToCatalogEntry(row) : undefined;
  };

  const upsertImage = (image: ProductImageEntry): ProductImageEntry => {
    upsertImageStmt.run({
      imageId: image.imageId,
      productId: image.productId,
      url: image.url,
      source: image.source,
      qualityScore: image.qualityScore ?? null,
      width: image.width ?? null,
      height: image.height ?? null,
      mlDiagnosticJson: image.mlDiagnosticJson ?? null,
    });
    const row = db
      .prepare("SELECT * FROM product_images WHERE image_id = ?")
      .get(image.imageId) as ProductImageRow;
    return rowToImageEntry(row);
  };

  const getImages = (productId: string): ProductImageEntry[] => {
    return (selectImagesStmt.all(productId) as ProductImageRow[]).map(rowToImageEntry);
  };

  const createLaunch = (input: ProductLaunchStoreInput): ProductLaunchEntry => {
    const launchId = input.launchId || crypto.randomUUID();
    const existing = getExistingLaunch(launchId);
    if (existing) return rowToLaunchEntry(existing);

    insertLaunchStmt.run({
      launchId,
      productId: input.productId,
      sellerId: input.sellerId,
      chatId: input.chatId ?? null,
      mlItemId: input.mlItemId ?? null,
      listingType: input.listingType ?? null,
      priceAmount: input.priceAmount ?? null,
      priceCurrency: input.priceCurrency ?? null,
      title: input.title ?? null,
      description: input.description ?? null,
      qualityScorePredicted: input.qualityScorePredicted ?? null,
      qualityScoreActual: input.qualityScoreActual ?? null,
      costTotalUsd: input.costTotalUsd ?? null,
      status: input.status,
    });
    return rowToLaunchEntry(assertLaunchExists(launchId));
  };

  const getLaunch = (launchId: string): ProductLaunchEntry | undefined => {
    const row = getExistingLaunch(launchId);
    return row ? rowToLaunchEntry(row) : undefined;
  };

  const updateLaunchStatus = (
    launchId: string,
    status: ProductLaunchStatus,
  ): ProductLaunchEntry => {
    const existing = assertLaunchExists(launchId);
    if (!isValidTransition(existing.status, status)) {
      throw new Error(`Invalid launch state transition: "${existing.status}" → "${status}"`);
    }
    const isTerminal = status === "ready_to_publish" || status === "rejected";
    updateStatusStmt.run({
      launchId,
      status,
      completedAt: isTerminal ? new Date().toISOString() : null,
    });
    return rowToLaunchEntry(assertLaunchExists(launchId));
  };

  const getLaunchesByProduct = (productId: string): ProductLaunchEntry[] => {
    return (selectLaunchesByProductStmt.all(productId) as ProductLaunchRow[]).map(rowToLaunchEntry);
  };

  const getPendingLaunchByChatId = (chatId: string): ProductLaunchEntry | undefined => {
    const row = selectPendingByChatIdStmt.get(chatId) as ProductLaunchRow | undefined;
    return row ? rowToLaunchEntry(row) : undefined;
  };

  return {
    upsertProduct,
    getProduct,
    upsertImage,
    getImages,
    createLaunch,
    getLaunch,
    updateLaunchStatus,
    getLaunchesByProduct,
    getPendingLaunchByChatId,
  };
}
