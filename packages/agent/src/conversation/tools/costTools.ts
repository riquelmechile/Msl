import type {
  WorkforceCostCacheLedgerStore,
  WorkforceCacheStatus,
} from "../workforceCostCacheLedgerStore.js";
import { LEDGER_LIMITS as workforceCostCacheLedgerLimits } from "../workforceCostCacheLedgerStore.js";
import type { LaneId } from "../lanes.js";
import type { ToolDefinition } from "./types.js";
import {
  safeString,
  normalizeCompanyAgentText,
  truncateCompanyAgentText,
  summarizeWorkforceCostCacheLedgerEntry,
  validWorkforceCacheStatuses,
} from "./types.js";

// ── Record Ledger Entry ───────────────────────────────────────────────

export type RecordWorkforceCostCacheLedgerToolOptions = {
  authorized?: boolean;
};

export function createRecordWorkforceCostCacheLedgerEntryTool(
  ledgerStore: WorkforceCostCacheLedgerStore | undefined,
  options: RecordWorkforceCostCacheLedgerToolOptions = {},
): ToolDefinition {
  return {
    name: "record_workforce_cost_cache_ledger_entry",
    description:
      "Records a bounded local cost/cache ledger entry for internal AI workforce usage after CEO/admin authorization. Never stores raw prompts, responses, or secrets; no external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        entryId: { type: "string" },
        agentId: { type: "string" },
        laneId: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        operation: { type: "string" },
        promptCacheHitTokens: { type: "number", minimum: 0 },
        promptCacheMissTokens: { type: "number", minimum: 0 },
        inputTokens: { type: "number", minimum: 0 },
        outputTokens: { type: "number", minimum: 0 },
        estimatedCostMicros: { type: "number", minimum: 0 },
        currency: { type: "string" },
        cacheStatus: { type: "string", enum: [...validWorkforceCacheStatuses] },
        metadata: {
          type: "object",
          description:
            "Flat bounded scalar metadata only. Do not include prompts, responses, or secrets.",
        },
        measuredAt: { type: "string" },
      },
      required: ["entryId", "agentId", "provider", "model", "operation", "cacheStatus"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!options.authorized) {
        return {
          status: "blocked",
          error: "unauthorized",
          missingInputs: ["authorized CEO/admin runtime"],
          noExternalMutationExecuted: true,
        };
      }

      if (!ledgerStore) {
        return {
          status: "blocked",
          error: "workforce cost/cache ledger store unavailable",
          missingInputs: ["workforceCostCacheLedgerStore"],
          noExternalMutationExecuted: true,
        };
      }

      const entryId = safeString(args.entryId).toLowerCase();
      const agentId = safeString(args.agentId).toLowerCase();
      const laneId = safeString(args.laneId).toLowerCase();
      const provider = safeString(args.provider).toLowerCase();
      const model = safeString(args.model).toLowerCase();
      const operation = safeString(args.operation).toLowerCase();
      const cacheStatus = safeString(args.cacheStatus).toLowerCase() as WorkforceCacheStatus;
      const missingInputs: string[] = [];
      if (!entryId) missingInputs.push("entryId");
      if (!agentId) missingInputs.push("agentId");
      if (!provider) missingInputs.push("provider");
      if (!model) missingInputs.push("model");
      if (!operation) missingInputs.push("operation");
      if (!validWorkforceCacheStatuses.has(cacheStatus)) missingInputs.push("cacheStatus");
      if (missingInputs.length > 0) {
        return { status: "blocked", missingInputs, noExternalMutationExecuted: true };
      }

      try {
        const entry = ledgerStore.insertEntry({
          entryId,
          agentId,
          ...(laneId ? { laneId: laneId as LaneId } : {}),
          provider,
          model,
          operation,
          ...(typeof args.promptCacheHitTokens === "number"
            ? { promptCacheHitTokens: args.promptCacheHitTokens }
            : {}),
          ...(typeof args.promptCacheMissTokens === "number"
            ? { promptCacheMissTokens: args.promptCacheMissTokens }
            : {}),
          ...(typeof args.inputTokens === "number" ? { inputTokens: args.inputTokens } : {}),
          ...(typeof args.outputTokens === "number" ? { outputTokens: args.outputTokens } : {}),
          ...(typeof args.estimatedCostMicros === "number"
            ? { estimatedCostMicros: args.estimatedCostMicros }
            : {}),
          ...(typeof args.currency === "string"
            ? { currency: args.currency.trim().toUpperCase() }
            : {}),
          cacheStatus,
          ...(args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata)
            ? { metadata: args.metadata as Record<string, unknown> }
            : {}),
          ...(typeof args.measuredAt === "string" ? { measuredAt: args.measuredAt } : {}),
        });

        return {
          status: "recorded",
          entry: summarizeWorkforceCostCacheLedgerEntry(entry),
          noExternalMutationExecuted: true,
        };
      } catch (error) {
        return {
          status: "blocked",
          error: "unsafe workforce cost/cache ledger entry",
          missingInputs: [error instanceof Error ? error.message : "valid ledger entry"],
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

export function createListWorkforceCostCacheLedgerEntriesTool(
  ledgerStore: WorkforceCostCacheLedgerStore | undefined,
): ToolDefinition {
  return {
    name: "list_workforce_cost_cache_ledger_entries",
    description:
      "Lists bounded local AI workforce cost/cache ledger entries. Read-only; no external systems are mutated.",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string" },
        laneId: { type: "string" },
        limit: {
          type: "number",
          minimum: workforceCostCacheLedgerLimits.minListLimit,
          maximum: workforceCostCacheLedgerLimits.maxListLimit,
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!ledgerStore) {
        return { entries: [], storeAvailable: false, noExternalMutationExecuted: true };
      }
      const agentId = safeString(args.agentId).toLowerCase();
      const laneId = safeString(args.laneId).toLowerCase();
      const limit =
        typeof args.limit === "number"
          ? args.limit
          : workforceCostCacheLedgerLimits.defaultListLimit;
      const entries = ledgerStore.listEntries({
        ...(agentId ? { agentId } : {}),
        ...(laneId ? { laneId: laneId as LaneId } : {}),
        limit: Math.max(
          workforceCostCacheLedgerLimits.minListLimit,
          Math.min(limit, workforceCostCacheLedgerLimits.maxListLimit),
        ),
      });

      return {
        entries: entries.map(summarizeWorkforceCostCacheLedgerEntry),
        storeAvailable: true,
        noExternalMutationExecuted: true,
      };
    },
  };
}
