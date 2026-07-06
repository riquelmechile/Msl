import type { OwnedEcommerceStore } from "@msl/memory";
import {
  canExecuteOwnedEcommerceAction,
  type ApprovalRecord,
  type OwnedEcommerceExecutionGateReason,
  type OwnedEcommerceExecutionOperation,
  type OwnedEcommerceExecutionRequest,
  type OwnedEcommerceExecutionResult,
  type OwnedEcommerceExecutionTarget,
  type PreparedAction,
  type StorefrontProjection,
} from "@msl/domain";

type RuntimeWriteBoundaryDecision =
  | { allowed: true; publicUrl: string }
  | {
      allowed: false;
      reason:
        | "approval-required"
        | "readiness-blocked"
        | "publishing-disabled"
        | "credentials-missing";
    };

type RuntimeWriteBoundaryInput = {
  projection: StorefrontProjection;
  approval: ApprovalRecord;
  auditId: string;
  rollbackRef: string;
  operation: OwnedEcommerceExecutionOperation;
};

export type OwnedEcommerceRuntimeWriteBoundary = {
  isConfigured(): boolean;
  publish(input: RuntimeWriteBoundaryInput): Promise<RuntimeWriteBoundaryDecision>;
  activateCheckout(input: RuntimeWriteBoundaryInput): Promise<RuntimeWriteBoundaryDecision>;
};

const DEFAULT_READINESS_MAX_AGE_MS = 15 * 60 * 1000;

export type OwnedEcommerceRuntimeExecutor = {
  execute(request: OwnedEcommerceExecutionRequest): Promise<OwnedEcommerceExecutionResult>;
};

export type OwnedEcommerceRuntimeExecutionObserver = (event: {
  phase: "gate-blocked" | "write-boundary-blocked" | "write-boundary-failed" | "persistence-failed";
  status: "blocked" | "duplicate" | "failed";
  reasonCodes: readonly OwnedEcommerceExecutionGateReason[];
  operation: OwnedEcommerceExecutionOperation;
  projectionId: string;
  projectionVersion: string;
  actionId: string;
  approvalId: string;
  auditId?: string;
}) => void;

export type OwnedEcommerceRuntimeExecutorOptions = {
  store: OwnedEcommerceStore;
  writeBoundary: OwnedEcommerceRuntimeWriteBoundary;
  now?: () => Date;
  readinessMaxAgeMs?: number;
  observer?: OwnedEcommerceRuntimeExecutionObserver;
};

