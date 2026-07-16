import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createProductCatalogStore } from "./productCatalogStore.js";
import type {
  ProductCatalogEntry,
  ProductImageEntry,
  ProductLaunchStatus,
  ProductLaunchStoreInput,
} from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────

const testProduct: ProductCatalogEntry = {
  productId: "prod-test-001",
  brand: "Samsung",
  model: "Galaxy S24",
  categoryMl: "MLC1234",
  gtin: "8806095355076",
};

const testImage: ProductImageEntry = {
  imageId: "img-test-001",
  productId: "prod-test-001",
  url: "https://example.com/photo.jpg",
  source: "lens",
  qualityScore: 85,
  width: 1200,
  height: 1200,
};

const testLaunch: ProductLaunchStoreInput = {
  launchId: "launch-test-001",
  productId: "prod-test-001",
  sellerId: "seller-test",
  status: "photo_received",
  createdAt: "2026-07-16T12:00:00.000Z",
};

// ── Schema ────────────────────────────────────────────────────────────

describe("ProductCatalogStore — schema", () => {
  it("creates catalog, image, launch, and launch-cost tables on an empty database", () => {
    const db = new Database(":memory:");
    createProductCatalogStore(db);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([
      "product_catalog",
      "product_images",
      "product_launch_cost_events",
      "product_launches",
    ]);
    db.close();
  });

  it("is idempotent — no error on repeated calls", () => {
    const db = new Database(":memory:");
    createProductCatalogStore(db);
    expect(() => createProductCatalogStore(db)).not.toThrow();
    db.close();
  });

  it("preserves rows across repeated factory calls", () => {
    const db = new Database(":memory:");
    const store1 = createProductCatalogStore(db);
    store1.upsertProduct(testProduct);

    const store2 = createProductCatalogStore(db);
    const found = store2.getProduct("prod-test-001");
    expect(found).not.toBeUndefined();
    expect(found!.brand).toBe("Samsung");
    db.close();
  });

  it("migrates a legacy product_launches table before creating the chat index", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE product_catalog (
        product_id TEXT PRIMARY KEY,
        gtin TEXT UNIQUE,
        brand TEXT,
        model TEXT,
        category_ml TEXT,
        attributes_json TEXT,
        first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_launched_at TEXT
      );
      CREATE TABLE product_launches (
        launch_id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL REFERENCES product_catalog(product_id),
        seller_id TEXT NOT NULL,
        ml_item_id TEXT,
        listing_type TEXT,
        price_amount INTEGER,
        price_currency TEXT,
        title TEXT,
        description TEXT,
        quality_score_predicted REAL,
        quality_score_actual REAL,
        cost_total_usd REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
    `);

    expect(() => createProductCatalogStore(db)).not.toThrow();
    const columns = db.pragma("table_info(product_launches)") as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain("chat_id");
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_pl_chat_id'").get(),
    ).toBeDefined();
    db.close();
  });
});

// ── Product Catalog CRUD ─────────────────────────────────────────────

describe("ProductCatalogStore — products", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createProductCatalogStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createProductCatalogStore(db);
  });

  it("upserts and retrieves a product", () => {
    store.upsertProduct(testProduct);
    const found = store.getProduct("prod-test-001");

    expect(found).not.toBeUndefined();
    expect(found!.brand).toBe("Samsung");
    expect(found!.model).toBe("Galaxy S24");
    expect(found!.gtin).toBe("8806095355076");
  });

  it("returns undefined for missing product", () => {
    expect(store.getProduct("nonexistent")).toBeUndefined();
  });

  it("upsert updates existing product fields", () => {
    store.upsertProduct(testProduct);
    store.upsertProduct({ ...testProduct, brand: "Samsung Updated", model: "Galaxy S25" });

    const found = store.getProduct("prod-test-001");
    expect(found!.brand).toBe("Samsung Updated");
    expect(found!.model).toBe("Galaxy S25");
    // unchanged fields preserved
    expect(found!.gtin).toBe("8806095355076");
  });

  it("handles multiple products independently", () => {
    store.upsertProduct(testProduct);
    store.upsertProduct({
      productId: "prod-test-002",
      brand: "Apple",
      model: "iPhone 16",
    });

    expect(store.getProduct("prod-test-001")!.brand).toBe("Samsung");
    expect(store.getProduct("prod-test-002")!.brand).toBe("Apple");
  });
});

// ── Product Images CRUD ──────────────────────────────────────────────

describe("ProductCatalogStore — images", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createProductCatalogStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createProductCatalogStore(db);
  });

  it("upserts and retrieves images for a product", () => {
    store.upsertProduct(testProduct);
    store.upsertImage(testImage);

    const images = store.getImages("prod-test-001");
    expect(images).toHaveLength(1);
    expect(images[0]!.url).toBe("https://example.com/photo.jpg");
    expect(images[0]!.source).toBe("lens");
  });

  it("returns empty array for product with no images", () => {
    store.upsertProduct(testProduct);
    expect(store.getImages("prod-test-001")).toEqual([]);
  });

  it("upsert updates existing image", () => {
    store.upsertProduct(testProduct);
    store.upsertImage(testImage);
    store.upsertImage({ ...testImage, qualityScore: 42 });

    const images = store.getImages("prod-test-001");
    expect(images).toHaveLength(1);
    expect(images[0]!.qualityScore).toBe(42);
  });

  it("returns multiple images for a product", () => {
    store.upsertProduct(testProduct);
    store.upsertImage(testImage);
    store.upsertImage({
      ...testImage,
      imageId: "img-test-002",
      url: "https://example.com/photo2.jpg",
    });

    const images = store.getImages("prod-test-001");
    expect(images).toHaveLength(2);
    const imageIds = images.map((i) => i.imageId).sort();
    expect(imageIds).toEqual(["img-test-001", "img-test-002"]);
  });
});

// ── Product Launches CRUD ────────────────────────────────────────────

describe("ProductCatalogStore — launches", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createProductCatalogStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createProductCatalogStore(db);
    store.upsertProduct(testProduct);
  });

  it("creates and retrieves a launch", () => {
    const created = store.createLaunch(testLaunch);

    expect(created.launchId).toBe("launch-test-001");
    expect(created.status).toBe("photo_received");
    expect(created.productId).toBe("prod-test-001");

    const found = store.getLaunch("launch-test-001");
    expect(found).not.toBeUndefined();
    expect(found!.sellerId).toBe("seller-test");
  });

  it("returns undefined for missing launch", () => {
    expect(store.getLaunch("nonexistent")).toBeUndefined();
  });

  it("is idempotent — createLaunch returns existing if same launchId", () => {
    store.createLaunch(testLaunch);
    const second = store.createLaunch({
      ...testLaunch,
      sellerId: "different-seller",
    });

    // Must return the ORIGINAL, not the different-seller one
    expect(second.sellerId).toBe("seller-test");
  });

  it("auto-generates launchId when not provided", () => {
    const created = store.createLaunch({
      productId: "prod-test-001",
      sellerId: "seller-test",
      status: "photo_received",
      createdAt: "2026-07-16T12:00:00.000Z",
    });

    expect(created.launchId).toBeTruthy();
    expect(created.launchId.length).toBeGreaterThan(10);
  });

  it("updates launch status", () => {
    store.createLaunch(testLaunch);
    const updated = store.updateLaunchStatus("launch-test-001", "recognizing");

    expect(updated.status).toBe("recognizing");
  });

  it("atomically rejects duplicate, out-of-order, and cross-seller transitions", () => {
    store.createLaunch(testLaunch);

    expect(
      store.transitionLaunchStatus(
        "launch-test-001",
        "seller-test",
        "photo_received",
        "recognizing",
      )?.status,
    ).toBe("recognizing");
    expect(
      store.transitionLaunchStatus(
        "launch-test-001",
        "seller-test",
        "photo_received",
        "recognizing",
      ),
    ).toBeUndefined();
    expect(
      store.transitionLaunchStatus("launch-test-001", "other-seller", "recognizing", "researching"),
    ).toBeUndefined();
  });

  it("scopes pending chat launches to the seller", () => {
    store.createLaunch({ ...testLaunch, chatId: "chat-1" });
    store.createLaunch({
      ...testLaunch,
      launchId: "launch-test-002",
      sellerId: "other-seller",
      chatId: "chat-1",
    });

    expect(store.getPendingLaunchByChatId("chat-1", "seller-test")?.launchId).toBe(
      "launch-test-001",
    );
    expect(store.getPendingLaunchByChatId("chat-1", "other-seller")?.launchId).toBe(
      "launch-test-002",
    );
  });

  it("persists cost events idempotently across store recreation", () => {
    store.createLaunch(testLaunch);
    const event = {
      eventKey: "launch-cost:vision",
      launchId: "launch-test-001",
      sellerId: "seller-test",
      source: "google_lens" as const,
      operation: "vision-recognition",
      amountUsd: 0.005,
      measuredAt: "2026-07-16T12:01:00.000Z",
    };

    expect(store.recordLaunchCost(event)).toEqual({ recorded: true, totalUsd: 0.005 });
    expect(store.recordLaunchCost(event)).toEqual({ recorded: false, totalUsd: 0.005 });

    const reopened = createProductCatalogStore(db);
    expect(reopened.getLaunchForSeller("launch-test-001", "seller-test")?.costTotalUsd).toBe(0.005);
    expect(reopened.recordLaunchCost(event)).toEqual({ recorded: false, totalUsd: 0.005 });
  });

  it("sets completedAt on terminal states", () => {
    store.createLaunch(testLaunch);
    store.updateLaunchStatus("launch-test-001", "recognizing");
    store.updateLaunchStatus("launch-test-001", "researching");
    store.updateLaunchStatus("launch-test-001", "generating_creative");
    store.updateLaunchStatus("launch-test-001", "composing");
    store.updateLaunchStatus("launch-test-001", "awaiting_approval");
    const rejected = store.updateLaunchStatus("launch-test-001", "rejected");

    expect(rejected.status).toBe("rejected");
    expect(rejected.completedAt).toBeTruthy();

    // Also for ready_to_publish
    store.createLaunch({ ...testLaunch, launchId: "launch-test-002" });
    store.updateLaunchStatus("launch-test-002", "recognizing");
    store.updateLaunchStatus("launch-test-002", "researching");
    store.updateLaunchStatus("launch-test-002", "generating_creative");
    store.updateLaunchStatus("launch-test-002", "composing");
    store.updateLaunchStatus("launch-test-002", "awaiting_approval");
    store.updateLaunchStatus("launch-test-002", "approved");
    const published = store.updateLaunchStatus("launch-test-002", "ready_to_publish");

    expect(published.status).toBe("ready_to_publish");
    expect(published.completedAt).toBeTruthy();
  });

  it("throws on update of missing launch", () => {
    expect(() => store.updateLaunchStatus("nonexistent", "recognizing")).toThrow(/not found/);
  });

  it("getLaunchesByProduct returns all launches for a product", () => {
    store.createLaunch(testLaunch);
    store.createLaunch({ ...testLaunch, launchId: "launch-test-002" });

    const launches = store.getLaunchesByProduct("prod-test-001");
    expect(launches).toHaveLength(2);
    expect(launches.map((l) => l.launchId).sort()).toEqual(["launch-test-001", "launch-test-002"]);
  });

  it("getLaunchesByProduct returns empty for product with no launches", () => {
    store.upsertProduct({ ...testProduct, productId: "prod-empty" });
    expect(store.getLaunchesByProduct("prod-empty")).toEqual([]);
  });
});

// ── Full lifecycle ────────────────────────────────────────────────────

describe("ProductCatalogStore — full lifecycle", () => {
  it("models a complete launch from photo to approval", () => {
    const db = new Database(":memory:");
    const store = createProductCatalogStore(db);

    // 1. Register product
    store.upsertProduct(testProduct);

    // 2. Add reference images
    store.upsertImage(testImage);

    // 3. Create launch
    store.createLaunch(testLaunch);

    // 4. Progress through states
    const states: ProductLaunchStatus[] = [
      "recognizing",
      "researching",
      "generating_creative",
      "composing",
      "awaiting_approval",
      "approved",
      "ready_to_publish",
    ];

    let currentStatus: ProductLaunchStatus = "photo_received";
    for (const next of states) {
      const updated = store.updateLaunchStatus("launch-test-001", next);
      currentStatus = updated.status;
      expect(currentStatus).toBe(next);
    }

    expect(currentStatus).toBe("ready_to_publish");

    // 5. Verify final state
    const launch = store.getLaunch("launch-test-001");
    expect(launch!.status).toBe("ready_to_publish");
    expect(launch!.completedAt).toBeTruthy();

    // 6. Images are intact
    const images = store.getImages("prod-test-001");
    expect(images).toHaveLength(1);

    db.close();
  });
});
