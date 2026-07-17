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

  it("passes the shared launch persistence into the production scheduler", () => {
    const source = readFileSync(scriptPath, "utf8");
    const start = source.indexOf("const handle = startDaemonScheduler({");
    const schedulerConfig = source.slice(start, source.indexOf("});", start));

    expect(schedulerConfig).toContain(
      "productCatalogStore: persistenceRuntime.productCatalogStore",
    );
    expect(schedulerConfig).toContain("launchCostTracker: persistenceRuntime.launchCostTracker");
    expect(schedulerConfig).toContain(
      "creativeJobQueueStore: persistenceRuntime.creativeJobQueueStore",
    );
  });

  it("dispatches production creative jobs durably without leaving them queued", () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-agent-daemons-creative-"));
    const databasePath = join(directory, "studio.sqlite");
    const input = {
      jobId: "cj_runtime_001",
      requestId: "req_runtime_001",
      sellerId: "seller-runtime",
      kind: "storefront-hero",
      channel: "storefront",
      payloadJson: JSON.stringify({ title: "Durable storefront hero" }),
    };

    try {
      const firstRuntime = createAgentDaemonPersistenceRuntime(databasePath);
      const created = firstRuntime.creativeJobQueueStore.createJob(input);
      const duplicate = firstRuntime.creativeJobQueueStore.createJob(input);
      expect(created.status).toBe("provider-routing");
      expect(duplicate.status).toBe("provider-routing");
      expect(firstRuntime.bus.getPendingCount()).toBe(1);
      firstRuntime.close();

      const reopenedRuntime = createAgentDaemonPersistenceRuntime(databasePath);
      expect(reopenedRuntime.creativeJobQueueStore.getJob(input.jobId)).toMatchObject({
        seller_id: input.sellerId,
        status: "provider-routing",
      });
      expect(reopenedRuntime.creativeJobQueueStore.listByStatus("queued")).toHaveLength(0);
      const [message] = reopenedRuntime.bus.claimNext("creative-studio");
      expect(message).toMatchObject({
        senderAgentId: "owned-ecommerce",
        receiverAgentId: "creative-studio",
        messageType: "creative.asset.requested",
        status: "processing",
        sellerId: input.sellerId,
      });
      expect(JSON.parse(message.payloadJson)).toMatchObject({
        requestId: `cj_${input.requestId}`,
        sellerId: input.sellerId,
        kind: input.kind,
        channel: input.channel,
      });
      reopenedRuntime.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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
