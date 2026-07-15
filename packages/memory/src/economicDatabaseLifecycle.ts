import { resolve } from "node:path";

export type EconomicDatabaseFenceIdentity = {
  readonly ownerRunId: string;
  readonly generation: number;
  readonly token: string;
  readonly databaseGeneration: number;
  readonly expiresAt: number;
};

export type EconomicDatabaseLifecycleParticipant = {
  invalidate(): void | Promise<void>;
  stopRenewals?(): void | Promise<void>;
  drain?(timeoutMs: number): void | Promise<void>;
  close?(): void | Promise<void>;
  reopen?(): void | Promise<void>;
};

export type EconomicWritePermit = {
  readonly path: string;
  readonly epoch: number;
  readonly fenceGeneration: number;
};

export type EconomicDatabaseLifecycleState = "open" | "draining" | "quiesced" | "blocked";

export class EconomicDatabaseLifecycleError extends Error {
  constructor(
    readonly code:
      | "ECONOMIC_DATABASE_FENCE_REJECTED"
      | "ECONOMIC_DATABASE_LIFECYCLE_AUTHORITY_REJECTED"
      | "ECONOMIC_DATABASE_LIFECYCLE_DRAINING"
      | "ECONOMIC_DATABASE_LIFECYCLE_BLOCKED"
      | "ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED",
  ) {
    super(code);
    this.name = "EconomicDatabaseLifecycleError";
  }
}

export type EconomicDatabaseLifecycle = {
  readonly path: string;
  readonly state: EconomicDatabaseLifecycleState;
  readonly epoch: number;
  register(participant: EconomicDatabaseLifecycleParticipant): {
    assertCurrent(): void;
    release(): void;
  };
  admitWrite(fence: EconomicDatabaseFenceIdentity): EconomicWritePermit;
  withWritePermit<T>(permit: EconomicWritePermit, operation: () => T | Promise<T>): Promise<T>;
  enterDraining(fence: EconomicDatabaseFenceIdentity): Promise<void>;
  reopen(fence: EconomicDatabaseFenceIdentity): Promise<void>;
  recover(fence: EconomicDatabaseFenceIdentity): Promise<void>;
  release(): void;
};

type Coordinator = {
  readonly authority: object;
  acquire(): EconomicDatabaseLifecycle;
};

const lifecyclesByPath = new Map<string, Coordinator>();

export function createEconomicDatabaseLifecycle(input: {
  readonly path: string;
  /** Stable identity for the owner of readFence; equal paths may only share it. */
  readonly authority: object;
  readonly readFence: () => EconomicDatabaseFenceIdentity;
  readonly now?: () => number;
  readonly drainTimeoutMs?: number;
}): EconomicDatabaseLifecycle {
  if (typeof input.authority !== "object" || input.authority === null)
    throw new Error("Invalid lifecycle authority");

  const path = resolve(input.path);
  const existing = lifecyclesByPath.get(path);
  if (existing) {
    if (existing.authority !== input.authority)
      throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_AUTHORITY_REJECTED");
    return existing.acquire();
  }

  const coordinator = createCoordinator(path, input);
  lifecyclesByPath.set(path, coordinator);
  return coordinator.acquire();
}

