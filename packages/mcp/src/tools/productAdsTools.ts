import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPreparedActionTool, type PrepareWriteInput } from "@msl/tools";
import type { ExactChange, PreparedAction, RiskLevel } from "@msl/domain";
import type { ApprovalQueueEntry } from "@msl/tools";
import type { McpServerConfig } from "../index.js";
import type { McpToolResult } from "./utils.js";
import {
  jsonResult,
  unauthorizedResult,
  blockedResult,
  trimmedString,
  parseStrictIsoTimestamp,
  approvalStorageMetadata,
  containsCredentialLikeContent,
} from "./utils.js";

// ── Product Ads types ────────────────────────────────────────────────

const PRODUCT_ADS_ACTION_TYPES = [
  "adjust-campaign-budget",
  "pause-campaign",
  "resume-campaign",
  "pause-ad",
  "resume-ad",
  "review-campaign-structure",
] as const;

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

// ── Raw mutation contract detection (Product Ads specific) ───────────

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

// Re-import the credential-like key pattern for the above function
const CREDENTIAL_LIKE_KEY_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth|client[_-]?secret|secret|password|passwd|credential|db[_-]?path|database[_-]?(?:path|url)|sqlite)/i;

// ── Product Ads helper functions ─────────────────────────────────────

function isProductAdsPrepareWriteTarget(target: PrepareWriteInput["target"]): boolean {
  return target.type === "product-ads-campaign" || target.type === "product-ads-ad";
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

// ── Input schema ─────────────────────────────────────────────────────

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

// ── Main registration function ───────────────────────────────────────

export function registerProductAdsTools(
  server: McpServer,
  deps: {
    validateApiKey: (key?: string) => boolean;
    config: McpServerConfig;
  },
): void {
  const { validateApiKey, config } = deps;

  if (!config.prepareWrite) return;

  const prepareTool = createPreparedActionTool(config.prepareWrite);

  // ── prepare_product_ads_action ────────────────────────────────────
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
}
