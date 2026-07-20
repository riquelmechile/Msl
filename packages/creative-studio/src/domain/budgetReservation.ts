import type { Micros } from "@msl/domain";
import type { NoSubmissionProof } from "./generationAttempt.js";

export type ReservationKey = Readonly<{
  reservationId: string;
  sellerId: string;
  jobId: string;
  attemptId: string;
}>;

export type Reservation = Readonly<
  ReservationKey & {
    currency: string;
    utcDay: string;
    status: "held" | "committed" | "released" | "expired";
    reserved: Micros;
    committed: Micros | null;
    expiresAt: number;
    terminalEvidenceRef: string | null;
    createdAt: number;
    updatedAt: number;
  }
>;

export type ReservationConflict =
  | { kind: "identity-mismatch"; fields: readonly string[] }
  | { kind: "divergent-repeat"; field: string }
  | { kind: "invalid-state"; state: string; expected: readonly string[] }
  | { kind: "amount-over-reserved"; reserved: Micros; actual: Micros }
  | { kind: "busy"; retryable: true }
  | { kind: "lease-lost"; attemptId: string; generation: number };

export type StoreResult<T> =
  { ok: true; value: T; idempotent: boolean } | { ok: false; conflict: ReservationConflict };

export type AttemptFence = Readonly<{
  attemptId: string;
  ownerId: string;
  token: string;
  generation: number;
  now: number;
}>;

export type ReservationStore = {
  reserve(
    input: ReservationKey & {
      currency: string;
      utcDay: string;
      requested: Micros;
      dailyCap: Micros;
      jobCap: Micros;
      expiresAt: number;
      now: number;
    },
  ): StoreResult<Reservation>;
  get(key: ReservationKey): Reservation | undefined;
  commit(
    input: ReservationKey & { actual: Micros; evidenceRef: string; now: number },
  ): StoreResult<Reservation>;
  release(
    input: ReservationKey & { proof: NoSubmissionProof; now: number },
  ): StoreResult<Reservation>;
  renewHold(
    input: ReservationKey & { fence: AttemptFence; expiresAt: number },
  ): StoreResult<Reservation>;
  expireDue(input: { now: number; limit: number }): StoreResult<readonly Reservation[]>;
};
