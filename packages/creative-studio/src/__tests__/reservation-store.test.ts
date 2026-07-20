import { createHash, randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import { micros } from "@msl/domain";
import { describe, expect, it } from "vitest";
import type { StoreResult } from "../domain/budgetReservation.js";
import type { NoSubmissionProof } from "../domain/generationAttempt.js";
import { applyCreativeDurabilityMigration } from "../infrastructure/storage/creativeDurabilityMigration.js";
import { createReservationStore } from "../infrastructure/storage/reservationStore.js";

const day = "2026-07-20";
const now = Date.parse(`${day}T12:00:00Z`);
// prettier-ignore
const key = (n: number) => ({ reservationId: `r${n}`, sellerId: "s", jobId: "j", attemptId: `a${n}` });
// prettier-ignore
const request = (n: number, amount = 5_000, overrides = {}) => ({ ...key(n), currency: "USD", utcDay: day,
  requested: micros(amount), dailyCap: micros(50_000), jobCap: micros(10_000), expiresAt: now + 1_000, now, ...overrides });
// prettier-ignore
const unsent = { kind: "transport-before-send", authority: "minimax-transport", bodyBytesOffered: 0, evidenceRef: "unsent:2" } as const;
// prettier-ignore
const operator = { kind: "operator-reconciliation", authority: "creative-ops", confirmedUnsent: true, confirmedUncharged: true, evidenceRef: "ops:1" } as const;
// prettier-ignore
const untrusted = { kind: "transport-before-send", authority: "untrusted", bodyBytesOffered: 0, evidenceRef: "bad" } as unknown as NoSubmissionProof;

// prettier-ignore
function setup(path = ":memory:") {
  const db = new Database(path); db.pragma("foreign_keys = ON"); applyCreativeDurabilityMigration(db);
  return { db, store: createReservationStore(db) };
}
// prettier-ignore
function kind(result: StoreResult<unknown>): string { return result.ok ? "ok" : result.conflict.kind; }

// prettier-ignore
const workerSource = `const { parentPort, workerData } = require("node:worker_threads"); const Database = require("better-sqlite3"); (async () => { const { createReservationStore } = await import(workerData.moduleUrl); const db = new Database(workerData.path); db.pragma("foreign_keys = ON"); const store = createReservationStore(db); parentPort.postMessage("ready"); Atomics.wait(new Int32Array(workerData.gate), 0, 0); const result = store.reserve(workerData.input); db.close(); parentPort.postMessage(result); })().catch((error) => { throw error; });`;
// prettier-ignore
async function runConcurrent(path: string, inputs: unknown[]): Promise<StoreResult<unknown>[]> {
  const gate = new SharedArrayBuffer(4);
  const moduleUrl = new URL("../infrastructure/storage/reservationStore.ts", import.meta.url).href;
  const runs = inputs.map((input) => {
    const worker = new Worker(workerSource, { eval: true, execArgv: ["--import", "tsx"], workerData: { gate, path, moduleUrl, input } });
    let signalReady!: () => void;
    const ready = new Promise<void>((resolve) => { signalReady = resolve; });
    const result = new Promise<StoreResult<unknown>>((resolve, reject) => {
      worker.on("message", (message: unknown) => message === "ready" ? signalReady() : resolve(message as StoreResult<unknown>)); worker.on("error", reject);
    });
    return { worker, ready, result };
  });
  await Promise.all(runs.map((run) => run.ready)); Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
  const results = await Promise.all(runs.map((run) => run.result)); await Promise.all(runs.map((run) => run.worker.terminate())); return results;
}

describe("reservation store", () => {
  it("enforces admission, canonical duplicates, and terminal reconciliation", () => {
    const { db, store } = setup();
    expect(store.reserve(request(1, 10_000)).ok).toBe(true);
    const duplicate = store.reserve(request(1, 10_000));
    expect(duplicate.ok && duplicate.idempotent).toBe(true);
    expect(kind(store.reserve(request(1, 6_000)))).toBe("divergent-repeat");
    const jobCapped = store.reserve(request(6, 1));
    expect(
      !jobCapped.ok && jobCapped.conflict.kind === "invalid-state" && jobCapped.conflict.state,
    ).toBe("job-cap-exceeded");
    const capped = store.reserve(request(2, 40_001, { jobId: "j2", jobCap: micros(50_000) }));
    expect(!capped.ok && capped.conflict.kind === "invalid-state" && capped.conflict.state).toBe(
      "daily-cap-exceeded",
    );
    expect(store.get(key(2))).toBeUndefined();
    expect(() => store.reserve(request(2, 1, { utcDay: "2026-07-19" }))).toThrow(/UTC/);
    // prettier-ignore
    expect(store.reserve(request(2, 40_001, { jobId: "j2", jobCap: micros(50_000), utcDay: "2026-07-21", now: now + 86_400_000 })).ok).toBe(true);
    expect(
      kind(store.commit({ ...key(1), actual: micros(11_000), evidenceRef: "over", now })),
    ).toBe("amount-over-reserved");
    expect(store.get(key(1))?.status).toBe("held");
    const commit = { ...key(1), actual: micros(7_000), evidenceRef: "result:1", now };
    const committed = store.commit(commit);
    expect(committed.ok && [committed.value.status, committed.value.committed]).toEqual([
      "committed",
      7_000,
    ]);
    const repeated = store.commit(commit);
    expect(repeated.ok && repeated.idempotent).toBe(true);
    const exactKey = { ...key(7), sellerId: "exact", jobId: "exact" };
    store.reserve(request(7, 5_000, exactKey));
    const exact = store.commit({ ...exactKey, actual: micros(5_000), evidenceRef: "exact", now });
    // prettier-ignore
    expect(exact.ok && [exact.value.status, exact.value.committed, exact.value.reserved - exact.value.committed!]).toEqual(["committed", 5_000, 0]);
    expect(store.reserve(request(4, 2_000)).ok).toBe(true);
    const aggregate = store.reserve(request(5, 2_000));
    expect(
      !aggregate.ok && aggregate.conflict.kind === "invalid-state" && aggregate.conflict.state,
    ).toBe("job-cap-exceeded");
    expect(store.get(key(5))).toBeUndefined();
    expect(() => store.release({ ...key(4), proof: untrusted, now })).toThrow(/trusted/);
    expect(store.get(key(4))).toMatchObject({ status: "held", terminalEvidenceRef: null });
    const released = store.release({ ...key(4), proof: unsent, now });
    expect(released.ok && released.value.status).toBe("released");
    expect(kind(store.release({ ...key(1), proof: operator, now }))).toBe("invalid-state");
    expect(kind(store.commit({ ...commit, sellerId: "other" }))).toBe("identity-mismatch");
    db.close();
  });

  it("serializes two workers, fences renewal, protects expiry, and rolls back crashes", async () => {
    const path = `/tmp/msl-reservation-${randomUUID()}.sqlite`;
    const { db, store } = setup(path);
    const concurrent = await runConcurrent(path, [
      request(8, 6_000, { jobId: "concurrent", expiresAt: now + 10_000 }),
      request(9, 6_000, { jobId: "concurrent", expiresAt: now + 10_000 }),
    ]);
    expect(concurrent.map(kind).sort()).toEqual(["invalid-state", "ok"]);
    // prettier-ignore
    expect(concurrent.some((result) => !result.ok && result.conflict.kind === "invalid-state" && result.conflict.state === "job-cap-exceeded")).toBe(true);
    expect(concurrent.some((result) => !result.ok && result.conflict.kind === "busy")).toBe(false);
    // prettier-ignore
    expect(db.prepare("SELECT count(*) count,sum(reserved_micros) total FROM creative_budget_reservations WHERE job_id='concurrent'").get()).toEqual({ count: 1, total: 6_000 });
    store.reserve(request(1));
    store.reserve(request(2));
    const token = "secret";
    const tokenDigest = createHash("sha256").update(token).digest("hex");
    db.prepare(
      `INSERT INTO creative_generation_attempts(attempt_id,seller_id,job_id,reservation_id,message_id,provider,model,idempotency_key,request_hash,estimated_cost_micros,request_evidence_json,lease_owner_id,lease_token_digest,lease_generation,lease_expires_at,created_at,updated_at)
      VALUES('a1','s','j','r1','m','p','model','key',?,1,'{}','owner',?,1,?,1,1)`,
    ).run("0".repeat(64), tokenDigest, now + 500);
    const fence = { attemptId: "a1", ownerId: "owner", token, generation: 1, now };
    expect(store.renewHold({ ...key(1), fence, expiresAt: now + 2_000 }).ok).toBe(true);
    // prettier-ignore
    expect(kind(store.renewHold({ ...key(1), fence: { ...fence, token: "old" }, expiresAt: now + 3_000 }))).toBe("lease-lost");
    const expired = store.expireDue({ now: now + 5_000, limit: 10 });
    expect(expired.ok && expired.value.map((r) => r.reservationId)).toEqual(["r2"]);
    db.exec(
      "CREATE TRIGGER crashAfterReserve BEFORE INSERT ON creative_budget_reservations BEGIN SELECT RAISE(ABORT,'crashAfterReserve'); END",
    );
    expect(() => store.reserve(request(3))).toThrow(/crashAfterReserve/);
    const count = db
      .prepare("SELECT count(*) count FROM creative_budget_reservations WHERE reservation_id='r3'")
      .pluck()
      .get();
    expect(count).toBe(0);
    db.close();
    unlinkSync(path);
  });
});
