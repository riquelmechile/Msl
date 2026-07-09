import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type {
  ApprovalQueueEntry,
  ApprovalQueueRepository,
  Clock,  // eslint-disable-line @typescript-eslint/no-unused-vars
  PrepareWriteInput,  // eslint-disable-line @typescript-eslint/no-unused-vars
} from "@msl/tools";
import type { ApprovalRecord, ExactChange } from "@msl/domain";
import {
  applyStrategies,
  assertCompleteMlcItem,
  assertPlasticovToMaustianDirection,
  buildNewItemFromMlItem,
  getMlAccountRoleConfig,
  normalizeImageOrchestration,  // eslint-disable-line @typescript-eslint/no-unused-vars
  normalizeMlcItemId,
  previewStrategyChanges,
  MLC_PRODUCT_ADS_MAX_LIMIT,  // eslint-disable-line @typescript-eslint/no-unused-vars
  type MlcApiClient,  // eslint-disable-line @typescript-eslint/no-unused-vars
  type MlcImageOrchestrationSummary,  // eslint-disable-line @typescript-eslint/no-unused-vars
  type MlItem,
  type MlWriteSnapshot,
  type MlAccountRoleConfig,
  type NewItem,
  type Strategy,
} from "@msl/mercadolibre";
import { createPreparedActionTool } from "@msl/tools";
import type {
  McpServerConfig,
  SyncPreviewDependency,
  SyncProductPreview,
  SyncProductReadinessEvidenceProviders,
} from "../index.js";
import { areStrategies } from "../strategyValidation.js";

import {
  jsonResult,
  unauthorizedResult,
  blockedResult,
  trimmedString,
  parseStrictIsoTimestamp,
  approvalStorageMetadata,
} from "./utils.js";

// ── Sync-proposal specific schemas ───────────────────────────────────

