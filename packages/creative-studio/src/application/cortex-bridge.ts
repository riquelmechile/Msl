import type { CreativeExecutionResult } from "../contracts/creative-requests.js";

// ── Types ────────────────────────────────────────────────────────────

export type CortexOutcome = {
  approved: boolean;
  published: boolean;
  metrics?: object;
};

export type AuditEvent = {
  jobId: string;
  requestId: string;
  provider: string;
  model: string;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  channel: string;
  kind: string;
  timestamp: string;
  status: string;
};

/**
 * Thin Cortex feedback adapter.
 *
 * Records creative job outcomes into the existing Cortex memory system
 * so the agent can learn which provider/model/channel combinations work best.
 *
 * The actual Cortex persistence is delegated to the provided `cortex`
 * interface (e.g. GraphEngine) — this adapter formats the data and calls it.
 */

export type CortexSink = {
  recordOutcome(
    jobId: string,
    result: CreativeExecutionResult,
    outcome: CortexOutcome,
  ): Promise<void>;
}

export class CortexBridge implements CortexSink {
  constructor(
    private readonly cortex: {
      getOrCreateNode: (label: string, metadata: Record<string, unknown>) => { id: number };
    },
  ) {}

  /**
   * Record a creative job outcome into Cortex.
   *
   * @param jobId   — Unique job identifier
   * @param result  — The full execution result
   * @param outcome — Approval/publish state + optional metrics
   */
  async recordOutcome(  // eslint-disable-line @typescript-eslint/require-await
    jobId: string,
    result: CreativeExecutionResult,
    outcome: CortexOutcome,
  ): Promise<void> {
    const nodeLabel = `creative_outcome_${jobId}_${Date.now()}`;

    this.cortex.getOrCreateNode(nodeLabel, {
      type: "creative_outcome",
      jobId,
      requestId: result.requestId,
      provider: result.provider,
      model: result.model,
      estimatedCostUsd: result.estimatedCostUsd,
      actualCostUsd: result.actualCostUsd ?? null,
      channel: result.outputs[0]?.kind ?? "unknown",
      outputCount: result.outputs.length,
      approved: outcome.approved,
      published: outcome.published,
      metrics: outcome.metrics ? JSON.stringify(outcome.metrics) : null,
      recordedAt: new Date().toISOString(),
    });
  }
}
