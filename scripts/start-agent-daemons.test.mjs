import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createAgentDaemonPersistenceRuntime } from "@msl/agent";
import * as memory from "@msl/memory";

const scriptPath = fileURLToPath(new URL("./start-agent-daemons.mjs", import.meta.url));

describe("agent daemon startup contract", () => {
  it("uses the admitted public memory boundary", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain("createAgentDaemonPersistenceRuntime");
    expect(source).not.toMatch(
      /\b(getSharedDb|getSharedManager|createSqliteEconomicOutcomeStore)\b/,
    );
    expect(memory).not.toHaveProperty("getSharedDb");
    expect(memory).not.toHaveProperty("getSharedManager");
    expect(memory).not.toHaveProperty("createSqliteEconomicOutcomeStore");
  });

  it("fails closed for generic economic restore while delegated capabilities remain usable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-agent-daemons-"));
    const durabilityEnabled = process.env.MSL_DURABILITY_ENABLED;
    process.env.MSL_DURABILITY_ENABLED = "true";
    const runtime = createAgentDaemonPersistenceRuntime(join(directory, "cortex.sqlite"));
    const enqueue = (messageType) =>
      runtime.bus.enqueue({
        senderAgentId: "system",
        receiverAgentId: "test",
        messageType,
        payloadJson: "{}",
      });
    try {
      enqueue("baseline");
      const backupPath = join(directory, "backup.sqlite");
      await runtime.databaseManager.backup(backupPath);
      enqueue("transient");
      await expect(runtime.databaseManager.restoreFrom(backupPath)).rejects.toThrow(/forbidden/i);
      expect(runtime.bus.getPendingCount()).toBe(2);
      enqueue("after-rejected-restore");
      expect(runtime.bus.getPendingCount()).toBe(3);
      await expect(
        runtime.databaseManager.backup(join(directory, "still-usable.sqlite")),
      ).resolves.toBeGreaterThan(0);
    } finally {
      runtime.close();
      if (durabilityEnabled === undefined) delete process.env.MSL_DURABILITY_ENABLED;
      else process.env.MSL_DURABILITY_ENABLED = durabilityEnabled;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
