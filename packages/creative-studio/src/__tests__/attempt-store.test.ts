import { createHash, randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import { micros } from "@msl/domain";
import { describe, expect, it } from "vitest";
import type { StoreResult } from "../domain/budgetReservation.js";
import type { AttemptEvidence } from "../domain/generationAttempt.js";
import { applyCreativeDurabilityMigration } from "../infrastructure/storage/creativeDurabilityMigration.js";
import { createAttemptStore } from "../infrastructure/storage/generationAttemptStore.js";
import { createReservationStore } from "../infrastructure/storage/reservationStore.js";

const now = Date.parse("2026-07-20T12:00:00Z");
const evidence = (ref: string, kind: AttemptEvidence["kind"]): AttemptEvidence => ({
  ref,
  kind,
  payload: { ref },
  recordedAt: "2026-07-20T12:00:00Z",
});
const proof = {
  kind: "transport-before-send",
  authority: "minimax-transport",
  bodyBytesOffered: 0,
  evidenceRef: "unsent:1",
} as const;
const key = (n: number) => ({
  reservationId: `r${n}`,
  sellerId: "seller",
  jobId: `job${n}`,
  attemptId: `a${n}`,
});
const prepared = (n: number, at = now) => ({
  ...key(n),
  messageId: `m${n}`,
  provider: "minimax",
  model: "image-01",
  idempotencyKey: `idem${n}`,
  requestHash: String(n).padStart(64, "0"),
  estimated: micros(5_000),
  requestEvidence: evidence(`request:${n}`, "request"),
  leaseOwnerId: "worker-a",
  leaseExpiresAt: at + 90_000,
  now: at,
});

function setup(path = ":memory:") {
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  applyCreativeDurabilityMigration(db);
  const reservations = createReservationStore(db),
    attempts = createAttemptStore(db);
  const reserve = (n: number, at = now) =>
    reservations.reserve({
      ...key(n),
      currency: "USD",
      utcDay: new Date(at).toISOString().slice(0, 10),
      requested: micros(5_000),
      dailyCap: micros(100_000),
      jobCap: micros(10_000),
      expiresAt: at + 90_000,
      now: at,
    });
  return { db, attempts, reserve };
}
function conflict(result: StoreResult<unknown>) {
  return result.ok ? "ok" : result.conflict.kind;
}

// prettier-ignore
const workerSource=`const{parentPort,workerData}=require("node:worker_threads");const Database=require("better-sqlite3");(async()=>{const{createAttemptStore}=await import(workerData.moduleUrl);const db=new Database(workerData.path);db.pragma("foreign_keys = ON");const store=createAttemptStore(db);parentPort.postMessage("ready");Atomics.wait(new Int32Array(workerData.gate),0,0);const result=store.acquireDue({ownerId:workerData.owner,now:workerData.now,limit:10});db.close();parentPort.postMessage(result);})().catch(e=>{throw e});`;
async function race(path: string) {
  const gate = new SharedArrayBuffer(4),
    moduleUrl = new URL("../infrastructure/storage/generationAttemptStore.ts", import.meta.url)
      .href;
  const runs = ["worker-b", "worker-c"].map((owner) => {
    const worker = new Worker(workerSource, {
      eval: true,
      execArgv: ["--import", "tsx"],
      workerData: { gate, path, moduleUrl, owner, now: now + 200_000 },
    });
    let ready!: () => void;
    const waiting = new Promise<void>((r) => (ready = r));
    const result = new Promise<unknown>((resolve, reject) => {
      worker.on("message", (m) => (m === "ready" ? ready() : resolve(m)));
      worker.on("error", reject);
    });
    return { worker, waiting, result };
  });
  await Promise.all(runs.map((r) => r.waiting));
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0);
  const results = (await Promise.all(runs.map((r) => r.result))) as Array<{
    ok: true;
    value: Array<{ attempt: { attemptId: string } }>;
  }>;
  await Promise.all(runs.map((r) => r.worker.terminate()));
  return results;
}

