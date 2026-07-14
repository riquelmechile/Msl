import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEconomicMigrationPlan } from "../src/migrationRegistry.js";
import { createSqliteEconomicIngestionRunStore } from "../src/economicIngestionRunStore.js";

type Opened = { db: Database.Database; directory: string };
const opened: Opened[] = [];
const fence = { generation: 1, tokenDigest: "checkpoint-writer", databaseGeneration: 1 } as const;

function openStore(name: string, now: () => number) {
  const directory = mkdtempSync(join(tmpdir(), `msl-r4b-${name}-`));
  const db = new Database(join(directory, "economic.sqlite"));
  db.pragma("foreign_keys = ON");
  createEconomicMigrationPlan().apply(db);
  opened.push({ db, directory });
  return { db, directory, store: createSqliteEconomicIngestionRunStore(db, { now }) };
}

afterEach(() => {
  while (opened.length > 0) {
    const resource = opened.pop();
    resource?.db.close();
    if (resource) rmSync(resource.directory, { recursive: true, force: true });
  }
});

const backlogInput = (sellerId = "plasticov") => ({
  sellerId,
  range: { from: 10, to: 20 },
  cursor: { afterOccurredAt: null, afterSourceRecordId: null },
  purpose: "claims-recovery" as const,
  reasonCode: "source-unavailable",
  retryable: true,
  retryAfterMs: null,
  runId: "run-a",
  fence,
});

