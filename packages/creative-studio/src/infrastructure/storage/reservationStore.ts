import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { micros } from "@msl/domain";
// prettier-ignore
import type { Reservation, ReservationConflict, ReservationKey, ReservationStore, StoreResult } from "../../domain/budgetReservation.js";

// prettier-ignore
type Row = { reservation_id: string; seller_id: string; job_id: string; attempt_id: string;
  currency: string; utc_day: string; status: Reservation["status"]; reserved_micros: number;
  committed_micros: number | null; expires_at: number; terminal_evidence_ref: string | null;
  created_at: number; updated_at: number };
const keyFields = ["reservationId", "sellerId", "jobId", "attemptId"] as const;
type Failed = { ok: false; conflict: ReservationConflict };

export function createReservationStore(db: Database.Database): ReservationStore {
  db.pragma("busy_timeout = 5000");
  const byId = db.prepare("SELECT * FROM creative_budget_reservations WHERE reservation_id=?");
  // prettier-ignore
  const byAttempt = db.prepare("SELECT * FROM creative_budget_reservations WHERE seller_id=? AND job_id=? AND attempt_id=?");
  const read = (key: ReservationKey) => byId.get(key.reservationId) as Row | undefined;
  // prettier-ignore
  const exact = (key: ReservationKey) => { const found = read(key); return found && mismatches(found, key).length === 0 ? found : undefined; };
  // prettier-ignore
  const conflict = (key: ReservationKey, expected: readonly string[]): Failed => {
    const found = read(key);
    if (!found) return invalid("missing", expected);
    const fields = mismatches(found, key);
    return fields.length ? { ok: false, conflict: { kind: "identity-mismatch", fields } } : invalid(found.status, expected);
  };
  // prettier-ignore
  const transaction = <T>(operation: () => StoreResult<T>): StoreResult<T> => {
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = operation(); db.exec("COMMIT"); return result;
      } catch (error) { db.exec("ROLLBACK"); throw error;
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && String(error.code).startsWith("SQLITE_BUSY")) return { ok: false, conflict: { kind: "busy", retryable: true } };
      throw error;
    }
  };

  return {
    reserve(input) {
      validateReserve(input);
      return transaction(() => {
        const found =
          read(input) ??
          (byAttempt.get(input.sellerId, input.jobId, input.attemptId) as Row | undefined);
        if (found) {
          const fields = mismatches(found, input);
          if (fields.length) return { ok: false, conflict: { kind: "identity-mismatch", fields } };
          if (found.currency !== input.currency) return divergent("currency");
          if (found.reserved_micros !== input.requested) return divergent("requested");
          return success(found, true);
        }
        const total = db
          .prepare(
            `SELECT
          COALESCE(SUM(CASE WHEN utc_day=@utcDay THEN committed_micros ELSE 0 END),0)+COALESCE(SUM(CASE WHEN utc_day=@utcDay AND status='held' AND expires_at>@now THEN reserved_micros ELSE 0 END),0) daily,
          COALESCE(SUM(CASE WHEN job_id=@jobId THEN committed_micros ELSE 0 END),0)+COALESCE(SUM(CASE WHEN job_id=@jobId AND status='held' AND expires_at>@now THEN reserved_micros ELSE 0 END),0) job
          FROM creative_budget_reservations WHERE seller_id=@sellerId AND currency=@currency AND status IN ('held','committed')`,
          )
          .get(input) as { daily: number; job: number };
        if (total.daily + input.requested > input.dailyCap)
          return invalid("daily-cap-exceeded", ["within-daily-cap"]);
        if (total.job + input.requested > input.jobCap)
          return invalid("job-cap-exceeded", ["within-job-cap"]);
        db.prepare(
          `INSERT INTO creative_budget_reservations
          (reservation_id,seller_id,job_id,attempt_id,currency,utc_day,reserved_micros,expires_at,created_at,updated_at)
          VALUES (@reservationId,@sellerId,@jobId,@attemptId,@currency,@utcDay,@requested,@expiresAt,@now,@now)`,
        ).run(input);
        return success(exact(input)!, false);
      });
    },
    get(key) {
      const found = exact(key);
      return found ? fromRow(found) : undefined;
    },
    commit(input) {
      micros(input.actual);
      return transaction(() => {
        const found = read(input);
        const fields = found ? mismatches(found, input) : [];
        if (found && fields.length)
          return { ok: false, conflict: { kind: "identity-mismatch", fields } };
        if (found?.status === "committed")
          return found.committed_micros === input.actual &&
            found.terminal_evidence_ref === input.evidenceRef
            ? success(found, true)
            : divergent(found.committed_micros !== input.actual ? "actual" : "evidenceRef");
        if (found && found.reserved_micros < input.actual)
          return {
            ok: false,
            conflict: {
              kind: "amount-over-reserved",
              reserved: micros(found.reserved_micros),
              actual: input.actual,
            },
          };
        const changes = db
          .prepare(
            `UPDATE creative_budget_reservations SET status='committed',committed_micros=@actual,terminal_evidence_ref=@evidenceRef,updated_at=@now
          WHERE reservation_id=@reservationId AND seller_id=@sellerId AND job_id=@jobId AND attempt_id=@attemptId AND status='held'`,
          )
          .run(input).changes;
        return changes === 1 ? success(exact(input)!, false) : conflict(input, ["held"]);
      });
    },
    release(input) {
      validateProof(input.proof);
      return transaction(() => {
        const found = read(input);
        const fields = found ? mismatches(found, input) : [];
        if (found && fields.length)
          return { ok: false, conflict: { kind: "identity-mismatch", fields } };
        if (found?.status === "released")
          return found.terminal_evidence_ref === input.proof.evidenceRef
            ? success(found, true)
            : divergent("proof.evidenceRef");
        const changes = db
          .prepare(
            `UPDATE creative_budget_reservations SET status='released',terminal_evidence_ref=@evidenceRef,updated_at=@now
          WHERE reservation_id=@reservationId AND seller_id=@sellerId AND job_id=@jobId AND attempt_id=@attemptId AND status='held'`,
          )
          .run({ ...input, evidenceRef: input.proof.evidenceRef }).changes;
        return changes === 1 ? success(exact(input)!, false) : conflict(input, ["held"]);
      });
    },
    renewHold(input) {
      if (input.fence.attemptId !== input.attemptId)
        return { ok: false, conflict: { kind: "identity-mismatch", fields: ["attemptId"] } };
      if (input.expiresAt <= input.fence.now)
        throw new RangeError("hold expiry must be in the future");
      return transaction(() => {
        const changes = db
          .prepare(
            `UPDATE creative_budget_reservations SET expires_at=@expiresAt,updated_at=@now
          WHERE reservation_id=@reservationId AND seller_id=@sellerId AND job_id=@jobId AND attempt_id=@attemptId AND status='held' AND EXISTS(
          SELECT 1 FROM creative_generation_attempts a WHERE a.attempt_id=@attemptId AND a.seller_id=@sellerId AND a.job_id=@jobId AND a.reservation_id=@reservationId
          AND a.lease_owner_id=@ownerId AND a.lease_token_digest=@tokenDigest AND a.lease_generation=@generation AND a.lease_expires_at>@now)`,
          )
          .run({ ...input, ...input.fence, tokenDigest: digest(input.fence.token) }).changes;
        if (changes === 1) return success(exact(input)!, false);
        const state = conflict(input, ["held"]);
        return state.conflict.kind !== "invalid-state" || state.conflict.state !== "held"
          ? state
          : {
              ok: false,
              conflict: {
                kind: "lease-lost",
                attemptId: input.fence.attemptId,
                generation: input.fence.generation,
              },
            };
      });
    },
    expireDue(input) {
      return transaction(() => {
        const due = db
          .prepare(
            `SELECT r.* FROM creative_budget_reservations r WHERE r.status='held' AND r.expires_at<=?
          AND NOT EXISTS(SELECT 1 FROM creative_generation_attempts a WHERE a.reservation_id=r.reservation_id AND a.seller_id=r.seller_id AND a.job_id=r.job_id AND a.attempt_id=r.attempt_id)
          ORDER BY r.expires_at,r.reservation_id LIMIT ?`,
          )
          .all(input.now, input.limit) as Row[];
        const update =
          db.prepare(`UPDATE creative_budget_reservations SET status='expired',updated_at=?
          WHERE reservation_id=? AND seller_id=? AND job_id=? AND attempt_id=? AND status='held' AND expires_at<=?`);
        const expired = due.filter(
          (r) =>
            update.run(input.now, r.reservation_id, r.seller_id, r.job_id, r.attempt_id, input.now)
              .changes === 1,
        );
        return {
          ok: true,
          value: expired.map((r) => fromRow({ ...r, status: "expired", updated_at: input.now })),
          idempotent: false,
        };
      });
    },
  };
}

