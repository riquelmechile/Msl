import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ApprovalQueueEntry, ApprovalQueueRepository, Clock } from "@msl/tools";
import type {
  MlcApiClient,
  MlWriteSnapshot,
  MlAccountRoleConfig,
  NewItem,
  Strategy,
} from "@msl/mercadolibre";
import type {
  CompanyAgentRegistry,
  CompanyAgentSkillStore,
  CompanyAgentLearningStore,
  WorkforceCostCacheLedgerStore,
} from "@msl/agent";
import { createMcpRuntimeDependencies } from "./runtimeDependencies.js";
import {
  registerActorTools,
  registerSyncTools,
  registerReadTools,
  registerCortexTools,
  registerModerationTools,
  registerClaimTools,
  registerImageTools,
  registerProductAdsTools,
  registerWriteTools,
  registerWorkforceTools,
} from "./tools/index.js";
import type { ExactChange } from "@msl/domain";

// ── Public types ─────────────────────────────────────────────────────

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

/** Minimal strategy store interface matching the subset needed by MCP tools. */
export type McpStrategyStore = {
  listActive(): unknown[];
};

/** Configuration for MCP server dependencies. Dependencies are injected by callers. */
export type McpServerConfig = {
  mlcClient?: MlcApiClient;
  strategyStore?: McpStrategyStore;
  syncPreview?: SyncPreviewDependency;
  readinessEvidence?: SyncProductReadinessEvidenceProviders;
  accountRoles?: MlAccountRoleConfig;
  approvalStorage?: "memory" | "sqlite" | "sqlite-unavailable";
  prepareWrite?: {
    repository: ApprovalQueueRepository;
    clock: Clock;
  };
  executeWrite?: {
    publishItem(sellerId: string, item: NewItem): Promise<MlWriteSnapshot>;
    updateItem(
      sellerId: string,
      itemId: string,
      updates: Partial<NewItem>,
    ): Promise<MlWriteSnapshot>;
  };
  workforceAdmin?: {
    companyAgentRegistry?: CompanyAgentRegistry;
    companyAgentSkillStore?: CompanyAgentSkillStore;
    workforceCostCacheLedgerStore?: WorkforceCostCacheLedgerStore;
    companyAgentLearningStore?: CompanyAgentLearningStore;
    companyAgentAdminAuthorized?: boolean;
  };
};

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

  const toolDeps = { validateApiKey, config };

  // Register all tool groups
  registerActorTools(server, toolDeps);
  registerSyncTools(server, toolDeps);
  registerReadTools(server, toolDeps);
  registerCortexTools(server, toolDeps);
  registerProductAdsTools(server, toolDeps);
  registerWriteTools(server, toolDeps);
  registerWorkforceTools(server, toolDeps);

  // mlcClient-dependent tools (moderation, claims, images)
  if (config.mlcClient) {
    registerModerationTools(server, toolDeps);
    registerClaimTools(server, toolDeps);
    registerImageTools(server, toolDeps);
  }

  return server;
}

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