describe("R4b durable Claims retry backlog", () => {
  it("migrates 1009 once and preserves restart-safe seller-scoped identities including null cursors", async () => {
    const time = 1_000;
    const { db, store } = openStore("restart", () => time);
    expect(createEconomicMigrationPlan().apply(db)).toEqual({ applied: 0, skipped: 11 });
    const first = await store.upsertClaimsBacklog!(backlogInput());
    const repeated = await store.upsertClaimsBacklog!(backlogInput());
    const otherSeller = await store.upsertClaimsBacklog!(backlogInput("maustian"));
    expect(first.identityKey).toHaveLength(64);
    expect(repeated.identityKey).toBe(first.identityKey);
    expect(otherSeller.identityKey).not.toBe(first.identityKey);
    expect(db.prepare("SELECT COUNT(*) AS count FROM economic_source_retry_backlog").get()).toEqual(
      { count: 2 },
    );
    db.close();
    const reopened = new Database(join(opened[0]!.directory, "economic.sqlite"));
    opened.push({ db: reopened, directory: opened[0]!.directory });
    const restarted = createSqliteEconomicIngestionRunStore(reopened, { now: () => time });
    expect(await restarted.upsertClaimsBacklog!(backlogInput())).toMatchObject({
      identityKey: first.identityKey,
    });
  });

  it("claims due work atomically, accounts attempts only at request start, and prevents an old worker completing a replacement", async () => {
    let time = 1_000;
    const { store } = openStore("lifecycle", () => time);
    const row = await store.upsertClaimsBacklog!(backlogInput());
    const first = await store.claimDueClaimsBacklog!({
      sellerId: "plasticov",
      ownerRunId: "worker-a",
      fence,
    });
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") throw new Error("expected claim");
    expect((await store.getClaimsBacklog!(row.identityKey))?.attemptCount).toBe(0);
    expect(await store.markClaimsRequestStarted!({ ...first.claim, fence })).toMatchObject({
      status: "started",
      attemptCount: 1,
    });
    expect(
      await store.retryClaimsBacklog!({
        ...first.claim,
        fence,
        reasonCode: "temporary-provider-failure",
        retryAfterMs: 50,
      }),
    ).toEqual({ status: "pending" });
    time += 50;
    const replacement = await store.claimDueClaimsBacklog!({
      sellerId: "plasticov",
      ownerRunId: "worker-b",
      fence,
    });
    expect(replacement.status).toBe("claimed");
    await expect(store.resolveClaimsBacklog!({ ...first.claim, fence })).resolves.toEqual({
      status: "stale-or-replaced",
    });
    if (replacement.status !== "claimed") throw new Error("expected replacement");
    await store.markClaimsRequestStarted!({ ...replacement.claim, fence });
    await expect(store.resolveClaimsBacklog!({ ...replacement.claim, fence })).resolves.toEqual({
      status: "resolved",
    });
  });

  it("recovers expired claims, returns global abort work to pending, dead-letters max attempts, and supports audited cancellation/replay", async () => {
    let time = 1_000;
    const { store } = openStore("recovery", () => time);
    const row = await store.upsertClaimsBacklog!(backlogInput());
    const claimed = await store.claimDueClaimsBacklog!({
      sellerId: "plasticov",
      ownerRunId: "worker-a",
      fence,
    });
    if (claimed.status !== "claimed") throw new Error("expected claim");
    expect(
      await store.returnClaimsBacklogToPending!({ ...claimed.claim, fence, requestStarted: false }),
    ).toEqual({ status: "pending" });
    const started = await store.claimDueClaimsBacklog!({
      sellerId: "plasticov",
      ownerRunId: "worker-a",
      fence,
    });
    if (started.status !== "claimed") throw new Error("expected claim");
    await store.markClaimsRequestStarted!({ ...started.claim, fence });
    time += 120_001;
    expect(await store.recoverExpiredClaimsBacklog!({ sellerId: "plasticov", fence })).toEqual({
      recovered: 1,
      deferred: 0,
    });
    expect((await store.getClaimsBacklog!(row.identityKey))?.attemptCount).toBe(1);
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = await store.claimDueClaimsBacklog!({
        sellerId: "plasticov",
        ownerRunId: `worker-${attempt}`,
        fence,
      });
      if (next.status !== "claimed") throw new Error("expected claim");
      await store.markClaimsRequestStarted!({ ...next.claim, fence });
      await store.retryClaimsBacklog!({
        ...next.claim,
        fence,
        reasonCode: "temporary-provider-failure",
        retryAfterMs: 0,
      });
    }
    expect((await store.getClaimsBacklog!(row.identityKey))?.state).toBe("dead-letter");
    expect(
      await store.replayClaimsBacklog!({
        sellerId: "plasticov",
        identityKey: row.identityKey,
        actor: "operator",
        approver: "owner",
        reason: "approved",
        fence,
      }),
    ).toEqual({ status: "replayed" });
    expect(
      await store.cancelClaimsBacklog!({
        sellerId: "plasticov",
        identityKey: row.identityKey,
        actor: "operator",
        approver: "owner",
        reason: "maintenance",
        fence,
      }),
    ).toEqual({ status: "administratively-cancelled" });
    expect((await store.getClaimsBacklog!(row.identityKey))?.state).toBe(
      "administratively-cancelled",
    );
  });

  it("rejects hostile Plasticov/Maustian admin mutation and writes seller-scoped audits", async () => {
    const { db, store } = openStore("admin-seller-isolation", () => 1_000);
    const plasticov = await store.upsertClaimsBacklog!(backlogInput("plasticov"));
    const maustian = await store.upsertClaimsBacklog!(backlogInput("maustian"));

    await expect(
      store.cancelClaimsBacklog!({
        sellerId: "maustian",
        identityKey: plasticov.identityKey,
        actor: "maustian-operator",
        approver: "maustian-owner",
        reason: "hostile-cancel",
        fence,
      }),
    ).resolves.toEqual({ status: "stale-or-replaced" });
    await expect(
      store.replayClaimsBacklog!({
        sellerId: "maustian",
        identityKey: plasticov.identityKey,
        actor: "maustian-operator",
        approver: "maustian-owner",
        reason: "hostile-replay",
        fence,
      }),
    ).resolves.toEqual({ status: "stale-or-replaced" });
    expect((await store.getClaimsBacklog!(plasticov.identityKey))?.state).toBe("pending");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM economic_source_retry_backlog_audit").get(),
    ).toEqual({ count: 0 });

    await expect(
      store.cancelClaimsBacklog!({
        sellerId: "plasticov",
        identityKey: plasticov.identityKey,
        actor: "plasticov-operator",
        approver: "plasticov-owner",
        reason: "approved-cancel",
        fence,
      }),
    ).resolves.toEqual({ status: "administratively-cancelled" });
    await expect(
      store.replayClaimsBacklog!({
        sellerId: "plasticov",
        identityKey: plasticov.identityKey,
        actor: "plasticov-operator",
        approver: "plasticov-owner",
        reason: "approved-replay",
        fence,
      }),
    ).resolves.toEqual({ status: "replayed" });

    expect((await store.getClaimsBacklog!(maustian.identityKey))?.state).toBe("pending");
    expect(
      db
        .prepare(
          "SELECT seller_id, action, actor, approver FROM economic_source_retry_backlog_audit ORDER BY audit_id",
        )
        .all(),
    ).toEqual([
      {
        seller_id: "plasticov",
        action: "administratively-cancelled",
        actor: "plasticov-operator",
        approver: "plasticov-owner",
      },
      {
        seller_id: "plasticov",
        action: "replayed",
        actor: "plasticov-operator",
        approver: "plasticov-owner",
      },
    ]);
  });

  it("creates one pending cancellation intent with exact safe fields and stays idempotent", async () => {
    const { db, store } = openStore("cancel-intent", () => 1_000);
    const backlog = await store.upsertClaimsBacklog!(backlogInput());
    const cancelled = {
      sellerId: "plasticov",
      identityKey: backlog.identityKey,
      actor: "operator@example.test",
      approver: "owner@example.test",
      reason: "customer@example.test requested maintenance",
      fence,
    };

    await expect(store.cancelClaimsBacklog!(cancelled)).resolves.toEqual({
      status: "administratively-cancelled",
    });
    await expect(store.cancelClaimsBacklog!(cancelled)).resolves.toEqual({
      status: "administratively-cancelled",
    });
    const intents = await store.listOperationalAlertIntents!({ sellerId: "plasticov" });
    expect(intents).toHaveLength(1);
    const [intent] = intents;
    if (!intent) throw new Error("expected operational alert intent");
    expect(intent.intentId).toMatch(/^[a-f0-9]{64}$/);
    expect(intent.dedupKey).toMatch(/^[a-f0-9]{64}$/);
    expect(intent).toMatchObject({
      sellerId: "plasticov",
      alertType: "claims-backlog-administratively-cancelled",
      severity: "warning",
      reasonCode: "administratively-cancelled",
      source: "claims",
      relatedBacklogIdentityKey: backlog.identityKey,
      cancellationVersion: 1,
      metadata: { cancellationVersion: 1, backlogState: "administratively-cancelled" },
      status: "pending",
    });
    expect(JSON.stringify(intent)).not.toContain("@example.test");
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM economic_source_retry_backlog_audit").get(),
    ).toEqual({ count: 1 });
    await expect(store.countPendingOperationalAlertIntents!("plasticov")).resolves.toBe(1);
  });

  it("keeps intent reads, listing, pending counts, and consumption seller scoped", async () => {
    const { store } = openStore("intent-seller-scope", () => 1_000);
    const plasticov = await store.upsertClaimsBacklog!(backlogInput("plasticov"));
    const maustian = await store.upsertClaimsBacklog!(backlogInput("maustian"));
    const plasticovIntent = await store.createOperationalAlertIntent!({
      sellerId: "plasticov",
      relatedBacklogIdentityKey: plasticov.identityKey,
    });
    await store.createOperationalAlertIntent!({
      sellerId: "maustian",
      relatedBacklogIdentityKey: maustian.identityKey,
    });

    expect(
      await store.getOperationalAlertIntent!({
        sellerId: "maustian",
        intentId: plasticovIntent.intent.intentId,
      }),
    ).toBeNull();
    await expect(
      store.listOperationalAlertIntents!({ sellerId: "maustian" }),
    ).resolves.toHaveLength(1);
    await expect(store.countPendingOperationalAlertIntents!("plasticov")).resolves.toBe(1);
    await expect(
      store.markOperationalAlertIntentConsumed!({
        sellerId: "maustian",
        intentId: plasticovIntent.intent.intentId,
      }),
    ).resolves.toEqual({ status: "wrong-seller" });
    await expect(
      store.markOperationalAlertIntentConsumed!({
        sellerId: "plasticov",
        intentId: "missing-intent",
      }),
    ).resolves.toEqual({ status: "not-found" });
    await expect(
      store.markOperationalAlertIntentConsumed!({
        sellerId: "plasticov",
        intentId: plasticovIntent.intent.intentId,
      }),
    ).resolves.toMatchObject({
      status: "consumed",
      intent: { status: "consumed" },
    });
    await expect(
      store.markOperationalAlertIntentConsumed!({
        sellerId: "plasticov",
        intentId: plasticovIntent.intent.intentId,
      }),
    ).resolves.toMatchObject({
      status: "already-consumed",
      intent: { status: "consumed" },
    });
    await expect(store.countPendingOperationalAlertIntents!("plasticov")).resolves.toBe(0);
  });

  it.each(["after-backlog", "after-audit", "after-intent", "before-commit"] as const)(
    "rolls back cancellation state, audit, health, and intent when %s faults",
    async (boundary) => {
      const directory = mkdtempSync(join(tmpdir(), `msl-r4b-fault-${boundary}-`));
      const db = new Database(join(directory, "economic.sqlite"));
      db.pragma("foreign_keys = ON");
      createEconomicMigrationPlan().apply(db);
      opened.push({ db, directory });
      const store = createSqliteEconomicIngestionRunStore(db, {
        now: () => 1_000,
        administrativeCancellationFaultInjector: (current) => {
          if (current === boundary) throw new Error(`fault:${boundary}`);
        },
      });
      const backlog = await store.upsertClaimsBacklog!(backlogInput());

      await expect(
        store.cancelClaimsBacklog!({
          sellerId: "plasticov",
          identityKey: backlog.identityKey,
          actor: "operator",
          approver: "owner",
          reason: "maintenance",
          fence,
        }),
      ).rejects.toThrow(`fault:${boundary}`);
      expect((await store.getClaimsBacklog!(backlog.identityKey))?.state).toBe("pending");
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM economic_source_retry_backlog_audit").get(),
      ).toEqual({ count: 0 });
      await expect(store.countPendingOperationalAlertIntents!("plasticov")).resolves.toBe(0);
      expect(await store.getSourceHealth!("plasticov", "claims")).toBeNull();
    },
  );

  it("enforces hostile seller/backlog integrity and passes quick/FK/orphan checks after reopen", async () => {
    const time = 1_000;
    const { db, directory, store } = openStore("intent-integrity", () => time);
    const plasticov = await store.upsertClaimsBacklog!(backlogInput("plasticov"));
    await expect(
      store.createOperationalAlertIntent!({
        sellerId: "maustian",
        relatedBacklogIdentityKey: plasticov.identityKey,
      }),
    ).rejects.toThrow("seller/backlog mismatch");
    await store.createOperationalAlertIntent!({
      sellerId: "plasticov",
      relatedBacklogIdentityKey: plasticov.identityKey,
    });
    db.close();
    const reopened = new Database(join(directory, "economic.sqlite"));
    reopened.pragma("foreign_keys = ON");
    opened.push({ db: reopened, directory });
    const restarted = createSqliteEconomicIngestionRunStore(reopened, { now: () => time });
    await expect(restarted.countPendingOperationalAlertIntents!("plasticov")).resolves.toBe(1);
    expect(reopened.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
    expect(reopened.pragma("foreign_key_check")).toEqual([]);
    expect(
      reopened
        .prepare(
          `SELECT COUNT(*) AS count FROM economic_operational_alert_intents AS intent
           LEFT JOIN economic_source_retry_backlog AS backlog
             ON backlog.backlog_identity_key = intent.related_backlog_identity_key
            AND backlog.seller_id = intent.seller_id
           WHERE backlog.backlog_identity_key IS NULL`,
        )
        .get(),
    ).toEqual({ count: 0 });
  });

  it("stores only bounded source health counters and readiness as the durable truth", async () => {
    const { db, store } = openStore("health", () => 1_000);
    const row = await store.upsertClaimsBacklog!(backlogInput());
    await store.recordSourceHealth!({
      sellerId: "plasticov",
      source: "claims",
      ready: false,
      reasonCode: "source-unavailable",
      requestedAt: 1_000,
      attempts: 1,
      pages: 0,
      records: 0,
      retryable: true,
      retryAt: 1_500,
      backlogIdentityKey: row.identityKey,
      fence,
    });
    await store.recordSourceHealth!({
      sellerId: "plasticov",
      source: "claims",
      ready: true,
      reasonCode: null,
      requestedAt: 999,
      attempts: 0,
      pages: 0,
      records: 0,
      retryable: false,
      retryAt: null,
      backlogIdentityKey: null,
      fence,
    });
    expect(await store.getSourceHealth!("plasticov", "claims")).toEqual({
      sellerId: "plasticov",
      source: "claims",
      ready: false,
      reasonCode: "source-unavailable",
      requestedAt: 1_000,
      attempts: 1,
      pages: 0,
      records: 0,
      retryable: true,
      retryAt: 1_500,
      backlogIdentityKey: row.identityKey,
      updatedAt: 1_000,
    });
    expect(
      db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'economic_source_health'",
        )
        .get(),
    ).not.toBeNull();
  });
});