function fromRow(r: Row): Reservation {
  // prettier-ignore
  return { reservationId: r.reservation_id, sellerId: r.seller_id, jobId: r.job_id,
    attemptId: r.attempt_id, currency: r.currency, utcDay: r.utc_day, status: r.status,
    reserved: micros(r.reserved_micros), committed: r.committed_micros === null ? null : micros(r.committed_micros),
    expiresAt: r.expires_at, terminalEvidenceRef: r.terminal_evidence_ref,
    createdAt: r.created_at, updatedAt: r.updated_at };
}
function mismatches(r: Row, k: ReservationKey): string[] {
  const stored = [r.reservation_id, r.seller_id, r.job_id, r.attempt_id];
  const supplied = [k.reservationId, k.sellerId, k.jobId, k.attemptId];
  return keyFields.filter((_, i) => stored[i] !== supplied[i]);
}
// prettier-ignore
function success(r: Row, idempotent: boolean): StoreResult<Reservation> { return { ok: true, value: fromRow(r), idempotent }; }
// prettier-ignore
function divergent(field: string): Failed { return { ok: false, conflict: { kind: "divergent-repeat", field } }; }
// prettier-ignore
function invalid(state: string, expected: readonly string[]): Failed { return { ok: false, conflict: { kind: "invalid-state", state, expected } }; }
// prettier-ignore
function digest(token: string): string { return createHash("sha256").update(token, "utf8").digest("hex"); }

// prettier-ignore
function validateReserve(input: Parameters<ReservationStore["reserve"]>[0]): void {
  micros(input.requested); micros(input.dailyCap); micros(input.jobCap);
  if (input.requested <= 0 || input.dailyCap <= 0 || input.jobCap <= 0) throw new RangeError("reservation amounts and caps must be positive");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new RangeError("currency must be uppercase ISO-4217");
  if (input.utcDay !== new Date(input.now).toISOString().slice(0, 10)) throw new RangeError("utcDay must match now in UTC");
}
function validateProof(proof: Parameters<ReservationStore["release"]>[0]["proof"]): void {
  // prettier-ignore
  const valid =
    (proof.kind === "transport-before-send" && proof.authority === "minimax-transport" && proof.bodyBytesOffered === 0) ||
    (proof.kind === "provider-rejection" && proof.authority === "minimax-adapter" && !proof.accepted && !proof.charged) ||
    (proof.kind === "operator-reconciliation" && proof.authority === "creative-ops" && proof.confirmedUnsent && proof.confirmedUncharged);
  if (!valid || !proof.evidenceRef) throw new Error("trusted no-submission proof required");
}
