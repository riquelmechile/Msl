import crypto from "node:crypto";

import type { AutonomyEngine } from "../conversation/autonomyEngine.js";
import { resolveDeepSeekUserId } from "../conversation/deepseekRuntime.js";
import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import type {
  DeepSeekTransport,
  DeepSeekChatRequest,
  DeepSeekChatResponse,
} from "../conversation/transports/deepseekTransport.js";

import { estimateCost } from "./costEstimator.js";
import { selectModel } from "./modelRouter.js";
import { getLevelRisk, getLevelTimeout, requiresApprovalByDefault } from "./reasoningLevels.js";
import type {
  ReasoningCall,
  ReasoningLevel,
  ReasoningResult,
  CostTelemetry,
} from "./reasoningTypes.js";

// ── Gateway ──────────────────────────────────────────────────────────

/**
 * Unified DeepSeek reasoning gateway.
 *
 * Wraps a DeepSeekTransport and standardizes:
 * - Model selection (Flash default, Pro escalation)
 * - 3-block prompt cache (stable + cacheable + volatile)
 * - Per-level timeout via Promise.race
 * - Structured output validation
 * - Cost ledger recording
 * - Autonomy gate integration
 *
 * Never throws — all errors return `status: "fallback"`.
 */
export class DeepSeekReasoningGateway {
  private transport: DeepSeekTransport;
  private readonly ledger: WorkforceCostCacheLedgerStore | undefined;
  private readonly autonomy: AutonomyEngine | undefined;

  constructor(
    transport: DeepSeekTransport,
    ledger?: WorkforceCostCacheLedgerStore,
    autonomy?: AutonomyEngine,
  ) {
    this.transport = transport;
    this.ledger = ledger;
    this.autonomy = autonomy;
  }

