import type { GuardrailResult, StorefrontProjection, WriteActionKind } from "@msl/domain";
import { createPreparedAction } from "@msl/domain";
import type { OwnedEcommerceStore } from "@msl/memory";

import type { ToolDefinition } from "./tools.js";

type ApprovalOperation = "publish" | "checkout" | "payment" | "price" | "stock" | "risky-claim";

const CREDENTIAL_REF_REDACTED = "[credential-ref-redacted]";
const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

const credentialRequiredOperations = new Set<ApprovalOperation>([
  "publish",
  "checkout",
  "payment",
  "price",
  "stock",
]);

type OwnedEcommerceToolsOptions = {
  now?: () => Date;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    : [];
}

function normalizeOperation(value: unknown): ApprovalOperation {
  switch (readString(value)?.toLowerCase()) {
    case "checkout":
    case "payment":
    case "price":
    case "stock":
    case "risky-claim":
      return readString(value)!.toLowerCase() as ApprovalOperation;
    case "publish":
    default:
      return "publish";
  }
}

function actionKindForOperation(operation: ApprovalOperation): WriteActionKind | undefined {
  switch (operation) {
    case "publish":
      return "owned-ecommerce-publish";
    case "checkout":
    case "payment":
      return "owned-ecommerce-checkout-activation";
    case "price":
      return "owned-ecommerce-price-change";
    case "stock":
      return "owned-ecommerce-stock-change";
    case "risky-claim":
      return undefined;
  }
}

function blockingReadinessChecks(projection: StorefrontProjection): GuardrailResult[] {
  return projection.readiness.checks.filter((check) => !check.passed && check.severity === "block");
}

function approvalRequiredReadinessChecks(projection: StorefrontProjection): GuardrailResult[] {
  return projection.readiness.checks.filter(
    (check) => !check.passed && check.severity === "approval-required",
  );
}

function blockedClaims(projection: StorefrontProjection) {
  return projection.content.claims.filter((claim) => claim.status === "blocked");
}

function credentialMetadata(operation: ApprovalOperation, credentialRef?: string) {
  const credentialRequired = credentialRequiredOperations.has(operation);
  const credentialProvided = credentialRef !== undefined;
  return {
    credentialRequired,
    credentialProvided,
    credentialRefRedacted: credentialProvided ? CREDENTIAL_REF_REDACTED : null,
  };
}

function summarizeProjection(projection: StorefrontProjection) {
  const blockers = blockingReadinessChecks(projection);
  const approvals = approvalRequiredReadinessChecks(projection);
  const claims = blockedClaims(projection);
  return {
    projectionId: projection.id,
    status: projection.status,
    readinessStatus: projection.readiness.status,
    productCount: projection.catalog.products.length,
    mediaCount: projection.media.length,
    claimCount: projection.content.claims.length,
    blockedClaimCount: claims.length,
    blockingReadinessCodes: blockers.map((check) => check.code),
    approvalRequiredCodes: approvals.map((check) => check.code),
    evidenceIds: projection.evidenceIds,
    generatedAt: projection.generatedAt,
  };
}

