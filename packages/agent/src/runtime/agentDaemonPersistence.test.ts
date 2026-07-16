import { expect, describe, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAgentDaemonPersistenceRuntime,
  resolveProductLaunchRuntimePath,
} from "./agentDaemonPersistence.js";

describe("AgentDaemonPersistenceRuntime", () => {
  it("uses one explicit launch runtime path with the cortex path as the shared default", () => {
    expect(resolveProductLaunchRuntimePath({}, "/data/cortex.sqlite")).toBe("/data/cortex.sqlite");
    expect(
      resolveProductLaunchRuntimePath(
        { MSL_PRODUCT_LAUNCH_SQLITE_PATH: " /data/launch.sqlite " },
        "/data/cortex.sqlite",
      ),
    ).toBe("/data/launch.sqlite");
  });

  it("keeps launch state and messages in the same runtime database", () => {
    const directory = join(tmpdir(), `msl-launch-runtime-${Date.now()}`);
    const databasePath = join(directory, "launch.sqlite");
    rmSync(directory, { recursive: true, force: true });
    try {
      mkdirSync(directory, { recursive: true });
      const runtime = createAgentDaemonPersistenceRuntime(databasePath);
      runtime.productCatalogStore.upsertProduct({ productId: "product-1" });
      runtime.productCatalogStore.createLaunch({
        launchId: "launch-1",
        productId: "product-1",
        sellerId: "seller-1",
        status: "photo_received",
        createdAt: new Date().toISOString(),
      });
      runtime.bus.enqueue({
        senderAgentId: "telegram-bot",
        receiverAgentId: "product-launch",
        messageType: "launch_request",
        payloadJson: "{}",
        sellerId: "seller-1",
      });
      runtime.close();

      const persisted = new Database(databasePath, { readonly: true });
      expect(persisted.prepare("SELECT COUNT(*) AS count FROM product_launches").get()).toEqual({
        count: 1,
      });
      expect(persisted.prepare("SELECT COUNT(*) AS count FROM agent_message_bus").get()).toEqual({
        count: 1,
      });
      persisted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