  /**
   * Execute a reasoning call through DeepSeek.
   *
   * Flow: selectModel → buildPrompt (3-block cache) → AbortController timeout →
   * chat.completions.create → JSON parse & validate → recordCost →
   * checkAutonomy → ReasoningResult.
   *
   * When `costLedgerOverride` is provided, cost is recorded on that ledger
   * instead of the constructor-injected one. This allows callers like
   * `CeoDeepSeekClient` to pass call-site ledger references for backward compat.
   */
  async reason(
    call: ReasoningCall,
    costLedgerOverride?: WorkforceCostCacheLedgerStore,
  ): Promise<ReasoningResult> {
    try {
      // 1. Select model
      const model = selectModel(call.level, call.forcePro);

      // 2. Build 3-block prompt
      const messages = this.buildPrompt(call);

      // 3. Timeout via Promise.race
      const timeoutMs = getLevelTimeout(call.level, call.timeoutMs);
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const userId = resolveDeepSeekUserId({ laneId: call.laneId });
      const deepSeekRequest: DeepSeekChatRequest = {
        model,
        messages,
        stream: false,
        ...(userId ? { extra_body: { user_id: userId } } : {}),
      };

      let response: DeepSeekChatResponse;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("DeepSeekGateway timeout")), timeoutMs);
        });
        response = await Promise.race([
          this.transport.createChatCompletion(deepSeekRequest),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      // 4. Extract raw response
      const raw = response.choices[0]?.message.content;
      if (!raw) return this.fallback("Empty response from DeepSeek");

      // 5. Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return this.fallback("Invalid JSON response from DeepSeek");
      }

      // 6. Validate against expected schema (when provided)
      if (call.expectedSchema && !this.validateSchema(parsed, call.expectedSchema)) {
        return this.fallback("Response does not match expected schema");
      }

      // 7. Build cost telemetry
      const usage = response.usage;
      const cacheHitTokens = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const cacheMissTokens = usage?.prompt_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? 0;

      const costTelemetry: CostTelemetry = {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens,
        cacheHitTokens,
        cacheMissTokens,
        estimatedCostMicros:
          estimateCost(model, { cacheHitTokens, cacheMissTokens, outputTokens }) ?? 0,
      };

      // 8. Record cost ledger entry
      this.recordCost(call, model, costTelemetry, costLedgerOverride ?? this.ledger);

      // 9. Check autonomy gate
      const requiresApproval = this.resolveApproval(call.level, call.sellerId);

      return {
        status: "success",
        summary: "DeepSeek reasoning completed successfully",
        confidence: 0.8,
        recommendations: [parsed],
        modelUsed: model,
        costTelemetry,
        requiresApproval,
        rawResponse: raw,
      };
    } catch (err) {
      return this.fallback(err instanceof Error ? err.message : "Unknown error");
    }
  }

  // ── Private: 3-block prompt construction ───────────────────────────

  /**
   * Builds the 3-block prompt messages array:
   *   1. System: stablePrefix (cached)
   *   2. System: cacheableContext (slow-changing, cached)
   *   3. User: volatileInput (uncached)
   */
  private buildPrompt(call: ReasoningCall): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (call.stablePrefix) {
      messages.push({ role: "system", content: call.stablePrefix });
    }
    if (call.cacheableContext) {
      messages.push({ role: "system", content: call.cacheableContext });
    }
    messages.push({ role: "user", content: call.volatileInput });

    return messages;
  }

  // ── Private: Cost recording ────────────────────────────────────────

  private recordCost(
    call: ReasoningCall,
    model: string,
    telemetry: CostTelemetry,
    ledger: WorkforceCostCacheLedgerStore | undefined,
  ): void {
    if (!ledger) return;

    try {
      const cacheStatus =
        telemetry.cacheHitTokens > 0
          ? "hit"
          : telemetry.cacheMissTokens > 0
            ? "miss"
            : ("unknown" as const);

      // Build entry, omitting undefined optional fields to satisfy exactOptionalPropertyTypes
      const entry: Record<string, unknown> = {
        entryId: `reasoning-gateway:${call.laneId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`,
        agentId: call.agentId,
        laneId: call.laneId,
        departmentId: call.departmentId,
        provider: "deepseek",
        model,
        operation: "chat.completions.create",
        promptCacheHitTokens: telemetry.cacheHitTokens || undefined,
        promptCacheMissTokens: telemetry.cacheMissTokens || undefined,
        inputTokens: telemetry.inputTokens || undefined,
        outputTokens: telemetry.outputTokens || undefined,
        estimatedCostMicros: telemetry.estimatedCostMicros || undefined,
        cacheStatus,
        metadata: { model, source: "reasoning-gateway" },
        measuredAt: new Date().toISOString(),
      };
      ledger.insertEntry(entry as Parameters<typeof ledger.insertEntry>[0]);
    } catch {
      // ledger is best-effort
    }
  }

  // ── Private: Autonomy gate ─────────────────────────────────────────

  private resolveApproval(level: ReasoningLevel, sellerId?: string): boolean {
    // Recommendation and decision always require approval
    if (requiresApprovalByDefault(level)) return true;

    // Auto-execute levels: check autonomy gate when available
    if (this.autonomy) {
      const risk = getLevelRisk(level);
      return !this.autonomy.canAutoApprove(sellerId ?? "default", risk);
    }

    // No autonomy engine → auto-execute is allowed
    return false;
  }

  // ── Private: Schema validation ─────────────────────────────────────

  /**
   * Lightweight JSON schema validation.
   * Checks basic type constraints when expectedSchema is provided.
   * For full JSON Schema compliance, use a dedicated validator (future).
   */
  private validateSchema(data: unknown, schema: Record<string, unknown>): boolean {
    if (!schema || typeof schema !== "object") return true;

    const type = schema.type as string | undefined;

    if (type === "object") {
      if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    } else if (type === "array") {
      if (!Array.isArray(data)) return false;
    } else if (type === "string") {
      if (typeof data !== "string") return false;
    } else if (type === "number") {
      if (typeof data !== "number") return false;
    }

    // Additional properties validation when specified
    const required = schema.required as string[] | undefined;
    if (required && typeof data === "object" && data !== null) {
      for (const field of required) {
        if (!(field in (data as Record<string, unknown>))) return false;
      }
    }

    return true;
  }

  // ── Private: Fallback ──────────────────────────────────────────────

  private fallback(reason: string): ReasoningResult {
    return {
      status: "fallback",
      summary: reason,
      confidence: 0,
      recommendations: [],
      modelUsed: "none",
      costTelemetry: {
        inputTokens: 0,
        outputTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        estimatedCostMicros: 0,
      },
      requiresApproval: true,
    };
  }
}