function createCoordinator(
  path: string,
  input: Omit<Parameters<typeof createEconomicDatabaseLifecycle>[0], "path">,
): Coordinator {
  const now = input.now ?? Date.now;
  const timeoutMs = input.drainTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("Invalid lifecycle drain timeout");

  let state: EconomicDatabaseLifecycleState = "open";
  let epoch = 0;
  let inFlight = 0;
  let opening = false;
  const owners = new Set<symbol>();
  const participants = new Set<{
    readonly participant: EconomicDatabaseLifecycleParticipant;
    readonly epoch: number;
  }>();
  const permits = new WeakMap<EconomicWritePermit, EconomicDatabaseFenceIdentity>();
  const waiters = new Set<() => void>();
  const unsettled = new Set<Promise<void>>();

  const tryEvict = (): void => {
    if (
      owners.size === 0 &&
      participants.size === 0 &&
      inFlight === 0 &&
      (state === "open" || state === "quiesced") &&
      lifecyclesByPath.get(path) === coordinator
    )
      lifecyclesByPath.delete(path);
  };

  const assertFence = (expected: EconomicDatabaseFenceIdentity): void => {
    const actual = input.readFence();
    if (
      expected.expiresAt <= now() ||
      actual.expiresAt <= now() ||
      actual.ownerRunId !== expected.ownerRunId ||
      actual.generation !== expected.generation ||
      actual.token !== expected.token ||
      actual.databaseGeneration !== expected.databaseGeneration ||
      actual.expiresAt !== expected.expiresAt
    )
      throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_FENCE_REJECTED");
  };

  const assertOpen = (): void => {
    if (state === "blocked")
      throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
    if (state !== "open")
      throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_DRAINING");
  };

  const waitForDrain = async (): Promise<void> => {
    if (inFlight === 0) return;
    await new Promise<void>((resolveWait, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(done);
        reject(new Error("Economic lifecycle drain timed out"));
      }, timeoutMs);
      const done = () => {
        clearTimeout(timeout);
        waiters.delete(done);
        resolveWait();
      };
      waiters.add(done);
    });
  };

  const runBounded = async (operation: () => void | Promise<void>): Promise<void> => {
    const pending = Promise.resolve().then(operation);
    unsettled.add(pending);
    const settled = () => unsettled.delete(pending);
    void pending.then(settled, settled);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Economic lifecycle drain timed out")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const failClosed = (error: unknown): never => {
    state = "blocked";
    if (error instanceof EconomicDatabaseLifecycleError) throw error;
    throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
  };

  const transitionToOpen = async (fence: EconomicDatabaseFenceIdentity): Promise<void> => {
    if (opening || inFlight !== 0 || unsettled.size !== 0)
      throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
    const openingFence = { ...fence };
    assertFence(openingFence);
    opening = true;
    try {
      for (const { participant } of participants) {
        if (participant.reopen) await runBounded(() => participant.reopen!());
        assertFence(openingFence);
      }
      assertFence(openingFence);
      epoch += 1;
      state = "open";
    } catch (error) {
      failClosed(error);
    } finally {
      opening = false;
    }
  };

  const coordinator: Coordinator = {
    authority: input.authority,
    acquire() {
      const owner = Symbol(path);
      let released = false;
      owners.add(owner);
      const assertActive = (): void => {
        if (released)
          throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED");
      };

      return {
        path,
        get state() {
          return state;
        },
        get epoch() {
          return epoch;
        },
        register(participant) {
          assertActive();
          assertOpen();
          const registration = { participant, epoch };
          let registrationReleased = false;
          participants.add(registration);
          return {
            assertCurrent() {
              if (registrationReleased || registration.epoch !== epoch || state !== "open")
                throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED");
            },
            release() {
              if (registrationReleased) return;
              registrationReleased = true;
              participants.delete(registration);
              tryEvict();
            },
          };
        },
        admitWrite(fence) {
          assertActive();
          assertOpen();
          assertFence(fence);
          const permit = { path, epoch, fenceGeneration: fence.generation };
          permits.set(permit, { ...fence });
          return permit;
        },
        async withWritePermit(permit, operation) {
          assertActive();
          const admittedFence = permits.get(permit);
          if (!admittedFence || permit.path !== path || permit.epoch !== epoch || state !== "open")
            throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_INVALIDATED");
          assertFence(admittedFence);
          inFlight += 1;
          try {
            return await operation();
          } finally {
            inFlight -= 1;
            if (inFlight === 0) for (const waiter of waiters) waiter();
            tryEvict();
          }
        },
        async enterDraining(fence) {
          assertActive();
          assertOpen();
          const drainingFence = { ...fence };
          assertFence(drainingFence);
          state = "draining";
          epoch += 1;
          try {
            for (const { participant } of participants)
              await runBounded(() => participant.invalidate());
            for (const { participant } of participants)
              if (participant.stopRenewals) await runBounded(() => participant.stopRenewals!());
            await waitForDrain();
            for (const { participant } of participants)
              if (participant.drain) await runBounded(() => participant.drain!(timeoutMs));
            assertFence(drainingFence);
            for (const { participant } of participants)
              if (participant.close) await runBounded(() => participant.close!());
            state = "quiesced";
            tryEvict();
          } catch (error) {
            failClosed(error);
          }
        },
        async reopen(fence) {
          assertActive();
          if (state !== "quiesced")
            throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
          await transitionToOpen(fence);
        },
        async recover(fence) {
          assertActive();
          if (state !== "blocked")
            throw new EconomicDatabaseLifecycleError("ECONOMIC_DATABASE_LIFECYCLE_BLOCKED");
          await transitionToOpen(fence);
        },
        release() {
          if (released) return;
          released = true;
          owners.delete(owner);
          tryEvict();
        },
      };
    },
  };
  return coordinator;
}
