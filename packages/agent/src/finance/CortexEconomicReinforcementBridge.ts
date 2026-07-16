import type { GraphEngine } from "@msl/memory";
import type {
  EconomicReinforcementPlan,
  EconomicLearningEvent,
  EconomicOutcome,
  AppliedAdjustment,
} from "@msl/domain";
import { createEconomicLearningEvent } from "@msl/domain";

// ── Bridge input ────────────────────────────────────────────────────────────

export type BridgeInput = {
  plan: EconomicReinforcementPlan;
  outcome: EconomicOutcome;
  engine: GraphEngine | undefined;
  /** Check if an idempotency key has already been processed */
  isAlreadyProcessed: (idempotencyKey: string) => boolean;
  /** Persist a learning event (audit record) */
  persistEvent: (event: EconomicLearningEvent) => void;
  /** Optionally compute a state hash for before/after comparison */
  computeStateHash?: () => string;
  /** Durable store for listing past events (replaces in-memory arrays) */
  listEventsByOutcome: (outcomeId: string, sellerId: string) => EconomicLearningEvent[];
  /** Durable store for listing reversed events */
  listReversedEvents: (outcomeId: string, sellerId: string) => EconomicLearningEvent[];
};

// ── Bridge result ───────────────────────────────────────────────────────────

export type BridgeResult = {
  event: EconomicLearningEvent;
  applied: boolean;
  idempotent: boolean;
  errorCode?: string;
};

// ── Bridge ──────────────────────────────────────────────────────────────────

export class CortexEconomicReinforcementBridge {
  /**
   * Apply a reinforcement plan to the Cortex graph engine.
   *
   * Guarantees:
   *  - Idempotent: same idempotency key → returns existing event from durable store
   *  - Engine undefined → creates failed event, never crashes
   *  - Seller isolation: events scoped per seller
   *  - No outcome mutation
   *  - No external API calls
   *  - Metadata is bounded (outcomeId, sellerId, status)
   */
  applyPlan(input: BridgeInput): BridgeResult {
    const {
      plan,
      outcome: _outcome,
      engine,
      isAlreadyProcessed,
      persistEvent,
      computeStateHash,
      listEventsByOutcome,
    } = input;

    const idempotencyKey = `${plan.outcomeId}-${plan.sellerId}-${plan.reinforcementPolicyVersion}`;

    if (isAlreadyProcessed(idempotencyKey)) {
      const existing = listEventsByOutcome(plan.outcomeId, plan.sellerId).find(
        (e) => e.idempotencyKey === idempotencyKey,
      );
      if (existing) {
        return {
          event: existing,
          applied: false,
          idempotent: true,
        };
      }
      // isAlreadyProcessed returned true but no event found in the store yet —
      // this happens when claimIdempotencyKey just inserted (atomic claim),
      // not when an event already exists. Continue with processing.
    }

    const beforeStateHash = this.computeHash(engine, computeStateHash);

    if (!engine) {
      const event = createEconomicLearningEvent({
        idempotencyKey,
        outcomeId: plan.outcomeId,
        sellerId: plan.sellerId,
        planId: plan.planId,
        attributionId: "",
        targetNodeIds: [],
        targetEdgeIds: [],
        adjustments: [],
        lessonsCreated: [],
        beforeStateHash,
        afterStateHash: beforeStateHash,
        status: "failed",
        errorCode: "cortex-unavailable",
        metadata: {
          outcomeId: plan.outcomeId,
          sellerId: plan.sellerId,
          status: "failed",
        },
        reinforcementPolicyVersion: plan.reinforcementPolicyVersion,
      });

      persistEvent(event);

      return {
        event,
        applied: false,
        idempotent: false,
        errorCode: "cortex-unavailable",
      };
    }

    const targetNodeIds: string[] = [];
    const targetEdgeIds: string[] = [];
    const adjustments: AppliedAdjustment[] = [];

    for (const _target of plan.targetNodes) {
      const existingNode = engine.getOrCreateNode(
        `economic_outcome:${plan.outcomeId}`,
        {
          type: "economic_outcome",
          outcomeId: plan.outcomeId,
          sellerId: plan.sellerId,
          status: "verified",
        },
        plan.sellerId,
      );
      targetNodeIds.push(String(existingNode.id));
    }

    for (const edge of plan.targetEdges) {
      targetEdgeIds.push(edge.nodeId);
    }

    for (const adj of plan.proposedAdjustments) {
      const nodeId = Number(adj.nodeId);
      if (!Number.isNaN(nodeId)) {
        const targetNode = engine.getNode(nodeId);
        if (targetNode) {
          const beforeValue = targetNode.activation;
          this.applyActivationDelta(engine, nodeId, adj.delta, adj.targetType);
          const afterValue = clamp(beforeValue + adj.delta, 0, 1);
          const applied: AppliedAdjustment = {
            nodeId: adj.nodeId,
            delta: adj.delta,
            targetType: adj.targetType,
            beforeValue,
            afterValue,
          };
          adjustments.push(applied);
        }
      }
    }

    const lessonIds = plan.lessonCandidates.map((_, idx) => `lesson-${plan.outcomeId}-${idx + 1}`);

    const afterStateHash = this.computeHash(engine, computeStateHash);

    const event = createEconomicLearningEvent({
      idempotencyKey,
      outcomeId: plan.outcomeId,
      sellerId: plan.sellerId,
      planId: plan.planId,
      attributionId: "",
      targetNodeIds,
      targetEdgeIds,
      adjustments,
      lessonsCreated: lessonIds,
      beforeStateHash,
      afterStateHash,
      status: "processed",
      metadata: {
        outcomeId: plan.outcomeId,
        sellerId: plan.sellerId,
        status: "processed",
      },
      reinforcementPolicyVersion: plan.reinforcementPolicyVersion,
    });

    persistEvent(event);

    return {
      event,
      applied: true,
      idempotent: false,
    };
  }

