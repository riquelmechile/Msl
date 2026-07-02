import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createMlcReadTools,
  createPreparedActionTool,
  type ApprovalQueueEntry,
  PREPARED_WRITE_KINDS,
  type ApprovalQueueRepository,
  type Clock,
  type MlcCategoryReadTools,
  type MlcReadTools,
  type PrepareWriteInput,
} from "@msl/tools";
import {
  ACTION_TARGET_FIELD_BY_TYPE,
  type ApprovalRecord,
  type ExactChange,
  type PreparedAction,
  type RiskLevel,
} from "@msl/domain";
import {
  assertCompleteMlcItem,
  assertPlasticovToMaustianDirection,
  getMlAccountRoleConfig,
  normalizeImageOrchestration,
  normalizeMlcItemId,
  previewStrategyChanges,
  MLC_PRODUCT_ADS_MAX_LIMIT,
  type MlcApiClient,
  type MlcImageOrchestrationSummary,
  type MlItem,
  type MlAccountRoleConfig,
  type Strategy,
} from "@msl/mercadolibre";
import { z } from "zod";
import { createMcpRuntimeDependencies } from "./runtimeDependencies.js";
import { areStrategies } from "./strategyValidation.js";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type SyncProductPreview =
  | { status: "available"; fieldChanges: ExactChange[]; evidenceSource: "read-only-item" }
  | {
      status: "unavailable";
      reason: "missing-preview-dependency" | "source-read-failed" | "strategy-unavailable";
    };

export type SyncPreviewDependency = {
  getSourceItem(sellerId: string, itemId: string): Promise<unknown>;
  getStrategies(): Promise<Strategy[]>;
};

export type SyncProductReadinessEvidenceProviders = {
  readRollbackStrategyPresent?(entry: ApprovalQueueEntry): boolean | Promise<boolean>;
  readApiCapabilityEvidence?(
    entry: ApprovalQueueEntry,
  ): "missing" | "present" | Promise<"missing" | "present">;
};

