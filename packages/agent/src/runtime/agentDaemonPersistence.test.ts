import { expect, describe, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAgentDaemonPersistenceRuntime } from "./agentDaemonPersistence.js";

describe("AgentDaemonPersistenceRuntime", () => {
  it("rejects generic restore without renaming the economic database", async () => {
    const directory = join(tmpdir(), `msl-daemon-restore-${Date.now()}`);
    const targetPath = join(directory, "economic.db");
    const backupPath = join(directory, "generic-backup.db");
    rmSync(directory, { recursive: true, force: true });
    try {
      mkdirSync(directory, { recursive: true });
      const target = new Database(targetPath);
      target.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('original')");
      target.close();
      const backup = new Database(backupPath);
      backup.exec("CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('backup')");
      backup.close();

      const runtime = createAgentDaemonPersistenceRuntime(targetPath);
      await expect(runtime.databaseManager.restoreFrom(backupPath)).rejects.toThrow(/forbidden/i);
      runtime.close();

      const unchanged = new Database(targetPath, { readonly: true });
      expect(unchanged.prepare("SELECT value FROM marker").get()).toEqual({ value: "original" });
      unchanged.close();
      expect(existsSync(targetPath)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
