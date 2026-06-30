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
import { ACTION_TARGET_FIELD_BY_TYPE, type ExactChange } from "@msl/domain";
import {
  assertCompleteMlcItem,
  assertPlasticovToMaustianDirection,
  getMlAccountRoleConfig,
  normalizeMlcItemId,
  previewStrategyChanges,
  type MlcApiClient,
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
  | "credential-like-payload"
  | "invalid-expires-at"
  | "expired-proposal"
  | "approval-required"
  | "invalid-risk"
  | "unsupported-sync-intent"
  | "unsupported-site"
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
  | ReadSyncProductStatusAvailableResponse
  | ReadSyncProductStatusUnavailableResponse;

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

function hasExactChange(
  exactChange: ReadonlyArray<ExactChange>,
  field: string,
  to: ExactChange["to"],
): boolean {
  return exactChange.some((change) => change.field === field && change.to === to);
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
    entry.action.riskLevel === "high" &&
    hasExactChange(entry.action.exactChange, "syncIntent", "prepare-only product sync proposal") &&
    hasExactChange(entry.action.exactChange, "mutationExecuted", false)
  );
}

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
    summary: typeof reason === "string" ? `Preview unavailable: ${reason}.` : "Preview unavailable.",
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
      description: "Sincroniza producto de Plasticov a Maustian aplicando estrategias",
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
          "Product sync preparation requires configured sourceSellerId and targetSellerId for the Plasticov to Maustian MLC direction.",
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
          "MercadoLibre account roles are not configured for Plasticov to Maustian MLC sync preparation.",
        );
      }

      const roleConfigFailure = validateMlcRoleConfig(roleConfig);
      if (roleConfigFailure) {
        return blockedResult(
          roleConfigFailure,
          "Product sync preparation requires configured Plasticov and Maustian account roles on site MLC.",
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
          "Product sync preparation is limited to the configured Plasticov source to Maustian target direction on MLC.",
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
      description: "Reads sanitized status for one stored sync_product proposal by exact action ID.",
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
  }

  if (config.prepareWrite) {
    const prepareTool = createPreparedActionTool(config.prepareWrite);
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

        const request: PrepareWriteInput = {
          id,
          sellerId,
          kind,
          target: target as PrepareWriteInput["target"],
          exactChange,
          rationale,
          expiresAt: parsedExpiresAt,
        };

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
  tool: MlcReadTools[keyof MlcReadTools],
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

/** Configuration for MCP server dependencies. Dependencies are injected by callers. */
export type McpServerConfig = {
  mlcClient?: MlcApiClient;
  syncPreview?: SyncPreviewDependency;
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