export function createOwnedEcommerceRuntimeExecutor(
  options: OwnedEcommerceRuntimeExecutorOptions,
): OwnedEcommerceRuntimeExecutor {
  const now = options.now ?? (() => new Date());
  const readinessMaxAgeMs = options.readinessMaxAgeMs ?? DEFAULT_READINESS_MAX_AGE_MS;

  return {
    async execute(request) {
      const currentTime = now();

      const block = (
        reasonCodes: OwnedEcommerceExecutionGateReason[],
        status: "blocked" | "duplicate" | "failed" = "blocked",
        auditId?: string,
        phase: Parameters<OwnedEcommerceRuntimeExecutionObserver>[0]["phase"] = "gate-blocked",
        rollbackRef?: string,
      ): OwnedEcommerceExecutionResult => {
        observeExecutionFailure(options.observer, request, {
          phase,
          status,
          reasonCodes,
          ...(auditId ? { auditId } : {}),
        });
        return blocked(reasonCodes, status, auditId, rollbackRef);
      };

      if (!options.writeBoundary.isConfigured()) {
        return block(["missing-credentials"]);
      }

      let projection: StorefrontProjection | null;
      try {
        projection = await options.store.getProjectionRevision(
          request.projectionId,
          request.projectionVersion,
        );
      } catch {
        return block(["missing-projection-revision"], "blocked", undefined, "persistence-failed");
      }
      if (!projection) {
        return block(["missing-projection-revision"]);
      }

      const projectionGateReasons = projectionGateFailures(
        projection,
        currentTime,
        readinessMaxAgeMs,
      );
      if (projectionGateReasons.length > 0) {
        return block(projectionGateReasons);
      }

      let approvalRecord: Awaited<ReturnType<OwnedEcommerceStore["getApproval"]>>;
      try {
        approvalRecord = await options.store.getApproval(request.approvalId);
      } catch {
        return block(["missing-approval"], "blocked", undefined, "persistence-failed");
      }
      if (!approvalRecord) {
        return block(["missing-approval"]);
      }
      const approvalDecision = canExecuteOwnedEcommerceAction(
        {
          action: actionFromRuntimeRequest(
            request,
            approvalRecord.approval,
            request.operation,
            expectedExecutionTarget(request, projection),
          ),
          projectionId: request.projectionId,
          projectionVersion: request.projectionVersion,
          target: expectedExecutionTarget(request, projection),
          operation: request.operation,
        },
        currentTime,
        approvalRecord.approval,
      );
      if (!approvalDecision.allowed) {
        return block([approvalReasonCode(approvalDecision.reason)]);
      }

      const rollbackRef = rollbackRefFor(request);
      let rollback: Awaited<ReturnType<OwnedEcommerceStore["resolveRollbackRef"]>>;
      try {
        rollback = await options.store.resolveRollbackRef(rollbackRef);
      } catch {
        return block(["missing-rollback-evidence"], "blocked", undefined, "persistence-failed");
      }
      if (!rollback) {
        return block(["missing-rollback-evidence"]);
      }

      const reservation = await reserveIdempotency(options.store, {
        ...request,
        createdAt: currentTime.toISOString(),
      });
      if (!reservation) {
        return block(["duplicate-idempotency-key"], "duplicate");
      }
      const auditId = auditIdFor(request);
      const preflightAuditId = `${auditId}:preflight`;

      if (reservation.status === "duplicate") {
        return (
          reservation.reservation.result ??
          block(
            ["duplicate-idempotency-key"],
            "duplicate",
            preflightAuditId,
            "gate-blocked",
            rollbackRef,
          )
        );
      }

      if (approvalRecord.approval.executionStatus === "executed") {
        return block(["approval-already-executed"]);
      }

      try {
        await options.store.recordExecutionAudit({
          id: preflightAuditId,
          summary: {
            auditId: preflightAuditId,
            projectionId: request.projectionId,
            projectionVersion: request.projectionVersion,
            actionId: request.actionId,
            approvalId: request.approvalId,
            operation: request.operation,
            status: "started",
            approver: "seller",
            risk: approvalRecord.approval.riskAccepted,
            rationale:
              approvalRecord.approval.ownedEcommerceBinding?.rationale ??
              "Owned ecommerce runtime execution.",
            reasonCodes: [],
            rollbackRef,
            createdAt: currentTime.toISOString(),
          },
          redactedPreState: {
            projectionId: projection.id,
            projectionVersion: projection.projectionVersion,
            readinessStatus: projection.readiness.status,
            productCount: projection.catalog.products.length,
          },
          createdAt: currentTime.toISOString(),
        });
      } catch {
        return block(["missing-audit-storage"], "blocked", undefined, "persistence-failed");
      }

      let consumedApproval: Awaited<ReturnType<OwnedEcommerceStore["consumeExecutionApproval"]>>;
      try {
        consumedApproval = await options.store.consumeExecutionApproval(request);
      } catch {
        return block(
          ["execution-evidence-persistence-failed"],
          "failed",
          preflightAuditId,
          "persistence-failed",
          rollbackRef,
        );
      }
      if (consumedApproval.status === "missing") {
        return block(["missing-approval"]);
      }
      if (consumedApproval.status === "mismatch") {
        return block(["approval-binding-mismatch"]);
      }
      if (consumedApproval.status === "already-consumed") {
        return block(["approval-already-executed"]);
      }
      approvalRecord = consumedApproval.approvalRecord;

      const decision = await writeSafely(options.writeBoundary, request.operation, {
        projection,
        approval: approvalRecord.approval,
        auditId: preflightAuditId,
        rollbackRef,
        operation: request.operation,
      });
      if (!decision) {
        await recordFailure(
          options.store,
          request,
          currentTime,
          ["write-boundary-failed"],
          "failed",
          preflightAuditId,
          rollbackRef,
          options.observer,
        );
        return block(
          ["write-boundary-failed"],
          "failed",
          preflightAuditId,
          "write-boundary-failed",
          rollbackRef,
        );
      }
      if (!decision.allowed) {
        const reasonCode = boundaryReasonCode(decision.reason);
        await recordFailure(
          options.store,
          request,
          currentTime,
          [reasonCode],
          "blocked",
          preflightAuditId,
          rollbackRef,
          options.observer,
        );
        return block(
          [reasonCode],
          "blocked",
          preflightAuditId,
          "write-boundary-blocked",
          rollbackRef,
        );
      }

      const result: OwnedEcommerceExecutionResult = {
        status: "executed",
        auditId,
        rollbackRef,
        publicUrl: decision.publicUrl,
      };
      try {
        await options.store.recordExecutionAudit({
          id: auditId,
          summary: {
            auditId,
            projectionId: request.projectionId,
            projectionVersion: request.projectionVersion,
            actionId: request.actionId,
            approvalId: request.approvalId,
            operation: request.operation,
            status: "executed",
            approver: "seller",
            risk: approvalRecord.approval.riskAccepted,
            rationale:
              approvalRecord.approval.ownedEcommerceBinding?.rationale ??
              "Owned ecommerce runtime execution.",
            reasonCodes: [],
            rollbackRef,
            createdAt: currentTime.toISOString(),
          },
          redactedPreState: {
            projectionId: projection.id,
            projectionVersion: projection.projectionVersion,
            readinessStatus: projection.readiness.status,
            productCount: projection.catalog.products.length,
          },
          createdAt: currentTime.toISOString(),
        });
        await options.store.recordExecution({
          id: executionIdFor(request),
          request,
          status: "executed",
          auditId,
          rollbackRef,
          result,
          createdAt: currentTime.toISOString(),
          updatedAt: currentTime.toISOString(),
        });
      } catch {
        await recordFailure(
          options.store,
          request,
          currentTime,
          ["execution-evidence-persistence-failed"],
          "failed",
          preflightAuditId,
          rollbackRef,
          options.observer,
        );
        return block(
          ["execution-evidence-persistence-failed"],
          "failed",
          preflightAuditId,
          "persistence-failed",
          rollbackRef,
        );
      }

      return result;
    },
  };
}

