import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertSellerLeaseOwnershipInTx,
  createSqliteEconomicIngestionRunStore,
} from "../src/economicIngestionRunStore.js";
import { createEconomicMigrationPlan } from "../src/migrationRegistry.js";

type Opened = { db: Database.Database; directory: string };
const opened: Opened[] = [];
const fence = { generation: 1, tokenDigest: "checkpoint-writer", databaseGeneration: 1 } as const;

function openLeaseStore(name: string): Opened {
  const directory = mkdtempSync(join(tmpdir(), `msl-r4-${name}-`));
  const db = new Database(join(directory, "economic.sqlite"));
  createEconomicMigrationPlan().apply(db);
  opened.push({ db, directory });
  return { db, directory };
}

afterEach(() => {
  while (opened.length > 0) {
    const current = opened.pop();
    current?.db.close();
    if (current) rmSync(current.directory, { recursive: true, force: true });
  }
});

describe("R4 seller leases", () => {
  it("uses a durable seller-scoped lease with exact expiry, contention, and cross-seller isolation", async () => {
    let time = 1_000;
    const { db } = openLeaseStore("contention");
    const store = createSqliteEconomicIngestionRunStore(db, { now: () => time });
    const first = await store.acquireSellerLease!({
      sellerId: "plasticov",
      ownerRunId: "run-a",
      fence,
    });
    expect(first.status).toBe("acquired");
    if (first.status !== "acquired") throw new Error("expected acquired lease");
    expect(first.lease.token).toHaveLength(43);
    await expect(
      store.acquireSellerLease!({ sellerId: "plasticov", ownerRunId: "run-b", fence }),
    ).resolves.toMatchObject({ status: "held", ownerRunId: "run-a" });
    await expect(
      store.acquireSellerLease!({ sellerId: "maustian", ownerRunId: "run-b", fence }),
    ).resolves.toMatchObject({ status: "acquired" });
    time = first.lease.expiresAt;
    await expect(store.renewSellerLease!({ ...first.lease, fence })).resolves.toEqual({
      status: "expired",
    });
    await expect(
      store.acquireSellerLease!({ sellerId: "plasticov", ownerRunId: "run-b", fence }),
    ).resolves.toMatchObject({ status: "held" });
    time += 15_000;
    const recovered = await store.acquireSellerLease!({
      sellerId: "plasticov",
      ownerRunId: "run-b",
      fence,
    });
    expect(recovered.status).toBe("recovered");
    if (recovered.status !== "recovered") throw new Error("expected recovered lease");
    await expect(store.renewSellerLease!({ ...first.lease, fence })).resolves.toEqual({
      status: "not-owner",
    });
    await expect(store.releaseSellerLease!({ ...first.lease, fence })).resolves.toEqual({
      status: "not-owner",
    });
    await expect(store.renewSellerLease!({ ...recovered.lease, fence })).resolves.toMatchObject({
      status: "renewed",
    });
  });

  it("classifies hostile releases without deleting a replacement and rejects fence loss", async () => {
    const time = 1_000;
    const { db } = openLeaseStore("hostile");
    const store = createSqliteEconomicIngestionRunStore(db, { now: () => time });
    const acquired = await store.acquireSellerLease!({
      sellerId: "plasticov",
      ownerRunId: "run-a",
      fence,
    });
    if (acquired.status !== "acquired") throw new Error("expected acquired lease");
    await expect(
      store.releaseSellerLease!({ ...acquired.lease, token: "wrong-token", fence }),
    ).resolves.toEqual({ status: "lease-replaced" });
    await expect(
      store.releaseSellerLease!({ ...acquired.lease, generation: 2, fence }),
    ).resolves.toEqual({ status: "stale-generation" });
    await expect(
      store.releaseSellerLease!({ ...acquired.lease, ownerRunId: "other-run", fence }),
    ).resolves.toEqual({ status: "not-owner" });
    await expect(store.releaseSellerLease!({ ...acquired.lease, fence })).resolves.toEqual({
      status: "released",
    });
    await expect(store.releaseSellerLease!({ ...acquired.lease, fence })).resolves.toEqual({
      status: "already-released",
    });
    db.prepare(
      "UPDATE economic_database_fence SET state = 'blocked', generation = 2 WHERE singleton = 1",
    ).run();
    await expect(
      store.acquireSellerLease!({ sellerId: "plasticov", ownerRunId: "run-b", fence }),
    ).resolves.toEqual({ status: "database-fenced" });
  });

  it("rolls back final writes when immediate precommit lease ownership is lost", async () => {
    const time = 1_000;
    const { db } = openLeaseStore("precommit");
    const store = createSqliteEconomicIngestionRunStore(db, { now: () => time });
    const acquired = await store.acquireSellerLease!({
      sellerId: "plasticov",
      ownerRunId: "run-a",
      fence,
    });
    if (acquired.status !== "acquired") throw new Error("expected acquired lease");
    db.exec("CREATE TABLE final_write_probe (id TEXT PRIMARY KEY)");
    expect(() =>
      db.transaction(() => {
        assertSellerLeaseOwnershipInTx(db, acquired.lease, time);
        db.prepare("INSERT INTO final_write_probe (id) VALUES ('must-roll-back')").run();
        db.prepare("DELETE FROM economic_seller_leases WHERE seller_id = 'plasticov'").run();
        assertSellerLeaseOwnershipInTx(db, acquired.lease, time);
      })(),
    ).toThrow("seller lease rejected");
    expect(db.prepare("SELECT COUNT(*) AS count FROM final_write_probe").get()).toEqual({
      count: 0,
    });
  });

  it("classifies database-generation and fence loss on every lease operation", async () => {
    let time = 1_000;
    const { db } = openLeaseStore("fence-and-generation");
    const store = createSqliteEconomicIngestionRunStore(db, { now: () => time });
    const acquired = await store.acquireSellerLease!({
      sellerId: "plasticov",
      ownerRunId: "run-a",
      fence,
    });
    if (acquired.status !== "acquired") throw new Error("expected acquired lease");

    db.prepare("UPDATE economic_database_metadata SET generation = 2 WHERE singleton = 1").run();
    const staleDatabaseFence = { ...fence, databaseGeneration: 1 } as const;
    await expect(
      store.acquireSellerLease!({
        sellerId: "maustian",
        ownerRunId: "run-b",
        fence: staleDatabaseFence,
      }),
    ).resolves.toEqual({ status: "database-generation-mismatch" });
    await expect(
      store.renewSellerLease!({ ...acquired.lease, fence: staleDatabaseFence }),
    ).resolves.toEqual({
      status: "database-generation-mismatch",
    });
    await expect(
      store.releaseSellerLease!({ ...acquired.lease, fence: staleDatabaseFence }),
    ).resolves.toEqual({
      status: "database-generation-mismatch",
    });

    const currentDatabaseFence = { ...fence, databaseGeneration: 2 } as const;
    db.prepare("UPDATE economic_database_fence SET state = 'blocked' WHERE singleton = 1").run();
    await expect(
      store.acquireSellerLease!({
        sellerId: "maustian",
        ownerRunId: "run-b",
        fence: currentDatabaseFence,
      }),
    ).resolves.toEqual({ status: "database-fenced" });
    await expect(
      store.renewSellerLease!({ ...acquired.lease, fence: currentDatabaseFence }),
    ).resolves.toEqual({
      status: "database-fenced",
    });
    await expect(
      store.releaseSellerLease!({ ...acquired.lease, fence: currentDatabaseFence }),
    ).resolves.toEqual({
      status: "database-fenced",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM economic_seller_leases").get()).toEqual({
      count: 1,
    });
    time += 1;
  });

  it("does not let a hostile cross-seller release delete another seller's lease", async () => {
    const { db } = openLeaseStore("cross-seller-release");
    const store = createSqliteEconomicIngestionRunStore(db, { now: () => 1_000 });
    const plasticov = await store.acquireSellerLease!({
      sellerId: "plasticov",
      ownerRunId: "plasticov-run",
      fence,
    });
    const maustian = await store.acquireSellerLease!({
      sellerId: "maustian",
      ownerRunId: "maustian-run",
      fence,
    });
    if (plasticov.status !== "acquired" || maustian.status !== "acquired") {
      throw new Error("expected both seller leases");
    }

    await expect(
      store.releaseSellerLease!({ ...plasticov.lease, sellerId: "maustian", fence }),
    ).resolves.toEqual({ status: "not-owner" });
    expect(
      db
        .prepare("SELECT seller_id, owner_run_id FROM economic_seller_leases ORDER BY seller_id")
        .all(),
    ).toEqual([
      { seller_id: "maustian", owner_run_id: "maustian-run" },
      { seller_id: "plasticov", owner_run_id: "plasticov-run" },
    ]);
  });
});
