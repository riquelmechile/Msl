import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EconomicDatabaseLifecycleError,
  createEconomicDatabaseLifecycle,
  type EconomicDatabaseFenceIdentity,
} from "./economicDatabaseLifecycle.js";

const fence = (): EconomicDatabaseFenceIdentity => ({
  ownerRunId: "restore-run",
  generation: 4,
  token: "secret",
  databaseGeneration: 8,
  expiresAt: 1_100,
});

let nextPath = 0;
const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const release of cleanup.splice(0).reverse()) release();
});

function setup(path = `/var/lib/msl/../msl/economic-${nextPath++}.db`, authority: object = {}) {
  let liveFence = fence();
  let now = 1_000;
  const lifecycle = createEconomicDatabaseLifecycle({
    path,
    authority,
    now: () => now,
    readFence: () => liveFence,
    drainTimeoutMs: 20,
  });
  cleanup.push(() => lifecycle.release());
  return {
    lifecycle,
    setFence: (next: EconomicDatabaseFenceIdentity) => (liveFence = next),
    expire: () => (now = 1_100),
  };
}

function register(
  lifecycle: ReturnType<typeof createEconomicDatabaseLifecycle>,
  participant: Parameters<typeof lifecycle.register>[0],
) {
  const registration = lifecycle.register(participant);
  cleanup.push(() => registration.release());
  return registration;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("EconomicDatabaseLifecycle", () => {
  it("registers participants by canonical path and invalidates epoch-bound permits", async () => {
    const { lifecycle } = setup();
    const invalidate = vi.fn();
    const registration = register(lifecycle, { invalidate });
    expect(lifecycle.path).toContain("/var/lib/msl/economic-");

    const permit = lifecycle.admitWrite(fence());
    expect(await lifecycle.withWritePermit(permit, () => "written")).toBe("written");
    await lifecycle.enterDraining(fence());

    expect(invalidate).toHaveBeenCalledOnce();
    expect(() => registration.assertCurrent()).toThrow("ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED");
    await expect(lifecycle.withWritePermit(permit, () => "mutated")).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    });
  });

  it("rejects stale, expired, mismatched, and concurrent fences before mutation", async () => {
    const { lifecycle, setFence, expire } = setup();
    const invalidate = vi.fn();
    register(lifecycle, { invalidate });

    setFence({ ...fence(), generation: 5 });
    expect(() => lifecycle.admitWrite(fence())).toThrow("ECONOMIC_DATABASE_FENCE_REJECTED");
    expect(invalidate).not.toHaveBeenCalled();

    setFence(fence());
    expire();
    expect(() => lifecycle.admitWrite(fence())).toThrow("ECONOMIC_DATABASE_FENCE_REJECTED");
    expect(invalidate).not.toHaveBeenCalled();

    const active = setup();
    const secondInvalidate = vi.fn();
    register(active.lifecycle, { invalidate: secondInvalidate });
    const first = active.lifecycle.enterDraining(fence());
    await expect(active.lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_DRAINING",
    });
    await first;
    expect(secondInvalidate).toHaveBeenCalledOnce();
  });

  it("rejects a replaced or expired live fence after permit issuance without mutation", async () => {
    const replaced = setup();
    const admittedFence = fence();
    const replacedPermit = replaced.lifecycle.admitWrite(admittedFence);
    const replacedOperation = vi.fn();
    Object.assign(admittedFence, { token: "replacement" });
    replaced.setFence(admittedFence);
    await expect(
      replaced.lifecycle.withWritePermit(replacedPermit, replacedOperation),
    ).rejects.toMatchObject({ code: "ECONOMIC_DATABASE_FENCE_REJECTED" });
    expect(replacedOperation).not.toHaveBeenCalled();

    const expired = setup();
    const expiredPermit = expired.lifecycle.admitWrite(fence());
    const expiredOperation = vi.fn();
    expired.expire();
    await expect(
      expired.lifecycle.withWritePermit(expiredPermit, expiredOperation),
    ).rejects.toMatchObject({ code: "ECONOMIC_DATABASE_FENCE_REJECTED" });
    expect(expiredOperation).not.toHaveBeenCalled();
  });

  it("joins distinct equivalent path spellings to one canonical lifecycle", async () => {
    const authority = {};
    const first = setup("/var/lib/msl/../msl/shared-economic.db", authority);
    const second = setup("/var/lib/./msl/shared-economic.db", authority);
    expect(second.lifecycle).not.toBe(first.lifecycle);

    const permit = first.lifecycle.admitWrite(fence());
    await second.lifecycle.enterDraining(fence());
    await expect(first.lifecycle.withWritePermit(permit, () => undefined)).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    });
  });

  it("fails closed when an equivalent path is acquired with another fence authority", () => {
    const path = "/var/lib/msl/../msl/incompatible-authority.db";
    setup(path, {});

    expect(() => setup(path, {})).toThrow("ECONOMIC_DATABASE_LIFECYCLE_AUTHORITY_REJECTED");
  });

  it("idempotently releases leases and registrations and rejects every released-handle operation", async () => {
    const { lifecycle } = setup();
    const permit = lifecycle.admitWrite(fence());
    const registration = register(lifecycle, { invalidate: vi.fn() });
    registration.release();
    registration.release();
    lifecycle.release();
    lifecycle.release();

    expect(() => lifecycle.register({ invalidate: vi.fn() })).toThrow(
      "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    );
    expect(() => lifecycle.admitWrite(fence())).toThrow("ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED");
    await expect(lifecycle.withWritePermit(permit, () => undefined)).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    });
    await expect(lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    });
    await expect(lifecycle.reopen(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    });
    await expect(lifecycle.recover(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    });
  });

  it("evicts a quiesced released path and recreates fresh state for a new authority", async () => {
    const path = "/var/lib/msl/../msl/recreated-authority.db";
    const original = setup(path, {});
    const registration = register(original.lifecycle, { invalidate: vi.fn() });
    await original.lifecycle.enterDraining(fence());
    registration.release();
    original.lifecycle.release();

    const recreated = setup(path, {});
    expect(recreated.lifecycle).not.toBe(original.lifecycle);
    expect(recreated.lifecycle.state).toBe("open");
    expect(recreated.lifecycle.epoch).toBe(0);
    await expect(
      recreated.lifecycle.withWritePermit(recreated.lifecycle.admitWrite(fence()), () => "fresh"),
    ).resolves.toBe("fresh");
  });

  it("defers final-owner cleanup until participants release and rejects released handles", () => {
    const path = "/var/lib/msl/../msl/deferred-cleanup.db";
    const authority = {};
    const active = setup(path, authority);
    const registration = register(active.lifecycle, { invalidate: vi.fn() });
    active.lifecycle.release();

    expect(() => active.lifecycle.register({ invalidate: vi.fn() })).toThrow(
      "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
    );
    expect(() => setup(path, {})).toThrow("ECONOMIC_DATABASE_LIFECYCLE_AUTHORITY_REJECTED");

    registration.release();
    expect(() => setup(path, {})).not.toThrow();
  });

  it("retains blocked state until explicit recovery rather than evicting unsafely", async () => {
    const path = "/var/lib/msl/../msl/blocked-retention.db";
    const authority = {};
    const blocked = setup(path, authority);
    const recovery = setup(path, authority);
    const registration = register(blocked.lifecycle, {
      invalidate: () => Promise.reject(new Error("failed")),
    });
    await expect(blocked.lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    registration.release();
    blocked.lifecycle.release();
    expect(() => setup(path, {})).toThrow("ECONOMIC_DATABASE_LIFECYCLE_AUTHORITY_REJECTED");

    await recovery.lifecycle.recover(fence());
    recovery.lifecycle.release();
    expect(() => setup(path, {})).not.toThrow();
  });

  it("defers final-owner cleanup until an admitted write finishes", async () => {
    const path = "/var/lib/msl/../msl/in-flight-cleanup.db";
    const active = setup(path, {});
    let finish!: () => void;
    const writing = active.lifecycle.withWritePermit(
      active.lifecycle.admitWrite(fence()),
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    active.lifecycle.release();

    expect(() => setup(path, {})).toThrow("ECONOMIC_DATABASE_LIFECYCLE_AUTHORITY_REJECTED");
    finish();
    await writing;
    expect(() => setup(path, {})).not.toThrow();
  });

  it("drains in-flight writes and stops renewals after invalidation before close", async () => {
    const { lifecycle } = setup();
    const order: string[] = [];
    let finishWrite!: () => void;
    register(lifecycle, {
      invalidate: () => {
        order.push("invalidate");
      },
      stopRenewals: () => {
        order.push("renewals");
      },
      drain: () => {
        order.push("participant-drain");
      },
      close: () => {
        order.push("close");
      },
    });
    const permit = lifecycle.admitWrite(fence());
    const writing = lifecycle.withWritePermit(
      permit,
      () => new Promise<void>((resolve) => (finishWrite = resolve)),
    );
    const draining = lifecycle.enterDraining(fence());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["invalidate", "renewals"]);
    finishWrite();
    await writing;
    await draining;
    expect(order).toEqual(["invalidate", "renewals", "participant-drain", "close"]);
  });

  it("blocks admission when draining or closing fails and only recovers explicitly", async () => {
    const { lifecycle } = setup();
    const reopen = vi.fn();
    register(lifecycle, {
      invalidate: vi.fn(),
      drain: () => Promise.reject(new Error("stuck writer")),
      reopen,
    });

    await expect(lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    expect(lifecycle.state).toBe("blocked");
    expect(() => lifecycle.admitWrite(fence())).toThrow("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
    expect(() => lifecycle.register({ invalidate: vi.fn() })).toThrow(
      "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    );

    await lifecycle.recover(fence());
    expect(lifecycle.state).toBe("open");
    expect(reopen).toHaveBeenCalledOnce();
    expect(lifecycle.admitWrite(fence()).epoch).toBeGreaterThan(0);

    const closeFailure = setup();
    register(closeFailure.lifecycle, {
      invalidate: vi.fn(),
      close: () => Promise.reject(new Error("close failed")),
    });
    await expect(closeFailure.lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    expect(closeFailure.lifecycle.state).toBe("blocked");
    await closeFailure.lifecycle.recover(fence());

    const lateMismatch = setup(),
      supplied = fence(),
      close = vi.fn();
    register(lateMismatch.lifecycle, {
      invalidate: vi.fn(),
      drain: () => {
        lateMismatch.setFence(supplied);
        Object.assign(supplied, { token: "replacement" });
      },
      close,
    });
    await expect(lateMismatch.lifecycle.enterDraining(supplied)).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_FENCE_REJECTED",
    });
    expect(close).not.toHaveBeenCalled();
    expect(lateMismatch.lifecycle.state).toBe("blocked");
    lateMismatch.setFence(fence());
    await lateMismatch.lifecycle.recover(fence());
  });

  it("times out bounded drain waits and rejects stale permits after reopen", async () => {
    const { lifecycle } = setup();
    const drain = deferred();
    register(lifecycle, {
      invalidate: vi.fn(),
      drain: () => drain.promise,
    });
    const permit = lifecycle.admitWrite(fence());
    await expect(lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    await expect(lifecycle.recover(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    drain.resolve();
    await vi.waitFor(() => lifecycle.recover(fence()));
    await expect(lifecycle.withWritePermit(permit, () => undefined)).rejects.toBeInstanceOf(
      EconomicDatabaseLifecycleError,
    );
  });

  it("bounds hanging invalidation and renewal hooks before destructive readiness", async () => {
    const invalidation = setup();
    const invalidated = deferred();
    const invalidationClose = vi.fn();
    register(invalidation.lifecycle, {
      invalidate: () => invalidated.promise,
      close: invalidationClose,
    });
    const draining = invalidation.lifecycle.enterDraining(fence());
    expect(() => invalidation.lifecycle.register({ invalidate: vi.fn() })).toThrow(
      "ECONOMIC_DATABASE_LIFECYCLE_DRAINING",
    );
    await expect(draining).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    expect(invalidation.lifecycle.state).toBe("blocked");
    expect(invalidationClose).not.toHaveBeenCalled();
    invalidated.resolve();
    await vi.waitFor(() => invalidation.lifecycle.recover(fence()));

    const renewal = setup();
    const renewed = deferred();
    const renewalClose = vi.fn();
    register(renewal.lifecycle, {
      invalidate: vi.fn(),
      stopRenewals: () => renewed.promise,
      close: renewalClose,
    });
    await expect(renewal.lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    expect(renewal.lifecycle.state).toBe("blocked");
    expect(renewalClose).not.toHaveBeenCalled();
    renewed.resolve();
    await vi.waitFor(() => renewal.lifecycle.recover(fence()));
  });

  it("reopens a quiesced lifecycle and recovers a blocked lifecycle with a live fence", async () => {
    const quiesced = setup();
    const quiescedReopen = vi.fn();
    register(quiesced.lifecycle, { invalidate: vi.fn(), reopen: quiescedReopen });
    await quiesced.lifecycle.enterDraining(fence());
    await quiesced.lifecycle.reopen(fence());
    expect(quiesced.lifecycle.state).toBe("open");
    expect(quiescedReopen).toHaveBeenCalledOnce();
    expect(quiesced.lifecycle.admitWrite(fence()).epoch).toBeGreaterThan(0);
    await quiesced.lifecycle.enterDraining(fence());
    expect(() => quiesced.lifecycle.register({ invalidate: vi.fn() })).toThrow(
      "ECONOMIC_DATABASE_LIFECYCLE_DRAINING",
    );

    const blocked = setup();
    register(blocked.lifecycle, {
      invalidate: () => Promise.reject(new Error("failed")),
    });
    await expect(blocked.lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    await blocked.lifecycle.recover(fence());
    expect(blocked.lifecycle.state).toBe("open");
  });

  it("keeps admission closed between participant reopen and the synchronous admission commit", async () => {
    const { lifecycle } = setup();
    const reopened = vi.fn();
    register(lifecycle, { invalidate: vi.fn(), reopen: reopened });
    await lifecycle.enterDraining(fence());

    await lifecycle.prepareReopen(fence());
    expect(reopened).toHaveBeenCalledOnce();
    expect(lifecycle.state).toBe("quiesced");
    expect(() => lifecycle.admitWrite(fence())).toThrow("ECONOMIC_DATABASE_LIFECYCLE_DRAINING");

    lifecycle.commitReopen(fence());
    expect(lifecycle.state).toBe("open");
    await expect(
      lifecycle.withWritePermit(lifecycle.admitWrite(fence()), () => "admitted"),
    ).resolves.toBe("admitted");
  });

  it("bounds a hanging reopen hook and blocks the lifecycle", async () => {
    const hanging = setup();
    const reopened = deferred();
    const registration = register(hanging.lifecycle, {
      invalidate: vi.fn(),
      reopen: () => reopened.promise,
    });
    await hanging.lifecycle.enterDraining(fence());
    await expect(hanging.lifecycle.reopen(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    expect(hanging.lifecycle.state).toBe("blocked");
    reopened.resolve();
    registration.release();
    await vi.waitFor(() => hanging.lifecycle.recover(fence()));
  });

  it("keeps recovery closed until timed-out writes and hooks settle", async () => {
    const writing = setup();
    const write = deferred();
    const operation = writing.lifecycle.withWritePermit(
      writing.lifecycle.admitWrite(fence()),
      () => write.promise,
    );
    const draining = writing.lifecycle.enterDraining(fence());
    await expect(draining).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    await expect(writing.lifecycle.recover(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    write.resolve();
    await operation;
    await vi.waitFor(() => writing.lifecycle.recover(fence()));

    const closing = setup();
    const close = deferred();
    let lateSideEffect = false;
    register(closing.lifecycle, {
      invalidate: vi.fn(),
      close: async () => {
        await close.promise;
        lateSideEffect = true;
      },
    });
    await expect(closing.lifecycle.enterDraining(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    await expect(closing.lifecycle.recover(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    expect(closing.lifecycle.state).toBe("blocked");
    close.resolve();
    await close.promise;
    await vi.waitFor(() => expect(lateSideEffect).toBe(true));
    expect(closing.lifecycle.state).toBe("blocked");
    await vi.waitFor(() => closing.lifecycle.recover(fence()));
    expect(closing.lifecycle.state).toBe("open");
  });

  it("revalidates the fence between reopen hooks and before opening", async () => {
    const replaced = setup();
    const supplied = fence();
    const unsafeReopen = vi.fn();
    let replace = true;
    register(replaced.lifecycle, {
      invalidate: vi.fn(),
      reopen: () => {
        if (!replace) return;
        replace = false;
        Object.assign(supplied, { token: "replacement" });
        replaced.setFence(supplied);
      },
    });
    register(replaced.lifecycle, { invalidate: vi.fn(), reopen: unsafeReopen });
    await replaced.lifecycle.enterDraining(fence());
    await expect(replaced.lifecycle.reopen(supplied)).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_FENCE_REJECTED",
    });
    expect(unsafeReopen).not.toHaveBeenCalled();
    expect(replaced.lifecycle.state).toBe("blocked");
    replaced.setFence(fence());
    await replaced.lifecycle.recover(fence());

    const expired = setup();
    const laterReopen = vi.fn();
    let expire = true;
    register(expired.lifecycle, {
      invalidate: vi.fn(),
      reopen: () => {
        if (!expire) return;
        expire = false;
        expired.setFence({ ...fence(), expiresAt: 1_000 });
      },
    });
    register(expired.lifecycle, { invalidate: vi.fn(), reopen: laterReopen });
    await expired.lifecycle.enterDraining(fence());
    await expect(expired.lifecycle.reopen(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_FENCE_REJECTED",
    });
    expect(laterReopen).not.toHaveBeenCalled();
    expired.setFence(fence());
    await expired.lifecycle.recover(fence());
  });

  it("reserves one concurrent reopen and increments the epoch once", async () => {
    const { lifecycle } = setup();
    const reopen = deferred();
    register(lifecycle, { invalidate: vi.fn(), reopen: () => reopen.promise });
    await lifecycle.enterDraining(fence());
    const epoch = lifecycle.epoch;
    const first = lifecycle.reopen(fence());
    await vi.waitFor(() => expect(lifecycle.state).toBe("quiesced"));
    await expect(lifecycle.reopen(fence())).rejects.toMatchObject({
      code: "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED",
    });
    reopen.resolve();
    await first;
    expect(lifecycle.epoch).toBe(epoch + 1);
    expect(lifecycle.admitWrite(fence()).epoch).toBe(epoch + 1);
  });
});