// prettier-ignore
describe("attempt store",()=>{
  it("keeps active prepare canonical and takes over only after expiry",()=>{
    const{db,attempts,reserve}=setup();reserve(1);const first=attempts.prepare(prepared(1));if(!first.ok)throw new Error("prepare failed");
    const stored=()=>db.prepare("SELECT lease_generation generation,lease_token_digest digest FROM creative_generation_attempts WHERE attempt_id='a1'").get() as {generation:number;digest:string};
    const original=stored();expect(first.value.attempt).toMatchObject({state:"prepared",requestHash:"1".padStart(64,"0")});expect(first.value.lease.token).toHaveLength(43);expect(original).toEqual({generation:1,digest:createHash("sha256").update(first.value.lease.token).digest("hex")});
    expect(conflict(attempts.prepare(prepared(1)))).toBe("invalid-state");expect(stored()).toEqual(original);expect(()=>attempts.prepare({...prepared(1),leaseExpiresAt:now+1})).toThrow(/90 seconds/);
    const takeover=attempts.prepare(prepared(1,now+90_000));if(!takeover.ok)throw new Error("takeover failed");expect([takeover.idempotent,takeover.value.lease.generation]).toEqual([true,2]);expect(conflict(attempts.markDispatching({...first.value.lease,attemptId:"a1",now:now+90_000}))).toBe("lease-lost");
    expect(conflict(attempts.prepare({...prepared(1,now+90_000),model:"other"}))).toBe("divergent-repeat");reserve(2);expect(conflict(attempts.prepare({...prepared(2),idempotencyKey:"idem1"}))).toBe("identity-mismatch");db.close();
  });
  it("orders expired acquisition, serializes workers, renews exactly 90s, and fences takeover",async()=>{
    const path=`/tmp/msl-attempt-${randomUUID()}.sqlite`,{db,attempts,reserve}=setup(path);reserve(1);reserve(2,now+1);const one=attempts.prepare(prepared(1));attempts.prepare(prepared(2,now+1));if(!one.ok)throw new Error("prepare failed");
    const acquired=attempts.acquireDue({ownerId:"ordering",now:now+90_001,limit:1});expect(acquired.ok&&acquired.value.map(x=>x.attempt.attemptId)).toEqual(["a1"]);if(!acquired.ok)throw new Error("acquire failed");const lease=acquired.value[0]!.lease;
    expect(attempts.renewLease({...lease,attemptId:"a1",now:now+90_001,expiresAt:now+180_001}).ok).toBe(true);expect(conflict(attempts.renewLease({...one.value.lease,attemptId:"a1",now:now+90_001,expiresAt:now+180_001}))).toBe("lease-lost");
    const results=await race(path);expect(results.flatMap(r=>r.value.map(x=>x.attempt.attemptId)).sort()).toEqual(["a1","a2"]);db.close();unlinkSync(path);
  });
  it("reconciles every terminal path, validates evidence, and rolls back crashes",()=>{
    const{db,attempts,reserve}=setup();[1,2,3,4].forEach(n=>reserve(n));const start=(n:number)=>{const grant=attempts.prepare(prepared(n));if(!grant.ok)throw new Error("prepare failed");const f={...grant.value.lease,attemptId:`a${n}`,now};expect(attempts.markDispatching(f).ok).toBe(true);return f;};
    const f1=start(1);attempts.markSubmitted({...f1,taskId:"task-1",providerRequestId:"provider-1",evidence:evidence("submit:1","submission")});const complete={...f1,actual:micros(4_000),evidence:evidence("result:1","result")};expect(attempts.complete(complete).ok).toBe(true);const replay=attempts.complete({...complete,now:now+200_000});expect(replay.ok&&replay.idempotent).toBe(true);expect(conflict(attempts.complete({...complete,now:now+200_000,evidence:evidence("other","result")}))).toBe("divergent-repeat");expect(conflict(attempts.fail({...f1,now:now+200_000,error:evidence("error:1","error"),proof}))).toBe("lease-lost");
    const f2=start(2);expect(attempts.markAmbiguous({...f2,evidence:evidence("lost-response","error")}).ok).toBe(true);expect(conflict(attempts.markDispatching(f2))).toBe("invalid-state");expect(attempts.complete({...f2,actual:micros(3_000),evidence:evidence("reconciled","result")}).ok).toBe(true);
    const f3=start(3);attempts.markSubmitted({...f3,taskId:"task-3",providerRequestId:null,evidence:evidence("submit:3","submission")});const failure={...f3,error:evidence("failed:3","error"),proof};expect(attempts.fail(failure).ok).toBe(true);const failedReplay=attempts.fail({...failure,now:now+200_000});expect(failedReplay.ok&&failedReplay.idempotent).toBe(true);expect(conflict(attempts.fail({...failure,now:now+200_000,error:evidence("other","error")}))).toBe("divergent-repeat");
    const f4=start(4);expect(()=>attempts.markSubmitted({...f4,taskId:"t",providerRequestId:null,evidence:evidence("bad","result")})).toThrow(/submission evidence/);expect(()=>attempts.complete({...f4,actual:micros(1),evidence:evidence("bad","error")})).toThrow(/result evidence/);expect(()=>attempts.fail({...f4,error:evidence("bad-proof","error"),proof:{...proof,bodyBytesOffered:1} as unknown as typeof proof})).toThrow(/trusted/);
    db.exec("CREATE TRIGGER crashBeforeAtomicCommit BEFORE UPDATE ON creative_budget_reservations WHEN NEW.status='committed' BEGIN SELECT RAISE(ABORT,'crashBeforeAtomicCommit'); END");expect(()=>attempts.complete({...f4,actual:micros(3_000),evidence:evidence("result:4","result")})).toThrow(/crashBeforeAtomicCommit/);expect(attempts.get("a4")?.state).toBe("dispatching");expect(createReservationStore(db).get(key(4))?.status).toBe("held");db.close();
  });
});
