import type { Micros } from "@msl/domain";
import type { AttemptFence, ReservationKey, StoreResult } from "./budgetReservation.js";

export type AttemptEvidence = Readonly<{
  ref: string;
  kind: "request" | "submission" | "result" | "error" | "no-submission";
  payload: unknown;
  recordedAt: string;
}>;

export type NoSubmissionProof = Readonly<
  | {
      kind: "transport-before-send";
      authority: "minimax-transport";
      bodyBytesOffered: 0;
      evidenceRef: string;
    }
  | {
      kind: "provider-rejection";
      authority: "minimax-adapter";
      accepted: false;
      charged: false;
      providerRequestId: string;
      evidenceRef: string;
    }
  | {
      kind: "operator-reconciliation";
      authority: "creative-ops";
      confirmedUnsent: true;
      confirmedUncharged: true;
      evidenceRef: string;
    }
>;

export type GenerationAttempt = Readonly<
  ReservationKey & {
    messageId: string;
    provider: string;
    model: string;
    idempotencyKey: string;
    requestHash: string;
    state: "prepared" | "dispatching" | "submitted" | "completed" | "failed" | "ambiguous";
    estimated: Micros;
    actual: Micros | null;
    taskId: string | null;
    providerRequestId: string | null;
    requestEvidence: AttemptEvidence;
    submissionEvidence: AttemptEvidence | null;
    resultEvidence: AttemptEvidence | null;
    errorEvidence: AttemptEvidence | null;
    noSubmissionProof: NoSubmissionProof | null;
    lease: Readonly<{ ownerId: string; generation: number; expiresAt: number }> | null;
    dispatchingAt: number | null;
    submittedAt: number | null;
    terminalAt: number | null;
    createdAt: number;
    updatedAt: number;
  }
>;

export type LeaseGrant = Readonly<{
  attempt: GenerationAttempt;
  lease: Readonly<{ ownerId: string; token: string; generation: number; expiresAt: number }>;
}>;

export type AttemptStore = {
  prepare(
    input: ReservationKey & {
      messageId: string;
      provider: string;
      model: string;
      idempotencyKey: string;
      requestHash: string;
      estimated: Micros;
      requestEvidence: AttemptEvidence;
      leaseOwnerId: string;
      leaseExpiresAt: number;
      now: number;
    },
  ): StoreResult<LeaseGrant>;
  get(attemptId: string): GenerationAttempt | undefined;
  acquireDue(input: {
    ownerId: string;
    now: number;
    limit: number;
  }): StoreResult<readonly LeaseGrant[]>;
  renewLease(input: AttemptFence & { expiresAt: number }): StoreResult<GenerationAttempt>;
  markDispatching(input: AttemptFence): StoreResult<GenerationAttempt>;
  markSubmitted(
    input: AttemptFence & {
      taskId: string;
      providerRequestId: string | null;
      evidence: AttemptEvidence;
    },
  ): StoreResult<GenerationAttempt>;
  markAmbiguous(
    input: AttemptFence & { evidence: AttemptEvidence },
  ): StoreResult<GenerationAttempt>;
  complete(
    input: AttemptFence & { actual: Micros; evidence: AttemptEvidence },
  ): StoreResult<GenerationAttempt>;
  fail(
    input: AttemptFence & { error: AttemptEvidence; proof: NoSubmissionProof },
  ): StoreResult<GenerationAttempt>;
};