function projectionGateFailures(
  projection: StorefrontProjection,
  now: Date,
  readinessMaxAgeMs: number,
): OwnedEcommerceExecutionGateReason[] {
  const reasons: OwnedEcommerceExecutionGateReason[] = [];
  const readinessGeneratedAtMs = new Date(projection.readiness.generatedAt).getTime();
  if (
    !Number.isFinite(readinessGeneratedAtMs) ||
    now.getTime() - readinessGeneratedAtMs > readinessMaxAgeMs
  ) {
    reasons.push("stale-readiness");
  }
  if (
    projection.readiness.status !== "ready" ||
    projection.readiness.checks.some((check) => !check.passed && check.severity === "block")
  ) {
    reasons.push("blocked-projection");
  }
  if (projection.content.claims.some((claim) => claim.status === "blocked")) {
    reasons.push("unsafe-claim");
  }
  return reasons;
}

function actionFromRuntimeRequest(
  request: OwnedEcommerceExecutionRequest,
  approval: ApprovalRecord,
  operation: OwnedEcommerceExecutionOperation,
  target: OwnedEcommerceExecutionTarget,
): PreparedAction {
  const binding = approval.ownedEcommerceBinding;
  return {
    id: request.actionId,
    sellerId: approval.sellerId,
    kind:
      operation === "publish" ? "owned-ecommerce-publish" : "owned-ecommerce-checkout-activation",
    target,
    exactChange: approval.exactChangeAccepted,
    rationale: binding?.rationale ?? "Owned ecommerce runtime execution.",
    riskLevel: approval.riskAccepted,
    expiresAt: binding?.expiresAt ?? new Date(0),
    approvalStatus: "approved",
  };
}