const mcpSyncProductInputSchema = {
  sourceSellerId: z.string().optional(),
  targetSellerId: z.string().optional(),
  itemId: z.string().optional(),
  itemIds: z.array(z.string()).optional(),
  productIds: z.array(z.string()).optional(),
  items: z
    .array(
      z.object({
        itemId: z.string(),
        variations: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
  syncAll: z.boolean().optional(),
  bulk: z.boolean().optional(),
  rationale: z.string().optional(),
  expiresAt: z.string().optional(),
  requiresApproval: z.boolean().optional(),
  risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  msl_api_key: z.string().optional(),
};

const mcpReadSyncProductStatusInputSchema = {
  actionId: z.string(),
  msl_api_key: z.string().optional(),
};

const mcpApproveSyncProductProposalInputSchema = {
  actionId: z.string(),
  msl_api_key: z.string().optional(),
};

const mcpReadSyncProductExecutionReadinessInputSchema = {
  actionId: z.string(),
  msl_api_key: z.string().optional(),
};

const mcpExecuteSyncProductInputSchema = {
  actionId: z.string(),
  msl_api_key: z.string().optional(),
};

// ── Sync-specific types ──────────────────────────────────────────────

type SyncProductInput = {
  sourceSellerId?: unknown;
  targetSellerId?: unknown;
  itemId?: unknown;
  itemIds?: unknown;
  productIds?: unknown;
  items?: unknown;
  syncAll?: unknown;
  bulk?: unknown;
  rationale?: unknown;
  expiresAt?: unknown;
  requiresApproval?: unknown;
  risk?: unknown;
  msl_api_key?: string;
};

type ReadSyncProductStatusInput = {
  actionId?: unknown;
  msl_api_key?: string;
};

type ApproveSyncProductProposalInput = {
  actionId?: unknown;
  msl_api_key?: string;
};

type ReadSyncProductExecutionReadinessInput = {
  actionId?: unknown;
  msl_api_key?: string;
};

type ExecuteSyncProductInput = {
  actionId?: unknown;
  msl_api_key?: string;
};

type SyncProductReadinessStatus = "eligible" | "blocked" | "degraded";

type SyncProductReadinessReason =
  | "approval-unavailable"
  | "approval-expired"
  | "approval-binding-mismatch"
  | "proposal-not-sync-product"
  | "source-read-failed"
  | "source-evidence-incomplete"
  | "preview-drift-detected"
  | "seller-scope-mismatch"
  | "target-account-unavailable"
  | "api-capability-evidence-missing"
  | "rollback-strategy-missing"
  | "rate-limited"
  | "upstream-temporary-failure"
  | "reconnect-required"
  | "storage-unavailable";

type ReadSyncProductExecutionReadinessResponse = {
  status: SyncProductReadinessStatus;
  actionId: "redacted";
  reasons: SyncProductReadinessReason[];
  evidence: {
    approvalBound: boolean;
    preview: "matched" | "drifted" | "unavailable";
    idempotencyCandidate?: string;
    rollbackStrategyPresent: boolean;
    apiCapabilityEvidence: "missing" | "present";
  };
  noMutationExecuted: true;
};

type ReadSyncProductStatusUnavailableResponse = {
  status: "unavailable";
  reason: "not-found-or-unsupported";
  noMutationExecuted: true;
};

type ReadSyncProductStatusAvailableResponse = {
  status: "available";
  actionId: "redacted";
  effectiveStatus: "pending" | "approved" | "rejected" | "expired";
  expiresAt: string;
  risk: "high";
  target: { type: "listing"; listingId: string };
  rationale: string;
  preview: { status: "available" | "unavailable"; summary: string };
  metadata: {
    requiresApproval: true;
    noMutationExecuted: true;
    auditReplay: "not-available";
    approvalPersistence: "in-memory-only" | "sqlite" | "sqlite-unavailable";
    persistentApprovalStorage: boolean;
    approvalStorageDegraded?: true;
  };
};

type ReadSyncProductStatusResponse =
  ReadSyncProductStatusAvailableResponse | ReadSyncProductStatusUnavailableResponse;

type ApproveSyncProductProposalUnavailableResponse = {
  status: "unavailable";
  reason: "not-found-or-unsupported";
  noMutationExecuted: true;
};

type ApproveSyncProductProposalApprovedResponse = {
  status: "approved";
  actionId: "redacted";
  noMutationExecuted: true;
};

type ApproveSyncProductProposalResponse =
  ApproveSyncProductProposalApprovedResponse | ApproveSyncProductProposalUnavailableResponse;

type ExecuteSyncProductResultResponse = {
  status: "executed";
  actionId: "redacted";
  itemId: string;
  permalink: string;
  sourcePrice: number;
  targetPrice: number;
  strategiesApplied: number;
  mutationExecuted: true;
};

type ExecuteSyncProductBlockedResponse = {
  status: "blocked";
  actionId: "redacted";
  reason: string;
  details?: string;
  mutationExecuted: false;
};

type ExecuteSyncProductErrorResponse = {
  status: "error";
  actionId: "redacted";
  reason: string;
  details: string;
  mutationExecuted: false;
};

// ── Helper: validate bulk intent ─────────────────────────────────────

function hasUnsupportedBulkIntent(request: SyncProductInput): boolean {
  return (
    request.syncAll === true ||
    request.bulk === true ||
    Array.isArray(request.itemId) ||
    Array.isArray(request.itemIds) ||
    Array.isArray(request.productIds) ||
    Array.isArray(request.items)
  );
}

function validateMlcRoleConfig(
  roleConfig: MlAccountRoleConfig,
): import("./utils.js").SyncProductBlockedReason | null {
  if (!trimmedString(roleConfig.sourceSellerId) || !trimmedString(roleConfig.targetSellerId)) {
    return "missing-account-roles";
  }

  if (roleConfig.site !== "MLC") {
    return "unsupported-site";
  }

  return null;
}

// ── Sync-preview helpers ─────────────────────────────────────────────

async function buildSyncProductPreview(input: {
  dependency?: SyncPreviewDependency | undefined;
  sourceSellerId: string;
  itemId: string;
}): Promise<SyncProductPreview> {
  if (!input.dependency) {
    return { status: "unavailable", reason: "missing-preview-dependency" };
  }

  let item: MlItem;
  try {
    const sourceItem = await input.dependency.getSourceItem(input.sourceSellerId, input.itemId);
    item = assertCompleteMlcItem(sourceItem);
  } catch {
    return { status: "unavailable", reason: "source-read-failed" };
  }

  let strategies: unknown;
  try {
    strategies = await input.dependency.getStrategies();
  } catch {
    return { status: "unavailable", reason: "strategy-unavailable" };
  }

  if (!areStrategies(strategies)) {
    return { status: "unavailable", reason: "strategy-unavailable" };
  }

  let preview: ReturnType<typeof previewStrategyChanges>;
  try {
    preview = previewStrategyChanges(item, strategies);
  } catch {
    return { status: "unavailable", reason: "strategy-unavailable" };
  }
  if (preview.status === "unavailable") {
    return preview;
  }

  return { ...preview, evidenceSource: "read-only-item" };
}

function previewExactChanges(preview: SyncProductPreview): ExactChange[] {
  if (preview.status === "unavailable") {
    return [
      { field: "preview.status", from: null, to: preview.status },
      { field: "preview.reason", from: null, to: preview.reason },
    ];
  }

  return [
    { field: "preview.status", from: null, to: preview.status },
    ...preview.fieldChanges.map((change) => ({
      field: `preview.${change.field}`,
      from: change.from,
      to: change.to,
    })),
  ];
}

const APPROVED_PUBLISH_INPUT_SNAPSHOT_FIELD = "publishInput.snapshot.v1";

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function approvedPublishInputSnapshot(newItem: NewItem): string {
  return stableSerialize(newItem);
}

function publishInputExactChange(newItem: NewItem): ExactChange {
  return {
    field: APPROVED_PUBLISH_INPUT_SNAPSHOT_FIELD,
    from: null,
    to: approvedPublishInputSnapshot(newItem),
  };
}

function compareStoredPublishInput(input: {
  entry: ApprovalQueueEntry;
  newItem: NewItem;
}): "matched" | "drifted" {
  const storedSnapshot = input.entry.action.exactChange.find(
    (change) => change.field === APPROVED_PUBLISH_INPUT_SNAPSHOT_FIELD,
  )?.to;

  return storedSnapshot === approvedPublishInputSnapshot(input.newItem) ? "matched" : "drifted";
}

function unavailableSyncProductStatus(): ReadSyncProductStatusUnavailableResponse {
  return {
    status: "unavailable",
    reason: "not-found-or-unsupported",
    noMutationExecuted: true,
  };
}

function unavailableSyncProductApproval(): ApproveSyncProductProposalUnavailableResponse {
  return {
    status: "unavailable",
    reason: "not-found-or-unsupported",
    noMutationExecuted: true,
  };
}

function hasExactChange(
  exactChange: ReadonlyArray<ExactChange>,
  field: string,
  to: ExactChange["to"],
): boolean {
  return exactChange.some((change) => change.field === field && change.to === to);
}

function exactChangesMatch(
  left: ReadonlyArray<ExactChange>,
  right: ReadonlyArray<ExactChange>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const SYNC_PRODUCT_ACTION_ID_PREFIX = "sync-product:";

function isSyncProductActionId(actionId: string, listingId: string): boolean {
  const suffix = actionId.slice(SYNC_PRODUCT_ACTION_ID_PREFIX.length + listingId.length + 1);
  return (
    actionId.startsWith(`${SYNC_PRODUCT_ACTION_ID_PREFIX}${listingId}:`) &&
    parseStrictIsoTimestamp(suffix) !== null
  );
}

function isSupportedSyncProductProposal(
  entry: ApprovalQueueEntry | null,
): entry is ApprovalQueueEntry & {
  action: ApprovalQueueEntry["action"] & { target: { type: "listing"; listingId: string } };
} {
  if (!entry) return false;

  return (
    entry.action.kind === "listing-edit" &&
    entry.action.target.type === "listing" &&
    isSyncProductActionId(entry.action.id, entry.action.target.listingId) &&
    entry.action.riskLevel === "high" &&
    hasExactChange(entry.action.exactChange, "syncIntent", "prepare-only product sync proposal") &&
    hasExactChange(entry.action.exactChange, "mutationExecuted", false)
  );
}

async function findExactSyncProductAction(input: {
  repository: ApprovalQueueRepository;
  actionId: string;
}): Promise<ApprovalQueueEntry | null | "storage-unavailable"> {
  try {
    return await input.repository.findAction(input.actionId);
  } catch {
    return "storage-unavailable";
  }
}

async function findExactApproval(input: {
  repository: ApprovalQueueRepository;
  actionId: string;
}): Promise<ApprovalRecord | null | "storage-unavailable"> {
  try {
    return await input.repository.findApproval(input.actionId);
  } catch {
    return "storage-unavailable";
  }
}

function approvalExpired(entry: ApprovalQueueEntry, now: Date): boolean {
  return entry.action.expiresAt <= now;
}

function approvalBindingMatches(
  entry: ApprovalQueueEntry,
  approval: ApprovalRecord | null,
): boolean {
  return (
    approval !== null &&
    approval.actionId === entry.action.id &&
    approval.sellerId === entry.action.sellerId &&
    approval.riskAccepted === entry.action.riskLevel &&
    approval.executionStatus === "not-executed" &&
    exactChangesMatch(approval.exactChangeAccepted, entry.action.exactChange)
  );
}

function uniqueReadinessReasons(
  reasons: ReadonlyArray<SyncProductReadinessReason | null | undefined>,
): SyncProductReadinessReason[] {
  return [...new Set(reasons.filter((reason): reason is SyncProductReadinessReason => !!reason))];
}

function addReadinessReason(
  reasons: SyncProductReadinessReason[],
  reason: SyncProductReadinessReason | null | undefined,
): void {
  if (reason) {
    reasons.push(reason);
  }
}

function compareStoredPreview(input: {
  entry: ApprovalQueueEntry;
  preview: SyncProductPreview;
}): "matched" | "drifted" | "unavailable" {
  if (input.preview.status === "unavailable") return "unavailable";

  const storedPreview = input.entry.action.exactChange.filter((change) =>
    change.field.startsWith("preview."),
  );
  return exactChangesMatch(storedPreview, previewExactChanges(input.preview))
    ? "matched"
    : "drifted";
}

function validateSellerAccountScope(input: {
  entry: ApprovalQueueEntry;
  roleConfig: MlAccountRoleConfig;
}): SyncProductReadinessReason | null {
  const sourceSellerId = input.entry.action.exactChange.find(
    (change) => change.field === "sourceSellerId",
  )?.to;
  const targetSellerId = input.entry.action.exactChange.find(
    (change) => change.field === "targetSellerId",
  )?.to;

  return sourceSellerId === input.roleConfig.sourceSellerId &&
    targetSellerId === input.roleConfig.targetSellerId &&
    input.entry.action.sellerId === input.roleConfig.targetSellerId
    ? null
    : "seller-scope-mismatch";
}

function validateTargetAvailability(
  entry: ApprovalQueueEntry & {
    action: ApprovalQueueEntry["action"] & { target: { type: "listing"; listingId: string } };
  },
): SyncProductReadinessReason | null {
  return normalizeMlcItemId(entry.action.target.listingId) ? null : "target-account-unavailable";
}

function idempotencyCandidateFor(entry: ApprovalQueueEntry): string | undefined {
  const targetId =
    entry.action.target.type === "listing"
      ? normalizeMlcItemId(entry.action.target.listingId)
      : undefined;
  return targetId ? `sync-product:${targetId}:` : undefined;
}

function rollbackStrategyPresent(entry: ApprovalQueueEntry): boolean {
  return hasExactChange(entry.action.exactChange, "rollbackStrategyPresent", true);
}

function apiCapabilityEvidenceStatus(
  evidence: "present" | "missing" | undefined,
): "present" | "missing" {
  return evidence === "present" ? "present" : "missing";
}

function mapReadinessError(error: unknown): SyncProductReadinessReason {
  const message = error instanceof Error ? error.message : "";
  if (/rate|429/i.test(message)) return "rate-limited";
  if (/reconnect|oauth|authorization|token/i.test(message)) return "reconnect-required";
  if (/storage|sqlite|database|db/i.test(message)) return "storage-unavailable";
  return "upstream-temporary-failure";
}

function buildReadinessResponse(input: {
  reasons: ReadonlyArray<SyncProductReadinessReason>;
  approvalBound: boolean;
  preview: "matched" | "drifted" | "unavailable";
  idempotencyCandidate?: string;
  rollbackStrategyPresent: boolean;
  apiCapabilityEvidence: "missing" | "present";
}): ReadSyncProductExecutionReadinessResponse {
  const reasons = uniqueReadinessReasons(input.reasons);
  const hardBlockReasons: ReadonlySet<SyncProductReadinessReason> = new Set([
    "approval-unavailable",
    "approval-expired",
    "approval-binding-mismatch",
    "proposal-not-sync-product",
    "preview-drift-detected",
    "seller-scope-mismatch",
    "storage-unavailable",
  ]);
  const status: SyncProductReadinessStatus = reasons.some((reason) => hardBlockReasons.has(reason))
    ? "blocked"
    : reasons.length > 0
      ? "degraded"
      : "eligible";

  return {
    status,
    actionId: "redacted",
    reasons,
    evidence: {
      approvalBound: input.approvalBound,
      preview: input.preview,
      ...(input.idempotencyCandidate ? { idempotencyCandidate: input.idempotencyCandidate } : {}),
      rollbackStrategyPresent: input.rollbackStrategyPresent,
      apiCapabilityEvidence: input.apiCapabilityEvidence,
    },
    noMutationExecuted: true,
  };
}

async function readRollbackStrategyEvidence(input: {
  entry: ApprovalQueueEntry;
  providers?: SyncProductReadinessEvidenceProviders;
}): Promise<boolean | SyncProductReadinessReason> {
  if (!input.providers?.readRollbackStrategyPresent) {
    return rollbackStrategyPresent(input.entry);
  }

  try {
    return await input.providers.readRollbackStrategyPresent(input.entry);
  } catch (error) {
    return mapReadinessError(error);
  }
}

async function readApiCapabilityEvidence(input: {
  entry: ApprovalQueueEntry;
  providers?: SyncProductReadinessEvidenceProviders;
}): Promise<"missing" | "present" | SyncProductReadinessReason> {
  if (!input.providers?.readApiCapabilityEvidence) {
    return "missing";
  }

  try {
    return apiCapabilityEvidenceStatus(
      await input.providers.readApiCapabilityEvidence(input.entry),
    );
  } catch (error) {
    return mapReadinessError(error);
  }
}

function readinessActionId(request: ReadSyncProductExecutionReadinessInput): string | undefined {
  return trimmedString(request.actionId);
}

async function readSyncProductExecutionReadiness(input: {
  request: ReadSyncProductExecutionReadinessInput;
  config: McpServerConfig;
}): Promise<ReadSyncProductExecutionReadinessResponse> {
  const actionId = readinessActionId(input.request);
  const unavailable = () =>
    buildReadinessResponse({
      reasons: ["approval-unavailable"],
      approvalBound: false,
      preview: "unavailable",
      rollbackStrategyPresent: false,
      apiCapabilityEvidence: "missing",
    });

  if (!actionId || !input.config.prepareWrite) {
    return unavailable();
  }

  const repository = input.config.prepareWrite.repository;
  const foundAction = await findExactSyncProductAction({ repository, actionId });
  if (foundAction === "storage-unavailable") {
    return buildReadinessResponse({
      reasons: ["storage-unavailable"],
      approvalBound: false,
      preview: "unavailable",
      rollbackStrategyPresent: false,
      apiCapabilityEvidence: "missing",
    });
  }

  if (!isSupportedSyncProductProposal(foundAction)) {
    return buildReadinessResponse({
      reasons: [foundAction ? "proposal-not-sync-product" : "approval-unavailable"],
      approvalBound: false,
      preview: "unavailable",
      rollbackStrategyPresent: false,
      apiCapabilityEvidence: "missing",
    });
  }

  const foundApproval = await findExactApproval({ repository, actionId });
  if (foundApproval === "storage-unavailable") {
    return buildReadinessResponse({
      reasons: ["storage-unavailable"],
      approvalBound: false,
      preview: "unavailable",
      rollbackStrategyPresent: false,
      apiCapabilityEvidence: "missing",
    });
  }

  const now = input.config.prepareWrite.clock.now();
  const approvalBound = approvalBindingMatches(foundAction, foundApproval);
  const reasons: SyncProductReadinessReason[] = [];

  if (foundAction.action.approvalStatus !== "approved" || foundAction.status !== "approved") {
    reasons.push("approval-unavailable");
  }
  if (approvalExpired(foundAction, now)) {
    reasons.push("approval-expired");
  }
  if (!approvalBound) {
    reasons.push(foundApproval ? "approval-binding-mismatch" : "approval-unavailable");
  }

  let roleConfig: MlAccountRoleConfig | undefined;
  try {
    roleConfig = input.config.accountRoles ?? getMlAccountRoleConfig();
  } catch {
    reasons.push("seller-scope-mismatch");
  }

  if (roleConfig) {
    const roleFailure = validateMlcRoleConfig(roleConfig);
    addReadinessReason(
      reasons,
      roleFailure
        ? "seller-scope-mismatch"
        : validateSellerAccountScope({ entry: foundAction, roleConfig }),
    );
  }

  addReadinessReason(reasons, validateTargetAvailability(foundAction));

  const sourceSellerId = foundAction.action.exactChange.find(
    (change) => change.field === "sourceSellerId",
  )?.to;
  let previewState: "matched" | "drifted" | "unavailable" = "unavailable";
  if (typeof sourceSellerId !== "string") {
    reasons.push("source-evidence-incomplete");
  } else {
    const preview = await buildSyncProductPreview({
      dependency: input.config.syncPreview,
      sourceSellerId,
      itemId: foundAction.action.target.listingId,
    });
    previewState = compareStoredPreview({ entry: foundAction, preview });
    if (preview.status === "unavailable") {
      reasons.push(
        preview.reason === "source-read-failed"
          ? "source-read-failed"
          : "source-evidence-incomplete",
      );
    } else if (previewState === "drifted") {
      reasons.push("preview-drift-detected");
    }
  }

  const idempotencyCandidate = idempotencyCandidateFor(foundAction);

  const rollbackEvidence = await readRollbackStrategyEvidence({
    entry: foundAction,
    ...(input.config.readinessEvidence ? { providers: input.config.readinessEvidence } : {}),
  });
  const hasRollbackStrategy = rollbackEvidence === true;
  if (rollbackEvidence !== true) {
    reasons.push(rollbackEvidence === false ? "rollback-strategy-missing" : rollbackEvidence);
  }

  const apiEvidence = await readApiCapabilityEvidence({
    entry: foundAction,
    ...(input.config.readinessEvidence ? { providers: input.config.readinessEvidence } : {}),
  });
  const apiCapabilityEvidence = apiEvidence === "present" ? "present" : "missing";
  if (apiEvidence !== "present") {
    reasons.push(apiEvidence === "missing" ? "api-capability-evidence-missing" : apiEvidence);
  }

  return buildReadinessResponse({
    reasons,
    approvalBound,
    preview: previewState,
    ...(idempotencyCandidate ? { idempotencyCandidate } : {}),
    rollbackStrategyPresent: hasRollbackStrategy,
    apiCapabilityEvidence,
  });
}

const syncProductExecutionReadinessFoundation = {
  inputSchema: mcpReadSyncProductExecutionReadinessInputSchema,
  readinessActionId,
  findExactSyncProductAction,
  findExactApproval,
  isSupportedSyncProductProposal,
  approvalExpired,
  approvalBindingMatches,
  uniqueReadinessReasons,
  compareStoredPreview,
  compareStoredPublishInput,
  validateSellerAccountScope,
  validateTargetAvailability,
  idempotencyCandidateFor,
  rollbackStrategyPresent,
  apiCapabilityEvidenceStatus,
  mapReadinessError,
  buildReadinessResponse,
};

void syncProductExecutionReadinessFoundation;

// ── Status/approval helpers ──────────────────────────────────────────

function summarizeSyncProductPreview(exactChange: ReadonlyArray<ExactChange>): {
  status: "available" | "unavailable";
  summary: string;
} {
  const previewStatus = exactChange.find((change) => change.field === "preview.status")?.to;
  if (previewStatus === "available") {
    const changedFields = exactChange
      .filter((change) => change.field.startsWith("preview.") && change.field !== "preview.status")
      .map((change) => change.field.replace(/^preview\./, ""));

    return {
      status: "available",
      summary:
        changedFields.length > 0
          ? `Preview available for ${changedFields.join(", ")}.`
          : "Preview available.",
    };
  }

  const reason = exactChange.find((change) => change.field === "preview.reason")?.to;
  return {
    status: "unavailable",
    summary:
      typeof reason === "string" ? `Preview unavailable: ${reason}.` : "Preview unavailable.",
  };
}

function buildSyncProductStatusResponse(input: {
  entry: ApprovalQueueEntry & {
    action: ApprovalQueueEntry["action"] & { target: { type: "listing"; listingId: string } };
  };
  now: Date;
  storage: McpServerConfig["approvalStorage"];
}): ReadSyncProductStatusAvailableResponse {
  const effectiveStatus =
    input.entry.action.expiresAt <= input.now ? "expired" : input.entry.action.approvalStatus;

  return {
    status: "available",
    actionId: "redacted",
    effectiveStatus,
    expiresAt: input.entry.action.expiresAt.toISOString(),
    risk: "high",
    target: input.entry.action.target,
    rationale: input.entry.action.rationale,
    preview: summarizeSyncProductPreview(input.entry.action.exactChange),
    metadata: {
      requiresApproval: true,
      noMutationExecuted: true,
      auditReplay: "not-available",
      ...approvalStorageMetadata(input.storage),
    },
  };
}

async function approveSyncProductProposal(input: {
  request: ApproveSyncProductProposalInput;
  prepareWrite: NonNullable<McpServerConfig["prepareWrite"]> | undefined;
}): Promise<ApproveSyncProductProposalResponse> {
  const actionId = trimmedString(input.request.actionId);
  if (!actionId || !input.prepareWrite) {
    return unavailableSyncProductApproval();
  }

  let entry: ApprovalQueueEntry | null;
  try {
    entry = await input.prepareWrite.repository.findAction(actionId);
  } catch {
    return unavailableSyncProductApproval();
  }

  const now = input.prepareWrite.clock.now();
  if (
    !isSupportedSyncProductProposal(entry) ||
    entry.action.approvalStatus !== "pending" ||
    entry.status !== "pending" ||
    entry.action.expiresAt <= now
  ) {
    return unavailableSyncProductApproval();
  }

  const approvedEntry: ApprovalQueueEntry = {
    ...entry,
    status: "approved",
    action: { ...entry.action, approvalStatus: "approved" },
  };
  const approval: ApprovalRecord = {
    id: `approval:${actionId}:${now.toISOString()}`,
    actionId,
    sellerId: entry.action.sellerId,
    approvedBy: "seller",
    approvedAt: now,
    exactChangeAccepted: entry.action.exactChange,
    riskAccepted: entry.action.riskLevel,
    executionStatus: "not-executed",
  };

  try {
    await input.prepareWrite.repository.save(approvedEntry);
    await input.prepareWrite.repository.saveApproval(approval);
  } catch {
    return unavailableSyncProductApproval();
  }

  return { status: "approved", actionId: "redacted", noMutationExecuted: true };
}

// ── Main registration function ───────────────────────────────────────

export function registerSyncTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;

  // ── sync_product ──────────────────────────────────────────────────
  server.registerTool(
    "sync_product",
    {
      description: "Prepara sync Plasticov a Maustian con safety gates y estrategias",
      inputSchema: mcpSyncProductInputSchema,
    },
    async (request) => {
      const syncRequest = request as SyncProductInput;
      const { msl_api_key } = syncRequest;
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      if (!config.prepareWrite) {
        return blockedResult(
          "prepare-write-unavailable",
          "Product sync proposal preparation is unavailable in this MCP runtime.",
        );
      }

      const sourceSellerId = trimmedString(syncRequest.sourceSellerId);
      const targetSellerId = trimmedString(syncRequest.targetSellerId);
      const itemId = trimmedString(syncRequest.itemId);
      const rationale = trimmedString(syncRequest.rationale);

      if (hasUnsupportedBulkIntent(syncRequest)) {
        return blockedResult(
          "unsupported-sync-intent",
          "Product sync preparation supports one MLC itemId only; bulk or multi-product sync is out of scope.",
        );
      }

      if (!itemId) {
        return blockedResult(
          "missing-target",
          "Product sync preparation requires one target itemId.",
        );
      }

      const safeItemId = normalizeMlcItemId(itemId);
      if (!safeItemId) {
        return blockedResult(
          "invalid-target",
          "Product sync preparation requires one valid MLC itemId.",
        );
      }

      if (!rationale) {
        return blockedResult("missing-rationale", "Product sync preparation requires a rationale.");
      }

      if (!sourceSellerId || !targetSellerId) {
        return blockedResult(
          "unsafe-direction",
          "Product sync preparation requires configured sourceSellerId and targetSellerId for the Plasticov to Maustian MLC sync boundary.",
        );
      }

      if (syncRequest.requiresApproval !== true) {
        return blockedResult(
          "approval-required",
          "Product sync preparation requires requiresApproval: true.",
        );
      }

      if (syncRequest.risk !== "high") {
        return blockedResult("invalid-risk", 'Product sync preparation requires risk: "high".');
      }

      const parsedExpiresAt = parseStrictIsoTimestamp(syncRequest.expiresAt);
      if (!parsedExpiresAt) {
        return blockedResult(
          "invalid-expires-at",
          "Product sync preparation requires a strict ISO 8601 UTC expiresAt timestamp.",
        );
      }

      if (parsedExpiresAt <= config.prepareWrite.clock.now()) {
        return blockedResult(
          "expired-proposal",
          "Product sync proposal expiry must be in the future.",
        );
      }

      let roleConfig: MlAccountRoleConfig;
      try {
        roleConfig = config.accountRoles ?? getMlAccountRoleConfig();
      } catch {
        return blockedResult(
          "missing-account-roles",
          "MercadoLibre account roles are not configured for the Plasticov to Maustian MLC sync boundary.",
        );
      }

      const roleConfigFailure = validateMlcRoleConfig(roleConfig);
      if (roleConfigFailure) {
        return blockedResult(
          roleConfigFailure,
          "Product sync preparation requires configured Plasticov and Maustian seller accounts on site MLC.",
        );
      }

      try {
        assertPlasticovToMaustianDirection(sourceSellerId, targetSellerId, {
          MERCADOLIBRE_SOURCE_SELLER_ID: roleConfig.sourceSellerId,
          MERCADOLIBRE_TARGET_SELLER_ID: roleConfig.targetSellerId,
        });
      } catch {
        return blockedResult(
          "unsafe-direction",
          "Product sync preparation is limited to the configured Plasticov to Maustian sync boundary on MLC.",
        );
      }

      const preview = await buildSyncProductPreview({
        dependency: config.syncPreview,
        sourceSellerId,
        itemId: safeItemId,
      });
      const publishInputChanges: ExactChange[] = [];
      if (preview.status === "available" && config.syncPreview) {
        try {
          const sourceItem = assertCompleteMlcItem(
            await config.syncPreview.getSourceItem(sourceSellerId, safeItemId),
          );
          const strategies = await config.syncPreview.getStrategies();
          if (areStrategies(strategies)) {
            const applied = applyStrategies(sourceItem, strategies);
            if (applied.applied) {
              publishInputChanges.push(
                publishInputExactChange(
                  buildNewItemFromMlItem(sourceItem, {
                    price: applied.item.price,
                    available_quantity: applied.item.available_quantity,
                  }),
                ),
              );
            }
          }
        } catch {
          // The preview remains the approval-facing evidence; without a publish
          // input snapshot, execution will fail closed on drift comparison.
        }
      }
      const prepareTool = createPreparedActionTool(config.prepareWrite);
      let response: Awaited<ReturnType<typeof prepareTool.execute>>;
      try {
        response = await prepareTool.execute({
          id: `sync-product:${safeItemId}:${config.prepareWrite.clock.now().toISOString()}`,
          sellerId: targetSellerId,
          kind: "listing-edit",
          target: { type: "listing", listingId: safeItemId },
          exactChange: [
            { field: "sourceSellerId", from: null, to: sourceSellerId },
            { field: "targetSellerId", from: null, to: targetSellerId },
            { field: "syncIntent", from: null, to: "prepare-only product sync proposal" },
            { field: "mutationExecuted", from: null, to: false },
            ...previewExactChanges(preview),
            ...publishInputChanges,
          ],
          rationale,
          expiresAt: parsedExpiresAt,
        });
      } catch {
        return blockedResult(
          "prepare-write-failed",
          "Product sync proposal could not be prepared because approval storage is unavailable.",
        );
      }

      return jsonResult({
        ...response,
        metadata: {
          ...response.metadata,
          sourceSellerId,
          targetSellerId,
          site: roleConfig.site,
          risk: "high",
          expiresAt: parsedExpiresAt.toISOString(),
          ...approvalStorageMetadata(config.approvalStorage),
          auditReplay: "not-available",
          noMutationExecuted: true,
          operation: "sync_product",
          preview,
        },
      });
    },
  );

  // ── read_sync_product_status ──────────────────────────────────────
  server.registerTool(
    "read_sync_product_status",
    {
      description:
        "Reads sanitized status for one stored sync_product proposal by exact action ID.",
      inputSchema: mcpReadSyncProductStatusInputSchema,
    },
    async (request) => {
      const statusRequest = request as ReadSyncProductStatusInput;
      if (!validateApiKey(statusRequest.msl_api_key)) {
        return unauthorizedResult();
      }

      const actionId = trimmedString(statusRequest.actionId);
      if (!actionId || !config.prepareWrite) {
        return jsonResult(unavailableSyncProductStatus() satisfies ReadSyncProductStatusResponse);
      }

      let entry: ApprovalQueueEntry | null;
      try {
        entry = await config.prepareWrite.repository.findAction(actionId);
      } catch {
        return jsonResult(unavailableSyncProductStatus() satisfies ReadSyncProductStatusResponse);
      }

      if (!isSupportedSyncProductProposal(entry)) {
        return jsonResult(unavailableSyncProductStatus() satisfies ReadSyncProductStatusResponse);
      }

      return jsonResult(
        buildSyncProductStatusResponse({
          entry,
          now: config.prepareWrite.clock.now(),
          storage: config.approvalStorage,
        }) satisfies ReadSyncProductStatusResponse,
      );
    },
  );

  // ── read_sync_product_execution_readiness ─────────────────────────
  server.registerTool(
    "read_sync_product_execution_readiness",
    {
      description:
        "Reads non-mutating execution readiness for one exact approved sync_product proposal.",
      inputSchema: mcpReadSyncProductExecutionReadinessInputSchema,
    },
    async (request) => {
      const readinessRequest = request as ReadSyncProductExecutionReadinessInput;
      if (!validateApiKey(readinessRequest.msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(
        (await readSyncProductExecutionReadiness({
          request: readinessRequest,
          config,
        })) satisfies ReadSyncProductExecutionReadinessResponse,
      );
    },
  );

  // ── approve_sync_product_proposal ─────────────────────────────────
  server.registerTool(
    "approve_sync_product_proposal",
    {
      description:
        "Records seller approval for one exact stored pending sync_product proposal without executing mutations.",
      inputSchema: mcpApproveSyncProductProposalInputSchema,
    },
    async (request) => {
      const approvalRequest = request as ApproveSyncProductProposalInput;
      if (!validateApiKey(approvalRequest.msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(
        (await approveSyncProductProposal({
          request: approvalRequest,
          prepareWrite: config.prepareWrite,
        })) satisfies ApproveSyncProductProposalResponse,
      );
    },
  );

  // ── execute_sync_product ───────────────────────────────────────────
  if (config.executeWrite) {
    server.registerTool(
      "execute_sync_product",
      {
        description:
          "Executes an approved sync_product proposal by publishing/updating the target listing on MercadoLibre.",
        inputSchema: mcpExecuteSyncProductInputSchema,
      },
      async (request) => {
        const execRequest = request as ExecuteSyncProductInput;
        if (!validateApiKey(execRequest.msl_api_key)) {
          return unauthorizedResult();
        }

        const actionId = trimmedString(execRequest.actionId);
        if (!actionId || !config.prepareWrite) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "invalid-request",
            details: "Missing actionId or prepare-write runtime.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        if (!config.executeWrite) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "write-unavailable",
            details: "Execute write capability is not available in this MCP runtime.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        // ── Look up proposal ──────────────────────────────────────────
        let entry: ApprovalQueueEntry | null;
        try {
          entry = await config.prepareWrite.repository.findAction(actionId);
        } catch {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "storage-unavailable",
            details: "Approval storage is unavailable.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        if (!isSupportedSyncProductProposal(entry)) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "proposal-not-found",
            details: "Proposal not found or not a supported sync_product proposal.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        // ── Validate approval state ────────────────────────────────────
        const now = config.prepareWrite.clock.now();
        if (entry.action.approvalStatus !== "approved" || entry.status !== "approved") {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "not-approved",
            details: "Proposal has not been approved.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        if (approvalExpired(entry, now)) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "proposal-expired",
            details: "Proposal has expired.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        let approval: ApprovalRecord | null;
        try {
          approval = await config.prepareWrite.repository.findApproval(actionId);
        } catch {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "storage-unavailable",
            details: "Approval storage is unavailable.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        if (approval?.executionStatus === "executed") {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "already-executed",
            details: "This proposal has already been executed.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        if (!approvalBindingMatches(entry, approval)) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "approval-binding-mismatch",
            details: "Approval binding does not match the current proposal state.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        const boundApproval = approval;
        if (boundApproval === null) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "approval-binding-mismatch",
            details: "Approval binding does not match the current proposal state.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        // ── Get source item ────────────────────────────────────────────
        const sourceSellerId = entry.action.exactChange.find(
          (change) => change.field === "sourceSellerId",
        )?.to;
        const targetSellerId = entry.action.exactChange.find(
          (change) => change.field === "targetSellerId",
        )?.to;

        if (typeof sourceSellerId !== "string" || typeof targetSellerId !== "string") {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "invalid-proposal",
            details: "Proposal is missing source or target seller IDs.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        let executionRoleConfig: MlAccountRoleConfig;
        try {
          executionRoleConfig = config.accountRoles ?? getMlAccountRoleConfig();
        } catch {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "seller-scope-mismatch",
            details: "MercadoLibre account roles are not configured for this execution boundary.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        const executionRoleFailure = validateMlcRoleConfig(executionRoleConfig);
        if (
          executionRoleFailure ||
          validateSellerAccountScope({ entry, roleConfig: executionRoleConfig }) !== null
        ) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "seller-scope-mismatch",
            details:
              "Execution seller scope does not match the configured Plasticov to Maustian MLC boundary.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        if (!config.mlcClient) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "read-unavailable",
            details: "MercadoLibre read client is not available.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        let sourceItem: MlItem;
        try {
          sourceItem = await config.mlcClient.getItem(
            sourceSellerId,
            entry.action.target.listingId,
          );
        } catch (err) {
          return jsonResult({
            status: "error",
            actionId: "redacted",
            reason: "source-read-failed",
            details: `Could not read source item: ${err instanceof Error ? err.message : String(err)}`,
            mutationExecuted: false,
          } satisfies ExecuteSyncProductErrorResponse);
        }

        // ── Get strategies ─────────────────────────────────────────────
        let strategies: Strategy[];
        if (config.syncPreview) {
          try {
            strategies = await config.syncPreview.getStrategies();
            if (!areStrategies(strategies)) {
              strategies = [];
            }
          } catch {
            strategies = [];
          }
        } else {
          strategies = [];
        }

        // ── Apply strategies ───────────────────────────────────────────
        const applied = applyStrategies(sourceItem, strategies);
        if (!applied.applied) {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "strategy-blocked",
            details: `Strategy application blocked the item: ${applied.reason}`,
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        const livePreview = previewStrategyChanges(sourceItem, strategies);
        const executablePreview: SyncProductPreview =
          livePreview.status === "available"
            ? { ...livePreview, evidenceSource: "read-only-item" }
            : livePreview;
        const previewState = compareStoredPreview({ entry, preview: executablePreview });
        if (executablePreview.status === "unavailable" || previewState !== "matched") {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "preview-drift-detected",
            details: "Live source data no longer matches the seller-approved sync_product preview.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        const newItem = buildNewItemFromMlItem(sourceItem, {
          price: applied.item.price,
          available_quantity: applied.item.available_quantity,
        });

        if (compareStoredPublishInput({ entry, newItem }) !== "matched") {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "preview-drift-detected",
            details:
              "Live publish input no longer matches the seller-approved sync_product snapshot.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        const executingApproval: ApprovalRecord = {
          ...boundApproval,
          executionStatus: "executed",
        };

        try {
          await config.prepareWrite.repository.saveApproval(executingApproval);
        } catch {
          return jsonResult({
            status: "blocked",
            actionId: "redacted",
            reason: "storage-unavailable",
            details: "Execution status could not be reserved before publishing.",
            mutationExecuted: false,
          } satisfies ExecuteSyncProductBlockedResponse);
        }

        // ── Execute write ──────────────────────────────────────────────
        let writeSnapshot: MlWriteSnapshot;
        try {
          writeSnapshot = await config.executeWrite.publishItem(targetSellerId, newItem);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          let reason = "publish-failed";
          let details = message;

          if (/401|403/i.test(message)) {
            reason = "token-error";
            details = "OAuth token expired or revoked. Reconnect the seller account.";
          } else if (/429/i.test(message)) {
            reason = "rate-limited";
            details = "MercadoLibre API rate limit reached. Retry after the rate window resets.";
          } else if (/400/i.test(message)) {
            reason = "validation-error";
            details = `MercadoLibre rejected the item: ${message}`;
          }

          return jsonResult({
            status: "error",
            actionId: "redacted",
            reason,
            details,
            mutationExecuted: false,
          } satisfies ExecuteSyncProductErrorResponse);
        }

        const strategiesApplied = strategies.length;

        return jsonResult({
          status: "executed",
          actionId: "redacted",
          itemId: writeSnapshot.id,
          permalink: writeSnapshot.permalink,
          sourcePrice: sourceItem.price,
          targetPrice: newItem.price,
          strategiesApplied,
          mutationExecuted: true,
        } satisfies ExecuteSyncProductResultResponse);
      },
    );
  }
}
