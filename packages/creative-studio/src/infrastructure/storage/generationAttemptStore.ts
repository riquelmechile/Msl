import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { micros } from "@msl/domain";
import type {
  AttemptFence,
  ReservationConflict,
  StoreResult,
} from "../../domain/budgetReservation.js";
import type {
  AttemptEvidence,
  AttemptStore,
  GenerationAttempt,
  LeaseGrant,
  NoSubmissionProof,
} from "../../domain/generationAttempt.js";

const LEASE_MS = 90_000;
// prettier-ignore
type Row = { attempt_id:string;seller_id:string;job_id:string;reservation_id:string;message_id:string;provider:string;model:string;idempotency_key:string;request_hash:string;state:GenerationAttempt["state"];estimated_cost_micros:number;actual_cost_micros:number|null;task_id:string|null;provider_request_id:string|null;request_evidence_json:string;submission_evidence_json:string|null;result_evidence_json:string|null;error_evidence_json:string|null;no_submission_proof_json:string|null;lease_owner_id:string;lease_token_digest:string;lease_generation:number;lease_expires_at:number;dispatching_at:number|null;submitted_at:number|null;terminal_at:number|null;created_at:number;updated_at:number };
type Failed = { ok: false; conflict: ReservationConflict };
// prettier-ignore
export function createAttemptStore(db: Database.Database): AttemptStore {
  db.pragma("busy_timeout = 5000");
  const byId = db.prepare("SELECT * FROM creative_generation_attempts WHERE attempt_id=?");
  const byProviderKey = db.prepare("SELECT * FROM creative_generation_attempts WHERE provider=? AND idempotency_key=?");
  const read = (id: string) => byId.get(id) as Row | undefined;
  const fenced = (input: AttemptFence): Row | Failed => {
    const row = read(input.attemptId);
    if (!row || row.lease_owner_id !== input.ownerId || row.lease_generation !== input.generation || row.lease_token_digest !== digest(input.token) || row.lease_expires_at <= input.now) return leaseLost(input);
    return row;
  };
  const transition = (input: AttemptFence, states: readonly string[], set: string, values: object = {}) => tx(db, () => {
    const row = fenced(input); if ("ok" in row) return row;
    if (!states.includes(row.state)) return invalid(row.state, states);
    db.prepare(`UPDATE creative_generation_attempts SET ${set},updated_at=@now WHERE attempt_id=@attemptId AND seller_id=@sellerId AND job_id=@jobId AND reservation_id=@reservationId AND lease_owner_id=@ownerId AND lease_token_digest=@tokenDigest AND lease_generation=@generation AND lease_expires_at>@now`).run({ ...input, ...values, ...key(row), tokenDigest: digest(input.token) });
    return success(read(input.attemptId)!, false);
  });
  return {
    prepare(input) {
      micros(input.estimated); requireEvidence(input.requestEvidence, "request");
      if (input.estimated <= 0 || !/^[0-9a-f]{64}$/.test(input.requestHash)) throw new RangeError("positive estimated cost and lowercase SHA-256 request hash required");
      exactLease(input.now, input.leaseExpiresAt);
      return tx(db, () => {
        const existing = read(input.attemptId) ?? byProviderKey.get(input.provider,input.idempotencyKey) as Row | undefined;
        if (existing) { const conflict = prepareConflict(existing,input); if (typeof conflict !== "string" && conflict) return conflict; if (conflict) return divergent(conflict); if (existing.state !== "prepared") return invalid(existing.state,["prepared"]); if(existing.lease_expires_at>input.now)return invalid("lease-active",["lease-expired"]); }
        const token = newToken();
        if (existing) db.prepare("UPDATE creative_generation_attempts SET lease_owner_id=@leaseOwnerId,lease_token_digest=@tokenDigest,lease_generation=lease_generation+1,lease_expires_at=@leaseExpiresAt,updated_at=@now WHERE attempt_id=@attemptId AND state='prepared'").run({ ...input, tokenDigest: digest(token) });
        else db.prepare(`INSERT INTO creative_generation_attempts(attempt_id,seller_id,job_id,reservation_id,message_id,provider,model,idempotency_key,request_hash,estimated_cost_micros,request_evidence_json,lease_owner_id,lease_token_digest,lease_generation,lease_expires_at,created_at,updated_at) VALUES(@attemptId,@sellerId,@jobId,@reservationId,@messageId,@provider,@model,@idempotencyKey,@requestHash,@estimated,@requestEvidenceJson,@leaseOwnerId,@tokenDigest,1,@leaseExpiresAt,@now,@now)`).run({ ...input, requestEvidenceJson: json(input.requestEvidence), tokenDigest: digest(token) });
        return grant(read(input.attemptId)!, token, Boolean(existing));
      });
    },
    get(attemptId) { const row = read(attemptId); return row ? fromRow(row) : undefined; },
    acquireDue(input) { return tx(db, () => {
      const due = db.prepare("SELECT * FROM creative_generation_attempts WHERE state NOT IN ('completed','failed') AND lease_expires_at<=? ORDER BY lease_expires_at,updated_at,attempt_id LIMIT ?").all(input.now, input.limit) as Row[];
      const value = due.map((row) => { const token = newToken(); db.prepare("UPDATE creative_generation_attempts SET lease_owner_id=?,lease_token_digest=?,lease_generation=lease_generation+1,lease_expires_at=?,updated_at=? WHERE attempt_id=? AND seller_id=? AND job_id=? AND reservation_id=? AND lease_expires_at<=?").run(input.ownerId,digest(token),input.now+LEASE_MS,input.now,row.attempt_id,row.seller_id,row.job_id,row.reservation_id,input.now); return grant(read(row.attempt_id)!,token,false).value; });
      return { ok:true,value,idempotent:value.length===0 };
    }); },
    renewLease(input) { exactLease(input.now,input.expiresAt); return transition(input,nonterminal,"lease_expires_at=@expiresAt",input); },
    markDispatching(input) { return transition(input,["prepared"],"state='dispatching',dispatching_at=@now"); },
    markSubmitted(input) { requireEvidence(input.evidence,"submission"); if(!input.taskId)throw new Error("taskId required"); return transition(input,["dispatching"],"state='submitted',task_id=@taskId,provider_request_id=@providerRequestId,submission_evidence_json=@evidenceJson,submitted_at=@now",{...input,evidenceJson:json(input.evidence)}); },
    markAmbiguous(input) { requireEvidence(input.evidence,"error"); return transition(input,["dispatching","submitted"],"state='ambiguous',error_evidence_json=@evidenceJson",{evidenceJson:json(input.evidence)}); },
    complete(input) { micros(input.actual); requireEvidence(input.evidence,"result"); return close(db,read,fenced,input,"completed"); },
    fail(input) { requireEvidence(input.error,"error"); requireProof(input.proof); return close(db,read,fenced,input,"failed"); },
  };
}
// prettier-ignore
function close(db:Database.Database,read:(id:string)=>Row|undefined,fenced:(input:AttemptFence)=>Row|Failed,input:Parameters<AttemptStore["complete"]>[0]|Parameters<AttemptStore["fail"]>[0],outcome:"completed"|"failed"):StoreResult<GenerationAttempt>{return tx(db,()=>{
  const current=read(input.attemptId),completed="actual" in input;if((outcome==="completed")!==completed)throw new Error("invalid terminal outcome");if(!current)return leaseLost(input);
  const resultJson=completed?json(input.evidence):null,errorJson=completed?null:json(input.error),proofJson=completed?null:json(input.proof),actual=completed?input.actual:null;
  if(current.state===outcome)return current.actual_cost_micros===actual&&current.result_evidence_json===resultJson&&current.error_evidence_json===errorJson&&current.no_submission_proof_json===proofJson?success(current,true):divergent("terminal-evidence");const row=fenced(input);if("ok" in row)return row;
  if(["completed","failed"].includes(row.state))return invalid(row.state,[outcome]);if(!(closable as readonly string[]).includes(row.state))return invalid(row.state,closable);
  const reservation=db.prepare("SELECT status,reserved_micros FROM creative_budget_reservations WHERE reservation_id=? AND seller_id=? AND job_id=? AND attempt_id=?").get(row.reservation_id,row.seller_id,row.job_id,row.attempt_id) as {status:string;reserved_micros:number}|undefined;
  if(!reservation||reservation.status!=="held")return invalid(reservation?.status??"missing",["held"]);if(completed&&input.actual>reservation.reserved_micros)return{ok:false,conflict:{kind:"amount-over-reserved",reserved:micros(reservation.reserved_micros),actual:input.actual}};
  const evidenceRef=completed?input.evidence.ref:input.proof.evidenceRef;
  db.prepare("UPDATE creative_budget_reservations SET status=?,committed_micros=?,terminal_evidence_ref=?,updated_at=? WHERE reservation_id=? AND seller_id=? AND job_id=? AND attempt_id=? AND status='held'").run(completed?"committed":"released",actual,evidenceRef,input.now,row.reservation_id,row.seller_id,row.job_id,row.attempt_id);
  db.prepare("UPDATE creative_generation_attempts SET state=@outcome,actual_cost_micros=@actual,result_evidence_json=@resultJson,error_evidence_json=@errorJson,no_submission_proof_json=@proofJson,terminal_at=@now,updated_at=@now WHERE attempt_id=@attemptId AND seller_id=@sellerId AND job_id=@jobId AND reservation_id=@reservationId AND lease_owner_id=@ownerId AND lease_token_digest=@tokenDigest AND lease_generation=@generation AND lease_expires_at>@now").run({...input,...key(row),outcome,actual,resultJson,errorJson,proofJson,tokenDigest:digest(input.token)});
  return success(read(input.attemptId)!,false);
});}
// prettier-ignore
function tx<T>(db:Database.Database,operation:()=>StoreResult<T>):StoreResult<T>{try{db.exec("BEGIN IMMEDIATE");try{const result=operation();db.exec("COMMIT");return result;}catch(error){db.exec("ROLLBACK");throw error;}}catch(error){if(error instanceof Error&&"code" in error&&String(error.code).startsWith("SQLITE_BUSY"))return{ok:false,conflict:{kind:"busy",retryable:true}};throw error;}}
// prettier-ignore
function fromRow(r:Row):GenerationAttempt{return{reservationId:r.reservation_id,sellerId:r.seller_id,jobId:r.job_id,attemptId:r.attempt_id,messageId:r.message_id,provider:r.provider,model:r.model,idempotencyKey:r.idempotency_key,requestHash:r.request_hash,state:r.state,estimated:micros(r.estimated_cost_micros),actual:r.actual_cost_micros===null?null:micros(r.actual_cost_micros),taskId:r.task_id,providerRequestId:r.provider_request_id,requestEvidence:parseRequired<AttemptEvidence>(r.request_evidence_json),submissionEvidence:parse<AttemptEvidence>(r.submission_evidence_json),resultEvidence:parse<AttemptEvidence>(r.result_evidence_json),errorEvidence:parse<AttemptEvidence>(r.error_evidence_json),noSubmissionProof:parse<NoSubmissionProof>(r.no_submission_proof_json),lease:{ownerId:r.lease_owner_id,generation:r.lease_generation,expiresAt:r.lease_expires_at},dispatchingAt:r.dispatching_at,submittedAt:r.submitted_at,terminalAt:r.terminal_at,createdAt:r.created_at,updatedAt:r.updated_at};}
// prettier-ignore
function grant(row:Row,token:string,idempotent:boolean):StoreResult<LeaseGrant>&{ok:true}{return{ok:true,value:{attempt:fromRow(row),lease:{ownerId:row.lease_owner_id,token,generation:row.lease_generation,expiresAt:row.lease_expires_at}},idempotent};}
// prettier-ignore
function prepareConflict(r:Row,i:Parameters<AttemptStore["prepare"]>[0]):Failed|string|undefined{const identity:Array<[string,unknown,unknown]>=[["reservationId",r.reservation_id,i.reservationId],["sellerId",r.seller_id,i.sellerId],["jobId",r.job_id,i.jobId],["attemptId",r.attempt_id,i.attemptId]],fields=identity.filter(([,a,b])=>a!==b).map(([name])=>name);if(fields.length)return{ok:false,conflict:{kind:"identity-mismatch",fields}};const values:Array<[string,unknown,unknown]>=[["messageId",r.message_id,i.messageId],["provider",r.provider,i.provider],["model",r.model,i.model],["idempotencyKey",r.idempotency_key,i.idempotencyKey],["requestHash",r.request_hash,i.requestHash],["estimated",r.estimated_cost_micros,i.estimated],["requestEvidence",r.request_evidence_json,json(i.requestEvidence)]];return values.find(([,a,b])=>a!==b)?.[0];}
const nonterminal = ["prepared", "dispatching", "submitted", "ambiguous"] as const,
  closable = ["dispatching", "submitted", "ambiguous"] as const;