function jsonResult(value: unknown, isError = false): McpToolResult {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

function unauthorizedResult(): McpToolResult {
  return blockedResult(
    "unauthorized",
    "Unauthorized MCP request. Provide a valid MSL MCP API key.",
  );
}

type SyncProductBlockedReason =
  | "unauthorized"
  | "missing-account-roles"
  | "unsafe-direction"
  | "missing-target"
  | "invalid-target"
  | "missing-rationale"
  | "missing-evidence"
  | "credential-like-payload"
  | "invalid-expires-at"
  | "expired-proposal"
  | "approval-required"
  | "invalid-risk"
  | "unsupported-sync-intent"
  | "unsupported-site"
  | "unsupported-target"
  | "reserved-action-id"
  | "prepare-write-unavailable"
  | "prepare-write-failed";

function blockedResult(reason: SyncProductBlockedReason, message: string): McpToolResult {
  return jsonResult({ status: "blocked", reason, message }, true);
}

const mcpPrepareWriteTargetSchema = z.union(
  Object.entries(ACTION_TARGET_FIELD_BY_TYPE).map(([type, idField]) =>
    z.object({ type: z.literal(type), [idField]: z.string() }),
  ) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
);

const mcpExactChangeValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const mcpPrepareWriteInputSchema = {
  id: z.string(),
  sellerId: z.string(),
  kind: z.enum(PREPARED_WRITE_KINDS),
  target: mcpPrepareWriteTargetSchema,
  exactChange: z.array(
    z.object({
      field: z.string(),
      from: mcpExactChangeValueSchema,
      to: mcpExactChangeValueSchema,
    }),
  ),
  rationale: z.string(),
  expiresAt: z.string(),
  msl_api_key: z.string().optional(),
};

function isProductAdsPrepareWriteTarget(target: PrepareWriteInput["target"]): boolean {
  return target.type === "product-ads-campaign" || target.type === "product-ads-ad";
}

const mcpSyncProductInputSchema = {
  sourceSellerId: z.unknown().optional(),
  targetSellerId: z.unknown().optional(),
  itemId: z.unknown().optional(),
  itemIds: z.unknown().optional(),
  productIds: z.unknown().optional(),
  items: z.unknown().optional(),
  syncAll: z.unknown().optional(),
  bulk: z.unknown().optional(),
  rationale: z.unknown().optional(),
  expiresAt: z.unknown().optional(),
  requiresApproval: z.unknown().optional(),
  risk: z.unknown().optional(),
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

const mcpReadProductAdsInsightsInputSchema = {
  sellerId: z.string(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().positive().max(MLC_PRODUCT_ADS_MAX_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional(),
  itemId: z.string().optional(),
  campaignId: z.string().optional(),
  status: z
    .enum(["active", "paused", "hold", "idle", "delegated", "revoked", "recommended"])
    .optional(),
  msl_api_key: z.string().optional(),
};

const PRODUCT_ADS_ACTION_TYPES = [
  "adjust-campaign-budget",
  "pause-campaign",
  "resume-campaign",
  "pause-ad",
  "resume-ad",
  "review-campaign-structure",
] as const;

const mcpPrepareProductAdsActionInputSchema = {
  sellerId: z.string(),
  proposalType: z.enum(PRODUCT_ADS_ACTION_TYPES),
  campaignId: z.string().optional(),
  itemId: z.string().optional(),
  adId: z.string().optional(),
  currentStatus: z.string().optional(),
  proposedValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  metricsSnapshotSummary: z.string(),
  rationale: z.string(),
  sourceTool: z.literal("read_product_ads_insights"),
  observedAt: z.string(),
  expiresAt: z.string(),
  msl_api_key: z.string().optional(),
};

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

type ProductAdsActionType = (typeof PRODUCT_ADS_ACTION_TYPES)[number];

type PrepareProductAdsActionInput = {
  sellerId?: unknown;
  proposalType?: unknown;
  campaignId?: unknown;
  itemId?: unknown;
  adId?: unknown;
  currentStatus?: unknown;
  proposedValue?: unknown;
  metricsSnapshotSummary?: unknown;
  rationale?: unknown;
  sourceTool?: unknown;
  observedAt?: unknown;
  expiresAt?: unknown;
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

type PrepareProductAdsActionResponse = {
  data: ApprovalQueueEntry;
  metadata: {
    source: "seller-input";
    confidence: "medium";
    requiresApproval: true;
    noMutationExecuted: true;
    operation: "prepare_product_ads_action";
    risk: RiskLevel;
    expiresAt: string;
    approvalPersistence: "in-memory-only" | "sqlite" | "sqlite-unavailable";
    persistentApprovalStorage: boolean;
    approvalStorageDegraded?: true;
  };
};

type ReadSyncProductStatusResponse =
  | ReadSyncProductStatusAvailableResponse
  | ReadSyncProductStatusUnavailableResponse;

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
  | ApproveSyncProductProposalApprovedResponse
  | ApproveSyncProductProposalUnavailableResponse;

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

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

function validateMlcRoleConfig(roleConfig: MlAccountRoleConfig): SyncProductBlockedReason | null {
  if (!trimmedString(roleConfig.sourceSellerId) || !trimmedString(roleConfig.targetSellerId)) {
    return "missing-account-roles";
  }

  if (roleConfig.site !== "MLC") {
    return "unsupported-site";
  }

  return null;
}

/**
 * Validates the MCP API key against the {@link MSL_MCP_API_KEY}
 * environment variable. Fails closed unless explicit local/demo mode is enabled.
 */
function validateApiKey(apiKey: string | undefined): boolean {
  const expected = process.env.MSL_MCP_API_KEY;
  if (!expected) {
    if (process.env.MSL_ALLOW_UNAUTHENTICATED_LOCAL === "true" || process.env.NODE_ENV === "test") {
      return true;
    }
    return false;
  }
  return apiKey === expected;
}

function approvalStorageMetadata(storage: McpServerConfig["approvalStorage"]): {
  approvalPersistence: "in-memory-only" | "sqlite" | "sqlite-unavailable";
  persistentApprovalStorage: boolean;
  approvalStorageDegraded?: true;
} {
  if (storage === "sqlite") {
    return { approvalPersistence: "sqlite", persistentApprovalStorage: true };
  }

  if (storage === "sqlite-unavailable") {
    return {
      approvalPersistence: "sqlite-unavailable",
      persistentApprovalStorage: false,
      approvalStorageDegraded: true,
    };
  }

  return { approvalPersistence: "in-memory-only", persistentApprovalStorage: false };
}

const CREDENTIAL_LIKE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth|client[_-]?secret|secret|password|passwd|credential|db[_-]?path|database[_-]?(?:path|url)|sqlite)/i;
const CREDENTIAL_LIKE_VALUE_PATTERNS = [
  /^(?:api[_-]?key|msl[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|password|passwd|credential|db[_-]?path|database[_-]?(?:path|url)|sqlite)$/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|client[_-]?secret|password|credential|db\s*path|db[_-]?path|database\s*path|database[_-]?path)\s*[:=]/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\b(?:sk|pk|xox[baprs]|gh[pousr])_[A-Za-z0-9_=-]{12,}\b/i,
  /\b[A-Za-z0-9._%+-]+\.(?:sqlite|sqlite3|db)\b/i,
  /(?:^|\s)(?:sqlite|file):\/\//i,
  /(?:^|\s)(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)\.(?:sqlite|sqlite3|db)\b/i,
];

function containsCredentialLikeContent(value: unknown): boolean {
  if (typeof value === "string") {
    return CREDENTIAL_LIKE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsCredentialLikeContent(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        CREDENTIAL_LIKE_KEY_PATTERN.test(key) || containsCredentialLikeContent(child),
    );
  }

  return false;
}

function hasUnsafePrepareWritePayload(
  input: Pick<PrepareWriteInput, "target" | "exactChange" | "rationale">,
): boolean {
  return (
    containsCredentialLikeContent(input.target) ||
    containsCredentialLikeContent(input.exactChange) ||
    containsCredentialLikeContent(input.rationale)
  );
}

const SAFE_AUTH_FIELD_NAMES = new Set(["msl_api_key"]);
const UNSAFE_RAW_MUTATION_FIELD_NAMES = new Set([
  "rawMutationPayload",
  "rawPayload",
  "rawRequest",
  "httpRequest",
  "apiRequest",
  "mutationPayload",
]);
const UNSAFE_RAW_MUTATION_KEY_PATTERN =
  /(?:^|[_-])(?:endpoint|method|url|body|headers|payload|mutation)(?:$|[_-])/i;

const RAW_MUTATION_TEXT_PATTERNS = [
  /\b(?:PATCH|POST|PUT|DELETE)\s+\/advertising\b/i,
  /\b(?:PATCH|POST|PUT|DELETE)\s+https?:\/\/[^\s]+\/advertising\b/i,
  /\bbody\s*[:=]\s*\{[^}]*\}/i,
  /\b(?:curl|fetch)\s*\([^)]*\/advertising/i,
];
const RAW_MUTATION_METHOD_PATTERN = /\b(?:PATCH|POST|PUT|DELETE)\b/i;
const RAW_MUTATION_LABELED_METHOD_PATTERN = /\bmethod\s*[:=]\s*(?:PATCH|POST|PUT|DELETE)\b/i;
const RAW_MUTATION_ADVERTISING_ENDPOINT_PATTERN =
  /(?:^|[\s"'`([{;])(?:https?:\/\/[^\s"'`)>;]+)?\/advertising\b/i;
const RAW_MUTATION_LABELED_ADVERTISING_ENDPOINT_PATTERN =
  /\b(?:endpoint|url)\s*[:=]\s*(?:https?:\/\/[^\s"'`)>;]+)?\/advertising\b/i;
const RAW_MUTATION_CONTRACT_FRAGMENT_PATTERN = /\b(?:endpoint|url|method|headers?|body)\s*[:=]/i;

function containsRawMutationContractText(value: string): boolean {
  if (RAW_MUTATION_TEXT_PATTERNS.some((pattern) => pattern.test(value))) return true;

  const hasAdvertisingEndpoint = RAW_MUTATION_ADVERTISING_ENDPOINT_PATTERN.test(value);
  const hasMutatingMethod = RAW_MUTATION_METHOD_PATTERN.test(value);

  return (
    RAW_MUTATION_LABELED_ADVERTISING_ENDPOINT_PATTERN.test(value) ||
    RAW_MUTATION_LABELED_METHOD_PATTERN.test(value) ||
    (hasAdvertisingEndpoint && hasMutatingMethod) ||
    (RAW_MUTATION_CONTRACT_FRAGMENT_PATTERN.test(value) &&
      (hasAdvertisingEndpoint || hasMutatingMethod))
  );
}

function hasUnsafeProductAdsBusinessPayload(value: unknown): boolean {
  if (typeof value === "string") {
    return containsCredentialLikeContent(value) || containsRawMutationContractText(value);
  }

  if (Array.isArray(value)) return value.some((item) => hasUnsafeProductAdsBusinessPayload(item));

  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        !SAFE_AUTH_FIELD_NAMES.has(key) &&
        (CREDENTIAL_LIKE_KEY_PATTERN.test(key) ||
          UNSAFE_RAW_MUTATION_FIELD_NAMES.has(key) ||
          UNSAFE_RAW_MUTATION_KEY_PATTERN.test(key) ||
          hasUnsafeProductAdsBusinessPayload(child)),
    );
  }

  return false;
}

function productAdsRisk(proposalType: ProductAdsActionType): RiskLevel {
  return proposalType === "review-campaign-structure" ? "medium" : "high";
}

function isProductAdsActionType(value: unknown): value is ProductAdsActionType {
  return (
    typeof value === "string" && PRODUCT_ADS_ACTION_TYPES.includes(value as ProductAdsActionType)
  );
}

function requiresCampaignEvidence(proposalType: ProductAdsActionType): boolean {
  return proposalType !== "pause-ad" && proposalType !== "resume-ad";
}

function requiresAdEvidence(proposalType: ProductAdsActionType): boolean {
  return proposalType === "pause-ad" || proposalType === "resume-ad";
}

function productAdsTarget(input: {
  proposalType: ProductAdsActionType;
  campaignId?: string | undefined;
  itemId?: string | undefined;
  adId?: string | undefined;
}): PreparedAction["target"] {
  if (requiresAdEvidence(input.proposalType)) {
    return {
      type: "product-ads-ad",
      ...(input.adId ? { adId: input.adId } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
    };
  }
  return { type: "product-ads-campaign", campaignId: input.campaignId ?? "unknown-campaign" };
}

function productAdsExactChanges(input: {
  proposalType: ProductAdsActionType;
  sellerId: string;
  campaignId?: string | undefined;
  itemId?: string | undefined;
  adId?: string | undefined;
  currentStatus?: string | undefined;
  proposedValue?: string | number | boolean | null | undefined;
  metricsSnapshotSummary: string;
  sourceTool: "read_product_ads_insights";
  observedAt: string;
}): ExactChange[] {
  return [
    { field: "sellerId", from: null, to: input.sellerId },
    { field: "proposalType", from: null, to: input.proposalType },
    { field: "campaignId", from: null, to: input.campaignId ?? null },
    { field: "itemId", from: null, to: input.itemId ?? null },
    { field: "adId", from: null, to: input.adId ?? null },
    { field: "currentStatus", from: null, to: input.currentStatus ?? null },
    { field: "proposedValue", from: null, to: input.proposedValue ?? null },
    { field: "metricsSnapshotSummary", from: null, to: input.metricsSnapshotSummary },
    { field: "evidence.sourceTool", from: null, to: input.sourceTool },
    { field: "evidence.observedAt", from: null, to: input.observedAt },
    { field: "mutationExecuted", from: null, to: false },
  ];
}

async function prepareProductAdsAction(input: {
  request: PrepareProductAdsActionInput;
  config: McpServerConfig;
}): Promise<PrepareProductAdsActionResponse | McpToolResult> {
  if (!input.config.prepareWrite) {
    return blockedResult(
      "prepare-write-unavailable",
      "Product Ads proposal preparation is unavailable in this MCP runtime.",
    );
  }

  const businessPayload = { ...input.request };
  delete businessPayload.msl_api_key;

  if (hasUnsafeProductAdsBusinessPayload(businessPayload)) {
    return blockedResult(
      "credential-like-payload",
      "Product Ads proposals must include sanitized evidence only, not credentials or raw API mutation payloads.",
    );
  }

  const sellerId = trimmedString(input.request.sellerId);
  const campaignId = trimmedString(input.request.campaignId);
  const itemId = trimmedString(input.request.itemId);
  const adId = trimmedString(input.request.adId);
  const currentStatus = trimmedString(input.request.currentStatus);
  const metricsSnapshotSummary = trimmedString(input.request.metricsSnapshotSummary);
  const rationale = trimmedString(input.request.rationale);
  const sourceTool = trimmedString(input.request.sourceTool);
  const observedAt = trimmedString(input.request.observedAt);
  const proposalType = input.request.proposalType;

  if (!sellerId || !isProductAdsActionType(proposalType)) {
    return blockedResult(
      "missing-target",
      "Product Ads preparation requires sellerId and a supported proposalType.",
    );
  }
  if (
    (requiresCampaignEvidence(proposalType) && !campaignId) ||
    (requiresAdEvidence(proposalType) && !itemId && !adId) ||
    !metricsSnapshotSummary ||
    !rationale
  ) {
    return blockedResult(
      "missing-target",
      "Product Ads preparation requires seller scope, campaign/ad evidence, metrics snapshot summary, and rationale.",
    );
  }

  const parsedObservedAt = parseStrictIsoTimestamp(observedAt);
  if (sourceTool !== "read_product_ads_insights" || !parsedObservedAt) {
    return blockedResult(
      "missing-evidence",
      "Product Ads preparation requires sourceTool read_product_ads_insights and a strict ISO 8601 UTC observedAt timestamp.",
    );
  }

  const parsedExpiresAt = parseStrictIsoTimestamp(input.request.expiresAt);
  if (!parsedExpiresAt) {
    return blockedResult(
      "invalid-expires-at",
      "Product Ads preparation requires a strict ISO 8601 UTC expiresAt timestamp.",
    );
  }
  if (parsedExpiresAt <= input.config.prepareWrite.clock.now()) {
    return blockedResult("expired-proposal", "Product Ads proposal expiry must be in the future.");
  }

  const risk = productAdsRisk(proposalType);
  const action: PreparedAction = {
    id: `product-ads:${proposalType}:${sellerId}:${input.config.prepareWrite.clock.now().toISOString()}`,
    sellerId,
    kind: "product-ads-action",
    target: productAdsTarget({ proposalType, campaignId, itemId, adId }),
    exactChange: productAdsExactChanges({
      proposalType,
      sellerId,
      campaignId,
      itemId,
      adId,
      currentStatus,
      proposedValue: input.request.proposedValue as string | number | boolean | null | undefined,
      metricsSnapshotSummary,
      sourceTool,
      observedAt: parsedObservedAt.toISOString(),
    }),
    rationale,
    riskLevel: risk,
    expiresAt: parsedExpiresAt,
    approvalStatus: "pending",
  };
  const entry = {
    action,
    requestedAt: input.config.prepareWrite.clock.now(),
    highlightedRisk: risk,
    status: "pending" as const,
  };

  try {
    await input.config.prepareWrite.repository.save(entry);
  } catch {
    return blockedResult(
      "prepare-write-failed",
      "Product Ads proposal could not be saved because approval storage is unavailable.",
    );
  }

  return {
    data: entry,
    metadata: {
      source: "seller-input",
      confidence: "medium",
      requiresApproval: true,
      noMutationExecuted: true,
      operation: "prepare_product_ads_action",
      risk,
      expiresAt: parsedExpiresAt.toISOString(),
      ...approvalStorageMetadata(input.config.approvalStorage),
    },
  };
}

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
  validateSellerAccountScope,
  validateTargetAvailability,
  idempotencyCandidateFor,
  rollbackStrategyPresent,
  apiCapabilityEvidenceStatus,
  mapReadinessError,
  buildReadinessResponse,
};

void syncProductExecutionReadinessFoundation;

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

/**
 * Creates an MCP server with base MSL stub tools and optional injected
 * MercadoLibre read tools plus prepare-only write proposal tooling.
 * Compatible with any MCP client (Claude Desktop, Cursor, VS Code, etc.).
 */
export function createMcpServer(config: McpServerConfig = {}) {
  const server = new McpServer(
    { name: "msl-mcp-server", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const readTools = config.mlcClient ? createMlcReadTools({ client: config.mlcClient }) : undefined;

  // ── simulate_actor ────────────────────────────────────────────────
  server.registerTool(
    "simulate_actor",
    {
      description:
        "Simula comportamiento de comprador, proveedor o competidor en MercadoLibre Chile",
      inputSchema: {
        actorType: z.enum(["comprador", "proveedor", "competidor"]),
        query: z.string().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ actorType, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({
        result: "simulado",
        actor: actorType ?? "desconocido",
      });
    },
  );

  // ── detect_probes ─────────────────────────────────────────────────
  server.registerTool(
    "detect_probes",
    {
      description: "Detecta patrones sospechosos de contrainteligencia en preguntas y vistas",
      inputSchema: {
        questions: z.array(z.unknown()).optional(),
        views: z.array(z.unknown()).optional(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ status: "ok", tool: "detect_probes" });
    },
  );

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

  // ── check_account ─────────────────────────────────────────────────
  server.registerTool(
    "check_account",
    {
      description: "Verifica nivel y reputación de cuenta MercadoLibre",
      inputSchema: {
        sellerId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      if (readTools) {
        return jsonResult(await readTools.reputation.execute({ sellerId }));
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sellerId,
              level: "platinum",
              status: "active",
            }),
          },
        ],
      };
    },
  );

  // ── list_strategies ───────────────────────────────────────────────
  server.registerTool(
    "list_strategies",
    {
      description: "Lista estrategias activas del CEO",
      inputSchema: {
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ strategies: [], count: 0 });
    },
  );

  // ── consult_cortex ────────────────────────────────────────────────
  server.registerTool(
    "consult_cortex",
    {
      description: "Consulta la memoria neuronal para contexto de negocio",
      inputSchema: {
        query: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    ({ msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }
      return jsonResult({ status: "ok", tool: "consult_cortex" });
    },
  );

  if (readTools) {
    registerMlcReadTool(server, "read_mercadolibre_listings", readTools.listings);
    registerMlcReadTool(server, "read_mercadolibre_orders", readTools.orders);
    registerMlcReadTool(server, "read_mercadolibre_messages", readTools.messages);
    registerMlcReadTool(server, "read_mercadolibre_reputation", readTools.reputation);
    registerMlcProductAdsInsightsReadTool(
      server,
      "read_product_ads_insights",
      readTools.productAdsInsights,
    );
    registerMlcCategoryAttributesReadTool(
      server,
      "read_mercadolibre_category_attributes",
      readTools.categoryAttributes,
    );
    registerMlcCategoryTechnicalSpecsReadTool(
      server,
      "read_mercadolibre_category_technical_specs",
      readTools.categoryTechnicalSpecs,
    );
    registerMlcListingPricesReadTool(
      server,
      "read_mercadolibre_listing_prices",
      readTools.listingPrices,
    );
  }

  if (config.mlcClient) {
    const mlcClient = config.mlcClient;

    // ── read_moderation_status ───────────────────────────────────────
    server.registerTool(
      "read_moderation_status",
      {
        description: "Checks moderation status for a specific MercadoLibre item.",
        inputSchema: {
          sellerId: z.string(),
          itemId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, itemId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getModerationStatus!(sellerId, itemId));
      },
    );

    // ── read_notices ─────────────────────────────────────────────────
    server.registerTool(
      "read_notices",
      {
        description: "Reads seller communications and notices from MercadoLibre.",
        inputSchema: {
          sellerId: z.string(),
          limit: z.number().optional(),
          offset: z.number().optional(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, limit, offset, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        const opts: { limit?: number; offset?: number } = {};
        if (limit !== undefined) opts.limit = limit;
        if (offset !== undefined) opts.offset = offset;
        return jsonResult(await mlcClient.getNotices!(sellerId, opts));
      },
    );

    // ── prepare_answer ───────────────────────────────────────────────
    server.registerTool(
      "prepare_answer",
      {
        description:
          "Prepares an answer to a MercadoLibre question for seller approval without executing the post.",
        inputSchema: {
          sellerId: z.string(),
          questionId: z.string(),
          text: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, questionId, text, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.prepareAnswer!(sellerId, { questionId, text }));
      },
    );

    // ── read_claims ──────────────────────────────────────────────────
    server.registerTool(
      "read_claims",
      {
        description: "Searches post-purchase claims for a MercadoLibre seller.",
        inputSchema: {
          sellerId: z.string(),
          limit: z.number().optional(),
          offset: z.number().optional(),
          status: z.string().optional(),
          sort: z.string().optional(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, limit, offset, status, sort, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        const opts: { limit?: number; offset?: number; status?: string; sort?: string } = {};
        if (limit !== undefined) opts.limit = limit;
        if (offset !== undefined) opts.offset = offset;
        if (status !== undefined) opts.status = status;
        if (sort !== undefined) opts.sort = sort;
        return jsonResult(await mlcClient.searchClaims!(sellerId, opts));
      },
    );

    // ── read_claim_detail ────────────────────────────────────────────
    server.registerTool(
      "read_claim_detail",
      {
        description: "Gets detail for a specific MercadoLibre post-purchase claim.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimDetail!(sellerId, claimId));
      },
    );

    // ── read_shipment_status ─────────────────────────────────────────
    server.registerTool(
      "read_shipment_status",
      {
        description: "Gets the shipment status for a MercadoLibre order.",
        inputSchema: {
          sellerId: z.string(),
          shipmentId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, shipmentId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getShipmentStatus!(sellerId, shipmentId));
      },
    );

    // ── read_claim_messages ──────────────────────────────────────────
    server.registerTool(
      "read_claim_messages",
      {
        description: "Reads messages for a specific MercadoLibre post-purchase claim.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimMessages!(sellerId, claimId));
      },
    );

    // ── read_claim_expected_resolutions ──────────────────────────────
    server.registerTool(
      "read_claim_expected_resolutions",
      {
        description: "Reads expected resolutions for a specific MercadoLibre post-purchase claim.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimExpectedResolutions!(sellerId, claimId));
      },
    );

    // ── read_claim_affects_reputation ────────────────────────────────
    server.registerTool(
      "read_claim_affects_reputation",
      {
        description: "Reads whether a claim affects the seller reputation.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimAffectsReputation!(sellerId, claimId));
      },
    );

    // ── read_claim_status_history ────────────────────────────────────
    server.registerTool(
      "read_claim_status_history",
      {
        description: "Reads status history for a specific MercadoLibre post-purchase claim.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimStatusHistory!(sellerId, claimId));
      },
    );

    // ── read_claim_return ──────────────────────────────────────────────
    server.registerTool(
      "read_claim_return",
      {
        description: "Reads return details for a specific MercadoLibre post-purchase claim.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimReturn!(sellerId, claimId));
      },
    );

    // ── read_return_reviews ────────────────────────────────────────────
    server.registerTool(
      "read_return_reviews",
      {
        description: "Reads reviews for a specific MercadoLibre return.",
        inputSchema: {
          sellerId: z.string(),
          returnId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, returnId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getReturnReviews!(sellerId, returnId));
      },
    );

    // ── read_claim_return_cost ─────────────────────────────────────────
    server.registerTool(
      "read_claim_return_cost",
      {
        description: "Reads return cost charges for a specific MercadoLibre post-purchase claim.",
        inputSchema: {
          sellerId: z.string(),
          claimId: z.string(),
          msl_api_key: z.string().optional(),
        },
      },
      async ({ sellerId, claimId, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        return jsonResult(await mlcClient.getClaimReturnCost!(sellerId, claimId));
      },
    );

    // ── prepare_image_orchestration ──────────────────────────────────
    server.registerTool(
      "prepare_image_orchestration",
      {
        description:
          "Prepares a 4-step image orchestration flow (diagnose → upload → associate → check) without executing any MercadoLibre mutations.",
        inputSchema: {
          sellerId: z.string(),
          itemId: z.string(),
          pictureUrl: z.string(),
          categoryId: z.string(),
          title: z.string().optional(),
          msl_api_key: z.string().optional(),
        },
      },
      ({ sellerId, itemId, pictureUrl, categoryId, title, msl_api_key }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }
        const orchestrationInput = {
          sellerId,
          itemId,
          pictureUrl,
          categoryId,
          now: new Date(),
        };
        if (title !== undefined) {
          Object.assign(orchestrationInput, { title });
        }
        const summary: MlcImageOrchestrationSummary =
          normalizeImageOrchestration(orchestrationInput).data;
        return jsonResult({
          ...summary,
          metadata: {
            requiresApproval: true,
            noMutationExecuted: true,
          },
        });
      },
    );
  }

  if (config.prepareWrite) {
    const prepareTool = createPreparedActionTool(config.prepareWrite);
    server.registerTool(
      "prepare_product_ads_action",
      {
        description:
          "Prepares evidence-based Product Ads action recommendations for seller approval without executing Product Ads mutations.",
        inputSchema: mcpPrepareProductAdsActionInputSchema,
      },
      async (request) => {
        const productAdsRequest = request as PrepareProductAdsActionInput;
        if (!validateApiKey(productAdsRequest.msl_api_key)) {
          return unauthorizedResult();
        }

        const response = await prepareProductAdsAction({ request: productAdsRequest, config });
        return "content" in response ? response : jsonResult(response);
      },
    );

    server.registerTool(
      "prepare_mercadolibre_write",
      {
        description:
          "Prepares a MercadoLibre write for seller approval. This tool does not execute mutations.",
        inputSchema: mcpPrepareWriteInputSchema,
      },
      async ({ msl_api_key, id, sellerId, kind, target, exactChange, rationale, expiresAt }) => {
        if (!validateApiKey(msl_api_key)) {
          return unauthorizedResult();
        }

        const parsedExpiresAt = parseStrictIsoTimestamp(expiresAt);
        if (!parsedExpiresAt) {
          return jsonResult(
            { error: "Invalid expiresAt — expected a valid ISO 8601 timestamp" },
            true,
          );
        }

        if (id.startsWith(SYNC_PRODUCT_ACTION_ID_PREFIX)) {
          return blockedResult(
            "reserved-action-id",
            "Prepared write action IDs with the sync_product namespace are reserved for the sync_product tool.",
          );
        }

        const request: PrepareWriteInput = {
          id,
          sellerId,
          kind,
          target: target as PrepareWriteInput["target"],
          exactChange,
          rationale,
          expiresAt: parsedExpiresAt,
        };

        if (isProductAdsPrepareWriteTarget(request.target)) {
          return blockedResult(
            "unsupported-target",
            "Product Ads proposals must use prepare_product_ads_action so evidence validation can be enforced.",
          );
        }

        if (hasUnsafePrepareWritePayload(request)) {
          return blockedResult(
            "credential-like-payload",
            "Prepared write proposals must not include credentials, tokens, secrets, raw credential material, or database paths.",
          );
        }

        try {
          return jsonResult(await prepareTool.execute(request));
        } catch {
          return blockedResult(
            "prepare-write-failed",
            "Prepared write proposal could not be saved because approval storage is unavailable.",
          );
        }
      },
    );
  }

  return server;
}

function parseStrictIsoTimestamp(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const normalized = value.includes(".") ? value : value.replace("Z", ".000Z");
  return parsed.toISOString() === normalized ? parsed : null;
}

function registerMlcReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools["listings" | "orders" | "messages" | "reputation"],
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId }));
    },
  );
}

function registerMlcProductAdsInsightsReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools["productAdsInsights"],
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: mcpReadProductAdsInsightsInputSchema,
    },
    async ({ msl_api_key, ...request }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(await tool.execute(request as Parameters<typeof tool.execute>[0]));
    },
  );
}

function registerMlcCategoryAttributesReadTool(
  server: McpServer,
  name: string,
  tool: MlcCategoryReadTools["categoryAttributes"],
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        categoryId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, categoryId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId, categoryId }));
    },
  );
}