export function createOwnedEcommerceTools(
  store: OwnedEcommerceStore,
  options: OwnedEcommerceToolsOptions = {},
): ToolDefinition[] {
  const now = options.now ?? (() => new Date());

  const reviewProjection: ToolDefinition = {
    name: "review_owned_ecommerce_projection",
    description:
      "Reviews owned ecommerce storefront projection readiness for the CEO. Read-only and CEO-facing; ecommerce workers stay internal and never message the human directly.",
    parameters: {
      type: "object",
      properties: {
        projectionId: { type: "string" },
      },
      required: ["projectionId"],
    },
    execute: async (args) => {
      const projectionId = readString(args.projectionId);
      if (!projectionId) {
        return {
          status: "blocked",
          missingInputs: ["projectionId"],
          noMutationExecuted: true,
          workerReturnedToCeo: true,
          humanMessageSent: false,
        };
      }

      const projection = await store.getProjection(projectionId);
      if (!projection) {
        return {
          status: "blocked",
          projectionId,
          failures: ["storefront projection is missing"],
          noMutationExecuted: true,
          workerReturnedToCeo: true,
          humanMessageSent: false,
        };
      }

      const [validationResults, evidenceIds] = await Promise.all([
        store.listValidationResults(projection.id),
        store.listEvidenceIdsForProjection(projection.id),
      ]);
      const blockers = blockingReadinessChecks(projection);

      return {
        status: blockers.length > 0 ? "blocked" : "ready-for-ceo-review",
        projection: summarizeProjection(projection),
        validationResults: validationResults.map((record) => ({
          id: record.id,
          code: record.result.code,
          passed: record.result.passed,
          severity: record.result.severity,
          evidenceIds: record.evidenceIds,
          redactedMessage: record.redactedMessage,
        })),
        evidenceIds,
        approvalNeeds: [
          ...approvalRequiredReadinessChecks(projection).map((check) => check.code),
          ...blockedClaims(projection).map((claim) => `claim:${claim.id}`),
        ],
        noMutationExecuted: true,
        workerReturnedToCeo: true,
        humanMessageSent: false,
        ceoTelegramOnly: true,
      };
    },
  };

  const prepareApproval: ToolDefinition = {
    name: "prepare_owned_ecommerce_approval_request",
    description:
      "Prepares CEO approval requests for owned ecommerce publish, checkout/payment, price/stock, or risky-claim decisions. It never executes public publishing, payments, price changes, stock changes, or customer-visible content.",
    parameters: {
      type: "object",
      properties: {
        projectionId: { type: "string" },
        operation: {
          type: "string",
          enum: ["publish", "checkout", "payment", "price", "stock", "risky-claim"],
        },
        itemRef: { type: "string" },
        sellerId: { type: "string" },
        exactCeoApproval: { type: "boolean" },
        credentialRef: { type: "string" },
        auditId: { type: "string" },
        approvalId: { type: "string" },
        evidenceIds: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
      },
      required: ["projectionId", "operation"],
    },
    execute: async (args) => {
      const projectionId = readString(args.projectionId);
      const operation = normalizeOperation(args.operation);
      const credentialRef = readString(args.credentialRef);
      const auditId = readString(args.auditId);
      const approvalId = readString(args.approvalId);
      const evidenceIds = readStringArray(args.evidenceIds);
      const credential = credentialMetadata(operation, credentialRef);
      const missingInputs: string[] = [];
      const failures: string[] = [];

      if (!projectionId) missingInputs.push("projectionId");
      if (!auditId) missingInputs.push("redacted audit record id");
      if (credential.credentialRequired && !credential.credentialProvided) {
        missingInputs.push("configured credential reference");
      }

      if (!projectionId) {
        return {
          status: "blocked",
          operation,
          missingInputs,
          failures,
          ...credential,
          noMutationExecuted: true,
          approvalRequired: true,
          humanMessageSent: false,
          ceoTelegramRequired: true,
        };
      }

      const projection = await store.getProjection(projectionId);
      if (!projection) failures.push("storefront projection is missing");
      const readinessBlockers = projection ? blockingReadinessChecks(projection) : [];
      const unsupportedClaims = projection ? blockedClaims(projection) : [];
      if (projection && projection.readiness.status !== "ready") {
        failures.push(`projection readiness is ${projection.readiness.status}`);
      }
      failures.push(...readinessBlockers.map((check) => check.redactedMessage));
      if (unsupportedClaims.length > 0) {
        failures.push("unsupported risky claims remain in the projection");
      }

      if (missingInputs.length > 0 || failures.length > 0) {
        return {
          status: failures.length > 0 ? "blocked" : "approval-required",
          operation,
          projectionId,
          missingInputs,
          failures,
          readinessCodes: readinessBlockers.map((check) => check.code),
          blockedClaimIds: unsupportedClaims.map((claim) => claim.id),
          ...credential,
          noMutationExecuted: true,
          approvalRequired: true,
          humanMessageSent: false,
          ceoTelegramRequired: true,
        };
      }

      const actionKind = actionKindForOperation(operation);
      if (!actionKind || !projection) {
        const redactedAuditId = auditId ?? "missing-audit-record";
        return {
          status: "proposal-prepared",
          operation,
          projectionId,
          approvalRequest: {
            auditId: redactedAuditId,
            evidenceIds: [...new Set([...(projection?.evidenceIds ?? []), ...evidenceIds])],
            rationale: readString(args.rationale) ?? "CEO risky-claim review prepared.",
          },
          ...credential,
          noMutationExecuted: true,
          approvalRequired: true,
          humanMessageSent: false,
          ceoTelegramRequired: true,
        };
      }

      const target =
        operation === "price" || operation === "stock"
          ? {
              type: "ecommerce-catalog-item" as const,
              itemRef:
                readString(args.itemRef) ?? projection.catalog.products[0]?.handle ?? projection.id,
              projectionId: projection.id,
            }
          : { type: "storefront-projection" as const, projectionId: projection.id };
      const preparedAction = createPreparedAction({
        id: `${operation}:${projection.id}:${auditId}`,
        sellerId: readString(args.sellerId) ?? "ceo",
        kind: actionKind,
        target,
        exactChange: [
          {
            field: operation,
            from: "preview-only",
            to: "approval-prepared",
          },
        ],
        rationale: readString(args.rationale) ?? `Prepare owned ecommerce ${operation} approval.`,
        expiresAt: new Date(now().getTime() + APPROVAL_EXPIRY_MS),
        auditId: auditId ?? "missing-audit-record",
      });
      const combinedEvidenceIds = [...new Set([...projection.evidenceIds, ...evidenceIds])];

      return {
        status: "proposal-prepared",
        operation,
        projectionId: projection.id,
        preparedAction,
        ...credential,
        auditId,
        approvalId: null,
        ignoredApprovalId: approvalId ? true : false,
        evidenceIds: combinedEvidenceIds,
        noMutationExecuted: true,
        approvalRequired: true,
        checkoutActivated: false,
        paymentActivated: false,
        publicPublishExecuted: false,
        priceMutationExecuted: false,
        stockMutationExecuted: false,
        humanMessageSent: false,
        ceoTelegramRequired: true,
      };
    },
  };

  return [reviewProjection, prepareApproval];
}