  /**
   * Reverse learning for a specific outcome.
   *
   * Reads from the durable EconomicLearningStore to find past events
   * (no in-memory arrays). Finds the most recent non-reversed event
   * and creates a reversal event.
   */
  reverseLearning(
    outcomeId: string,
    sellerId: string,
    listStore: (oid: string, sid: string) => EconomicLearningEvent[],
    listReversedStore: (oid: string, sid: string) => EconomicLearningEvent[],
  ): BridgeResult {
    const events = listStore(outcomeId, sellerId);
    const reversedEvents = listReversedStore(outcomeId, sellerId);
    const reversedEventIds = new Set(reversedEvents.map((e) => e.eventId));

    const latestNonReversed = events.find(
      (e) => e.status !== "reversed" && !reversedEventIds.has(e.eventId),
    );

    if (!latestNonReversed) {
      const compensating = createEconomicLearningEvent({
        idempotencyKey: `reverse-${outcomeId}-${sellerId}-compensating`,
        outcomeId,
        sellerId,
        planId: "",
        attributionId: "",
        targetNodeIds: [],
        targetEdgeIds: [],
        adjustments: [],
        lessonsCreated: [],
        beforeStateHash: "",
        afterStateHash: "",
        status: "reversed",
        errorCode: "all-events-already-reversed",
        metadata: {
          outcomeId,
          sellerId,
          status: "compensating",
        },
        reinforcementPolicyVersion: "0.1.0",
      });

      return {
        event: compensating,
        applied: false,
        idempotent: true,
        errorCode: "all-events-already-reversed",
      };
    }

    const inversedAdjustments: AppliedAdjustment[] = latestNonReversed.adjustments.map((adj) => ({
      ...adj,
      delta: -adj.delta,
      beforeValue: adj.afterValue,
      afterValue: adj.beforeValue,
    }));

    const reversed = createEconomicLearningEvent({
      ...latestNonReversed,
      adjustments: inversedAdjustments,
      beforeStateHash: latestNonReversed.afterStateHash,
      afterStateHash: latestNonReversed.beforeStateHash,
      status: "reversed",
      reversedAt: Date.now(),
    });

    return {
      event: reversed,
      applied: true,
      idempotent: false,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Apply an activation delta to a node in the GraphEngine.
   * Mutates the node's activation value directly in SQLite,
   * clamped to the [0, 1] range.
   *
   * Additionally, for positive deltas, reinforces edges connected
   * to the target node using the engine's Hebbian primitives.
   */
  private applyActivationDelta(
    engine: GraphEngine,
    nodeId: number,
    delta: number,
    _targetType: "node" | "edge",
  ): void {
    if (!Number.isFinite(delta) || delta === 0) return;

    try {
      const node = engine.getNode(nodeId);
      if (!node) return;

      const newActivation = clamp(node.activation + delta, 0, 1);
      engine.db.prepare("UPDATE nodes SET activation = ? WHERE id = ?").run(newActivation, nodeId);

      if (delta > 0) {
        const edgeRows = engine.db
          .prepare("SELECT source, target FROM edges WHERE source = ? OR target = ? LIMIT 10")
          .all(nodeId, nodeId) as { source: number; target: number }[];
        for (const edge of edgeRows) {
          try {
            engine.reinforceEdge(edge.source, edge.target);
          } catch {
            // Edge reinforcement best-effort
          }
        }
      }
    } catch {
      // Best-effort activation update
    }
  }

  private computeHash(engine: GraphEngine | undefined, hashFn?: () => string): string {
    if (hashFn) {
      return hashFn();
    }
    if (engine) {
      const traversed = engine.traverse();
      const snapshot = JSON.stringify({
        nodes: traversed.activatedNodes,
        edges: traversed.traversedEdges,
      });
      let hash = 0;
      for (let i = 0; i < snapshot.length; i++) {
        const char = snapshot.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
      }
      return String(hash);
    }
    return "no-engine";
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
