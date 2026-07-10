import type { GuardrailResult, StorefrontProjection, WriteActionKind } from "@msl/domain";
import { createPreparedAction } from "@msl/domain";
import type { OwnedEcommerceStore } from "@msl/memory";

import type { ToolDefinition } from "./tools.js";
import type { OwnedEcommerceIntelligenceService } from "../ecommerce/ownedEcommerceIntelligenceService.js";
import type { StorefrontProjectionPreparation } from "../ecommerce/storefrontProjectionBuilder.js";
import { buildProjection } from "../ecommerce/storefrontProjectionBuilder.js";
import { scoreCandidate } from "../ecommerce/storefrontCandidateScorer.js";

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
  options: OwnedEcommerceToolsOptions & {
    intelligenceService?: OwnedEcommerceIntelligenceService;
  } = {},
): ToolDefinition[] {
  const now = options.now ?? (() => new Date());
  const intelligenceService = options.intelligenceService;

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
      const ignoredApprovalClaim = args.exactCeoApproval === true || approvalId !== undefined;
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
          ignoredApprovalClaim,
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
          ignoredApprovalClaim,
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
          ignoredApprovalClaim,
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
        ignoredApprovalClaim,
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

  // ── E2: inspect_owned_ecommerce_candidate ──────────────────────

  const inspectCandidate: ToolDefinition = {
    name: "inspect_owned_ecommerce_candidate",
    description:
      "Read-only inspection of an owned-ecommerce candidate. Returns evidence, provenance, score, and blockers. No mutations ever executed.",
    parameters: {
      type: "object",
      properties: {
        candidateId: { type: "string" },
      },
      required: ["candidateId"],
    },
    execute: async (args) => {
      const candidateId = readString(args.candidateId);
      if (!candidateId) {
        return {
          status: "blocked",
          missingInputs: ["candidateId"],
          noMutationExecuted: true,
        };
      }

      const candidate = await store.getCandidate(candidateId);
      if (!candidate) {
        return {
          status: "not-found",
          candidateId,
          reason: "Candidate not found in store",
          noMutationExecuted: true,
        };
      }

      return {
        status: "found",
        candidateId: candidate.id,
        title: candidate.title,
        itemRef: candidate.itemRef,
        provenance: {
          source: candidate.provenance.source,
          sourceId: candidate.provenance.sourceId,
          supplierId: candidate.provenance.supplierId,
          accountId: candidate.provenance.accountId,
          evidenceIds: candidate.provenance.evidenceIds,
        },
        evidenceState: candidate.evidenceState,
        stock: candidate.stock,
        margin: candidate.margin,
        blockedReasons: candidate.blockedReasons,
        redactedReasons: candidate.redactedReasons,
        evidenceIds: candidate.evidenceIds,
        createdAt: candidate.createdAt,
        noMutationExecuted: true,
      };
    },
  };

  // ── E2: prepare_storefront_projection ──────────────────────────

  const prepareProjection: ToolDefinition = {
    name: "prepare_storefront_projection",
    description:
      "Build a read-only storefront projection from a candidate without publishing. Returns the projection preparation envelope. No mutations ever executed.",
    parameters: {
      type: "object",
      properties: {
        candidateId: { type: "string" },
      },
      required: ["candidateId"],
    },
    execute: async (args) => {
      const candidateId = readString(args.candidateId);
      if (!candidateId) {
        return {
          status: "blocked",
          missingInputs: ["candidateId"],
          noMutationExecuted: true,
        };
      }

      // Fetch candidate from store
      const candidate = await store.getCandidate(candidateId);
      if (!candidate) {
        return {
          status: "not-found",
          candidateId,
          reason: "Candidate not found in store",
          noMutationExecuted: true,
        };
      }

      // If intelligence service is available, use it to compute score + projection
      let projection: StorefrontProjectionPreparation | undefined;
      let score;
      let errors: string[] = [];

      if (intelligenceService) {
        try {
          const result = intelligenceService.discoverStorefrontCandidates();
          const foundCandidate = result.candidates.find((c) => c.id === candidateId);
          if (foundCandidate) {
            score = result.scores[candidateId];
            projection = result.projection;
            errors = result.errors;
          }
        } catch (err) {
          errors.push(
            `Intelligence service failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // If no intelligence service or no result, build a minimal projection
      if (!projection) {
        const computedScore = scoreCandidate(candidate);
        score = computedScore;
        projection = buildProjection([{ candidate, score: computedScore }]);
      }

      return {
        status: "prepared",
        candidateId,
        projection: projection
          ? {
              projectionId: projection.projectionId,
              title: projection.title,
              slug: projection.slug,
              readiness: projection.readiness,
              media: projection.media,
              pricing: projection.pricing,
              inventory: projection.inventory,
              evidenceIds: projection.evidenceIds,
            }
          : undefined,
        score: score
          ? {
              score: score.score,
              confidence: score.confidence,
              recommendedAction: score.recommendedAction,
              blockers: score.blockers,
              warnings: score.warnings,
              strengths: score.strengths,
            }
          : undefined,
        errors,
        noMutationExecuted: true,
      };
    },
  };

  // ── E2: read_storefront_projection_status ──────────────────────

  const readProjectionStatus: ToolDefinition = {
    name: "read_storefront_projection_status",
    description:
      "Read the status of a storefront projection by projectionId. Handles nonexistent projections gracefully. Read-only, no mutations.",
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
        };
      }

      const projection = await store.getProjection(projectionId);
      if (!projection) {
        return {
          status: "not-found",
          projectionId,
          reason: "Storefront projection does not exist",
          noMutationExecuted: true,
        };
      }

      const blockers = blockingReadinessChecks(projection);
      const approvals = approvalRequiredReadinessChecks(projection);

      return {
        status: blockers.length > 0 ? "blocked" : projection.readiness.status,
        projectionId: projection.id,
        projectionStatus: projection.status,
        readinessStatus: projection.readiness.status,
        generatedAt: projection.generatedAt,
        blockingCodes: blockers.map((c) => c.code),
        approvalRequiredCodes: approvals.map((c) => c.code),
        candidateIds: projection.candidateIds,
        evidenceIds: projection.evidenceIds,
        noMutationExecuted: true,
      };
    },
  };

  return [
    reviewProjection,
    prepareApproval,
    inspectCandidate,
    prepareProjection,
    readProjectionStatus,
  ];
}
