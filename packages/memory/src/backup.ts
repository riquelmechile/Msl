import Database from "better-sqlite3";

/**
 * Backup a source database to a destination file using SQLite's online
 * backup API.  The backup runs incrementally, so it does not block
 * concurrent reads; writes during the backup are reflected transparently.
 *
 * Uses `better-sqlite3`'s `.backup()` method which wraps the C-level
 * `sqlite3_backup_init` / `sqlite3_backup_step` / `sqlite3_backup_finish`
 * APIs.  After the backup completes, an optional `VACUUM` compacts the
 * destination.
 *
 * @param sourceDb — the live database to back up.
 * @param destPath — absolute or relative path for the backup file.
 *   If the file already exists it is **overwritten**.
 * @param vacuum — when `true`, compacts the backup so it uses minimal
 *   disk space (calls `VACUUM` on the destination after backup).
 *   Defaults to `true`.
 * @returns the number of pages copied.
 */
export async function backupDatabase(
  sourceDb: Database.Database,
  destPath: string,
  vacuum = true,
): Promise<number> {
  // Use SQLite's online backup API to copy the live DB to a file.
  await sourceDb.backup(destPath);

  if (vacuum) {
    // Compact the backup to reclaim free pages.
    const backupFile = new Database(destPath);
    try {
      backupFile.exec("VACUUM");
    } finally {
      backupFile.close();
    }
  }

  // Count pages in the backup
  const backupFile = new Database(destPath);
  try {
    const rows = backupFile
      .prepare("SELECT page_count FROM pragma_page_count")
      .all() as Array<{ page_count: number }>;
    return rows[0]?.page_count ?? 0;
  } finally {
    backupFile.close();
  }
}
