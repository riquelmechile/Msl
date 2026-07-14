import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEconomicMemoryRuntime,
  type EconomicWriteSessionClock,
} from "../src/economicWriteSession.js";

class FakeClock implements EconomicWriteSessionClock {
  private nowMs = 100;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now = (): number => this.nowMs;

  setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof setTimeout> => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    this.timers.delete(handle as unknown as number);
  };

  advance(ms: number): void {
    this.nowMs += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at > this.nowMs) continue;
      this.timers.delete(id);
      timer.callback();
    }
  }

  get pendingTimers(): number {
    return this.timers.size;
  }
}

async function flushRenewal(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function failedRun(runId: string) {
  return {
    runId,
    sellerId: "plasticov",
    mode: "incremental" as const,
    sourceKinds: ["orders"],
    startedAt: 100,
    completedAt: 100,
    recordsFetched: 0,
    recordsNormalized: 0,
    componentsCreated: 0,
    snapshotsCreated: 0,
    duplicatesIgnored: 0,
    partialSnapshots: 0,
    disputedSnapshots: 0,
    errors: ["invalidated"],
    status: "failed" as const,
    noExternalMutationExecuted: true as const,
  };
}

describe("economic write session renewal", () => {
  it("stops its pending renewal during release", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-write-renewal-stop-"));
    const databasePath = join(directory, "economic.sqlite");
    const clock = new FakeClock();
    const runtime = createEconomicMemoryRuntime({
      databasePath,
      now: clock.now,
      writeSessionClock: clock,
      writeSessionRenewalIntervalMs: 20,
    });
    try {
      const onInvalidated = vi.fn();
      const opened = await runtime.writeSessionFactory.open({
        sellerId: "plasticov",
        ownerRunId: "run-stop",
        receiptTtlMs: 1_000,
        onInvalidated,
      });
      expect(clock.pendingTimers).toBe(1);
      await opened.release();
      expect(clock.pendingTimers).toBe(0);
      expect(onInvalidated).not.toHaveBeenCalled();
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renews the admitted write session repeatedly while ownership remains valid", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-write-renewal-repeat-"));
    const databasePath = join(directory, "economic.sqlite");
    const clock = new FakeClock();
    const runtime = createEconomicMemoryRuntime({
      databasePath,
      now: clock.now,
      writeSessionClock: clock,
      writeSessionRenewalIntervalMs: 20,
    });
    const observer = new Database(databasePath);
    try {
      const onInvalidated = vi.fn();
      const opened = await runtime.writeSessionFactory.open({
        sellerId: "plasticov",
        ownerRunId: "run-repeat",
        receiptTtlMs: 1_000,
        onInvalidated,
      });
      const readExpiries = () =>
        observer
          .prepare(
            `SELECT fence.expires_at AS fence_expires_at, lease.expires_at AS lease_expires_at
             FROM economic_database_fence AS fence
             JOIN economic_seller_leases AS lease ON lease.seller_id = 'plasticov'`,
          )
          .get() as { fence_expires_at: number; lease_expires_at: number };
      const initial = readExpiries();
      clock.advance(20);
      await flushRenewal();
      const first = readExpiries();
      clock.advance(20);
      await flushRenewal();
      const second = readExpiries();
      expect(initial).toEqual({ fence_expires_at: 90_100, lease_expires_at: 60_100 });
      expect(first).toEqual({ fence_expires_at: 90_120, lease_expires_at: 60_120 });
      expect(second).toEqual({ fence_expires_at: 90_140, lease_expires_at: 60_140 });
      expect(onInvalidated).not.toHaveBeenCalled();
      expect(clock.pendingTimers).toBe(1);
      await opened.release();
      expect(clock.pendingTimers).toBe(0);
    } finally {
      observer.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renews both guarantees and invalidates before commit when ownership is replaced", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-write-renewal-loss-"));
    const databasePath = join(directory, "economic.sqlite");
    const clock = new FakeClock();
    const runtime = createEconomicMemoryRuntime({
      databasePath,
      now: clock.now,
      writeSessionClock: clock,
      writeSessionRenewalIntervalMs: 20,
    });
    const observer = new Database(databasePath);
    try {
      const controller = new AbortController();
      const onInvalidated = vi.fn(() => controller.abort("write-session-invalidated"));
      const opened = await runtime.writeSessionFactory.open({
        sellerId: "plasticov",
        ownerRunId: "run-loss",
        receiptTtlMs: 1_000,
        onInvalidated,
      });
      const initial = observer
        .prepare(
          `SELECT fence.expires_at AS fence_expires_at, lease.expires_at AS lease_expires_at
           FROM economic_database_fence AS fence
           JOIN economic_seller_leases AS lease ON lease.seller_id = 'plasticov'`,
        )
        .get() as { fence_expires_at: number; lease_expires_at: number };

      clock.advance(20);
      await flushRenewal();
      const renewed = observer
        .prepare(
          `SELECT fence.expires_at AS fence_expires_at, lease.expires_at AS lease_expires_at
           FROM economic_database_fence AS fence
           JOIN economic_seller_leases AS lease ON lease.seller_id = 'plasticov'`,
        )
        .get() as { fence_expires_at: number; lease_expires_at: number };
      expect(renewed.fence_expires_at).toBeGreaterThan(initial.fence_expires_at);
      expect(renewed.lease_expires_at).toBeGreaterThan(initial.lease_expires_at);

      observer
        .prepare(
          `UPDATE economic_seller_leases
           SET owner_run_id = 'replacement-run', lease_token_digest = 'replacement-token',
               generation = generation + 1
           WHERE seller_id = 'plasticov'`,
        )
        .run();
      clock.advance(20);
      await flushRenewal();

      expect(onInvalidated).toHaveBeenCalledOnce();
      expect(controller.signal.reason).toBe("write-session-invalidated");
      expect(clock.pendingTimers).toBe(0);
      await expect(
        opened.session.recordFailure({ run: failedRun("run-loss"), error: "invalidated" }),
      ).rejects.toThrow("Economic write session invalidated");
      await expect(opened.release()).rejects.toThrow("Economic seller lease release");
      expect(
        observer
          .prepare("SELECT owner_run_id FROM economic_seller_leases WHERE seller_id = 'plasticov'")
          .get(),
      ).toEqual({ owner_run_id: "replacement-run" });
      expect(
        observer
          .prepare("SELECT owner_run_id FROM economic_database_fence WHERE singleton = 1")
          .get(),
      ).toEqual({ owner_run_id: null });
    } finally {
      observer.close();
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cancels renewal on the caller signal without reporting ownership loss", async () => {
    const directory = mkdtempSync(join(tmpdir(), "msl-write-renewal-abort-"));
    const databasePath = join(directory, "economic.sqlite");
    const clock = new FakeClock();
    const runtime = createEconomicMemoryRuntime({
      databasePath,
      now: clock.now,
      writeSessionClock: clock,
      writeSessionRenewalIntervalMs: 20,
    });
    try {
      const controller = new AbortController();
      const onInvalidated = vi.fn();
      const opened = await runtime.writeSessionFactory.open({
        sellerId: "plasticov",
        ownerRunId: "run-abort",
        receiptTtlMs: 1_000,
        signal: controller.signal,
        onInvalidated,
      });
      controller.abort("shutdown");
      await flushRenewal();
      expect(clock.pendingTimers).toBe(0);
      expect(onInvalidated).not.toHaveBeenCalled();
      await opened.release();
    } finally {
      runtime.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
