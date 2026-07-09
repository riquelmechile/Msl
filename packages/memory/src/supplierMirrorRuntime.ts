import Database from "better-sqlite3";
import type { SupplierMirrorStore } from "./supplierMirrorStore.js";
import { createSqliteSupplierMirrorStore } from "./supplierMirrorStore.js";

let sharedStore: SupplierMirrorStore | null = null;
let sharedDb: Database.Database | null = null;
let sharedPath: string | null = null;

export function getSupplierMirrorRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
): {
  store: SupplierMirrorStore;
  close: () => void;
} | null {
  const dbPath = env.MSL_SUPPLIER_MIRROR_DB_PATH?.trim();
  if (!dbPath) return null;

  // Return cached instance if path hasn't changed
  if (sharedStore && sharedDb && sharedPath === dbPath) {
    return { store: sharedStore, close: () => {} };
  }

  // Close old connection if switching paths
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
    sharedStore = null;
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -8000");
  db.pragma("temp_store = MEMORY");

  const store = createSqliteSupplierMirrorStore(db);
  sharedDb = db;
  sharedStore = store;
  sharedPath = dbPath;

  return {
    store,
    close: () => {
      if (sharedDb) {
        sharedDb.close();
        sharedDb = null;
        sharedStore = null;
        sharedPath = null;
      }
    },
  };
}

/** For testing — reset the singleton */
export function resetSupplierMirrorRuntime(): void {
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
    sharedStore = null;
    sharedPath = null;
  }
}