function registerMlcCategoryTechnicalSpecsReadTool(
  server: McpServer,
  name: string,
  tool: MlcCategoryReadTools["categoryTechnicalSpecs"],
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        domainId: z.string(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ sellerId, domainId, msl_api_key }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(await tool.execute({ sellerId, domainId }));
    },
  );
}

function registerMlcListingPricesReadTool(
  server: McpServer,
  name: string,
  tool: MlcReadTools["listingPrices"],
): void {
  server.registerTool(
    name,
    {
      description: tool.description,
      inputSchema: {
        sellerId: z.string(),
        siteId: z.string(),
        price: z.number(),
        categoryId: z.string(),
        currencyId: z.string().optional(),
        listingTypeId: z.string().optional(),
        logisticType: z.string().optional(),
        shippingMode: z.string().optional(),
        billableWeight: z.number().optional(),
        quantity: z.number().optional(),
        tags: z.union([z.string(), z.array(z.string())]).optional(),
        logisticsAware: z.boolean().optional(),
        msl_api_key: z.string().optional(),
      },
    },
    async ({ msl_api_key, ...request }) => {
      if (!validateApiKey(msl_api_key)) {
        return unauthorizedResult();
      }

      return jsonResult(await tool.execute(request as Parameters<typeof tool.execute>[0]));
    },
  );
}

/** Configuration for MCP server dependencies. Dependencies are injected by callers. */
export type McpServerConfig = {
  mlcClient?: MlcApiClient;
  syncPreview?: SyncPreviewDependency;
  readinessEvidence?: SyncProductReadinessEvidenceProviders;
  accountRoles?: MlAccountRoleConfig;
  approvalStorage?: "memory" | "sqlite" | "sqlite-unavailable";
  prepareWrite?: {
    repository: ApprovalQueueRepository;
    clock: Clock;
  };
};

/**
 * Starts the MCP server on the stdio transport for CLI usage.
 *
 * Usage:
 * ```json
 * // mcp.json (Claude Desktop, Cursor, etc.)
 * {
 *   "msl": {
 *     "command": "node",
 *     "args": ["packages/mcp/dist/src/index.js"]
 *   }
 * }
 * ```
 */
export async function startMcpServer(): Promise<void> {
  const runtimeDependencies = createMcpRuntimeDependencies();
  const server = createMcpServer(runtimeDependencies);
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
  } catch (error) {
    runtimeDependencies.close();
    throw error;
  }
}

export { createMcpRuntimeDependencies } from "./runtimeDependencies.js";