function expectedExecutionTarget(
  request: OwnedEcommerceExecutionRequest,
  projection: StorefrontProjection,
): OwnedEcommerceExecutionTarget {
  return { type: "storefront-projection", projectionId: projection.id ?? request.projectionId };
}

async function reserveIdempotency(
  store: OwnedEcommerceStore,
  reservation: OwnedEcommerceExecutionRequest & { createdAt: string },
) {
  try {
    return await store.reserveExecutionIdempotency(reservation);
  } catch {
    return null;
  }
}

function blocked(
  reasonCodes: OwnedEcommerceExecutionGateReason[],
  status: "blocked" | "duplicate" | "failed" = "blocked",
  auditId?: string,
  rollbackRef?: string,
): OwnedEcommerceExecutionResult {
  return {
    status,
    reasonCodes,
    ...(auditId ? { auditId } : {}),
    ...(rollbackRef ? { rollbackRef } : {}),
  };
}

async function recordFailure(
  store: OwnedEcommerceStore,
  request: OwnedEcommerceExecutionRequest,
  currentTime: Date,
  reasonCodes: OwnedEcommerceExecutionGateReason[],
  status: "blocked" | "failed" = "failed",
  auditId?: string,
  rollbackRef?: string,
  observer?: OwnedEcommerceRuntimeExecutionObserver,
): Promise<void> {
  try {
    await store.recordExecution({
      id: executionIdFor(request),
      request,
      status,
      result: blocked(reasonCodes, status, auditId, rollbackRef),
      createdAt: currentTime.toISOString(),
      updatedAt: currentTime.toISOString(),
    });
  } catch {
    observeExecutionFailure(observer, request, {
      phase: "persistence-failed",
      status: "failed",
      reasonCodes: ["execution-evidence-persistence-failed"],
    });
    // The caller still returns a controlled failure; persistence failure must not throw outward.
  }
}

function observeExecutionFailure(
  observer: OwnedEcommerceRuntimeExecutionObserver | undefined,
  request: OwnedEcommerceExecutionRequest,
  event: Pick<
    Parameters<OwnedEcommerceRuntimeExecutionObserver>[0],
    "phase" | "status" | "reasonCodes" | "auditId"
  >,
): void {
  if (!observer) return;
  try {
    observer({
      ...event,
      operation: request.operation,
      projectionId: request.projectionId,
      projectionVersion: request.projectionVersion,
      actionId: request.actionId,
      approvalId: request.approvalId,
    });
  } catch {
    // Observability hooks must not affect execution control flow.
  }
}

function approvalReasonCode(reason: string): OwnedEcommerceExecutionGateReason {
  if (reason === "missing-approval") return "missing-approval";
  if (reason === "expired-approval" || reason === "expired-action") return "expired-approval";
  return "approval-binding-mismatch";
}

function boundaryReasonCode(reason: string): OwnedEcommerceExecutionGateReason {
  if (reason === "credentials-missing" || reason === "publishing-disabled")
    return "missing-credentials";
  if (reason === "readiness-blocked") return "blocked-projection";
  return "approval-binding-mismatch";
}

function rollbackRefFor(request: OwnedEcommerceExecutionRequest): string {
  return `rollback:${request.projectionId}:${request.projectionVersion}:${request.operation}`;
}

function auditIdFor(request: OwnedEcommerceExecutionRequest): string {
  return `audit:${request.idempotencyKey}`;
}

function executionIdFor(request: OwnedEcommerceExecutionRequest): string {
  return `execution:${request.idempotencyKey}`;
}

function write(
  boundary: OwnedEcommerceRuntimeWriteBoundary,
  operation: OwnedEcommerceExecutionOperation,
  input: RuntimeWriteBoundaryInput,
) {
  return operation === "publish" ? boundary.publish(input) : boundary.activateCheckout(input);
}

async function writeSafely(
  boundary: OwnedEcommerceRuntimeWriteBoundary,
  operation: OwnedEcommerceExecutionOperation,
  input: RuntimeWriteBoundaryInput,
): Promise<RuntimeWriteBoundaryDecision | null> {
  try {
    return await write(boundary, operation, input);
  } catch {
    return null;
  }
}
