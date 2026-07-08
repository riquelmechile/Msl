import Database from "better-sqlite3";

/**
 * Singleton connection pool for SQLite instances.
 *
 * All MSL packages share a single Database handle so that multiple
 * independent SQLite connections do not multiply file descriptors, WAL
 * files, or migration state.  Pass `":memory:"` (the default) for an
 * in-process ephemeral database; pass a file path for persistent storage.
 */
let sharedDb: Database.Database | null = null;
let sharedPath: string | null = null;

/**
 * Returns the shared {@link Database} instance, creating it on the
 * first call.
 *
 * @param path — SQLite file path; defaults to `":memory:"`.
 *   Subsequent calls with a *different* path will close the old
 *   connection and create a new one at the requested path.
 *   Pass the same path to reuse the existing handle.
 */
export function getSharedDb(path = ":memory:"): Database.Database {
  if (sharedDb && sharedPath === path) {
    return sharedDb;
  }

  // Close previous connection when switching paths.
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
    sharedPath = null;
  }

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -8000");
  db.pragma("temp_store = MEMORY");
  sharedDb = db;
  sharedPath = path;
  return db;
}

/**
 * Close the singleton connection and reset state.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function closeSharedDb(): void {
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
    sharedPath = null;
  }
}