// prettier-ignore
function key(r:Row){return{attemptId:r.attempt_id,sellerId:r.seller_id,jobId:r.job_id,reservationId:r.reservation_id};}
// prettier-ignore
function requireEvidence(v:AttemptEvidence,kind:AttemptEvidence["kind"]){if(v.kind!==kind||!v.ref||!v.recordedAt)throw new Error(`${kind} evidence required`);}
// prettier-ignore
function requireProof(p:NoSubmissionProof){const valid=(p.kind==="transport-before-send"&&p.authority==="minimax-transport"&&p.bodyBytesOffered===0)||(p.kind==="provider-rejection"&&p.authority==="minimax-adapter"&&!p.accepted&&!p.charged&&!!p.providerRequestId)||(p.kind==="operator-reconciliation"&&p.authority==="creative-ops"&&p.confirmedUnsent&&p.confirmedUncharged);if(!valid||!p.evidenceRef)throw new Error("trusted no-submission proof required");}
// prettier-ignore
function exactLease(now:number,expiresAt:number){if(expiresAt!==now+LEASE_MS)throw new RangeError("attempt lease must be exactly 90 seconds");}
// prettier-ignore
function success(r:Row,idempotent:boolean):StoreResult<GenerationAttempt>{return{ok:true,value:fromRow(r),idempotent};}
// prettier-ignore
function invalid(state:string,expected:readonly string[]):Failed{return{ok:false,conflict:{kind:"invalid-state",state,expected}};}
// prettier-ignore
function divergent(field:string):Failed{return{ok:false,conflict:{kind:"divergent-repeat",field}};}
// prettier-ignore
function leaseLost(i:AttemptFence):Failed{return{ok:false,conflict:{kind:"lease-lost",attemptId:i.attemptId,generation:i.generation}};}
function newToken() {
  return randomBytes(32).toString("base64url");
}
function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function json(value: unknown) {
  return JSON.stringify(value);
}
function parse<T>(value: string | null): T | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed as T;
}
function parseRequired<T>(value: string): T {
  const parsed: unknown = JSON.parse(value);
  return parsed as T;
}
