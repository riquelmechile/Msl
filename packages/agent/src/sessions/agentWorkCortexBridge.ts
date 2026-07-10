import type { GraphEngine } from "@msl/memory";
import type { AgentWorkSession, AgentObservation, AgentLesson } from "@msl/domain";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Record a completed work session as a Cortex graph node, linked to the
 * account's AccountAsset root node. Idempotent via getOrCreateNode.
 */
export function recordWorkSessionToCortex(
  cortex: GraphEngine,
  session: AgentWorkSession,
  sellerId: string,
): void {
  // Ensure the AccountAsset root node exists
  cortex.ensureAccountAssetNode(sellerId);

  const accountLabel = `account_asset:${sellerId}`;
  const accountNode = cortex.getOrCreateNode(
    accountLabel,
    { type: "account_asset", sellerId },
    sellerId,
  );

  // Create or update the WorkSession node
  const sessionLabel = `work_session:${session.sessionId}`;
  const sessionNode = cortex.getOrCreateNode(
    sessionLabel,
    {
      type: "work_session",
      sessionId: session.sessionId,
      agentId: session.agentId,
      laneId: session.laneId,
      status: session.status,
      signalsHash: session.signalsHash,
      sellerId,
    },
    sellerId,
  );

  // Link AccountAsset → WorkSession
  try {
    cortex.createEdge(accountNode.id, sessionNode.id);
  } catch {
    // Edge may already exist — idempotent
  }
}

/**
 * Record an observation as a Cortex graph node linked to its session node.
 * Edge weight initialized at 0.5.
 */
export function recordObservationToCortex(
  cortex: GraphEngine,
  obs: AgentObservation,
  sellerId: string,
): void {
  // Create or update the Observation node
  const obsLabel = `observation:${obs.observationId}`;
  const obsNode = cortex.getOrCreateNode(
    obsLabel,
    {
      type: "observation",
      observationId: obs.observationId,
      kind: obs.kind,
      severity: obs.severity,
      summary: obs.summary,
      agentId: obs.agentId,
      sessionId: obs.sessionId,
      sellerId,
    },
    sellerId,
  );

  // Link WorkSession → Observation
  const sessionLabel = `work_session:${obs.sessionId}`;
  try {
    const sessionNode = cortex.getOrCreateNode(
      sessionLabel,
      { type: "work_session", sessionId: obs.sessionId, sellerId },
      sellerId,
    );
    try {
      cortex.createEdge(sessionNode.id, obsNode.id);
    } catch {
      // Edge may already exist — idempotent
    }
  } catch {
    // Session node might not exist yet — record observation anyway
  }
}

/**
 * Record multiple observations to Cortex, linking each to its session.
 */
export function recordObservationsToCortex(
  cortex: GraphEngine,
  observations: AgentObservation[],
  session: AgentWorkSession,
  sellerId: string,
): void {
  recordWorkSessionToCortex(cortex, session, sellerId);
  for (const obs of observations) {
    recordObservationToCortex(cortex, obs, sellerId);
  }
}

/**
 * Record a lesson as a Cortex graph node linked to its session node.
 * Transferable lessons also link to the AccountAsset root node for
 * cross-agent discovery.
 */
export function recordLessonToCortex(
  cortex: GraphEngine,
  lesson: AgentLesson,
  sellerId: string,
): void {
  // Create or update the Lesson node
  const lessonLabel = `lesson:${lesson.lessonId}`;
  const lessonNode = cortex.getOrCreateNode(
    lessonLabel,
    {
      type: "lesson",
      lessonId: lesson.lessonId,
      lesson: lesson.lesson,
      transferable: lesson.transferable,
      agentId: lesson.agentId,
      sessionId: lesson.sessionId,
      sellerId,
    },
    sellerId,
  );

  // Link WorkSession → Lesson
  const sessionLabel = `work_session:${lesson.sessionId}`;
  try {
    const sessionNode = cortex.getOrCreateNode(
      sessionLabel,
      { type: "work_session", sessionId: lesson.sessionId, sellerId },
      sellerId,
    );
    try {
      cortex.createEdge(sessionNode.id, lessonNode.id);
    } catch {
      // Edge exists — idempotent
    }
  } catch {
    // Session node missing — record lesson anyway
  }

  // Transferable lessons: link AccountAsset → Lesson for cross-agent discovery
  if (lesson.transferable) {
    cortex.ensureAccountAssetNode(sellerId);
    const accountLabel = `account_asset:${sellerId}`;
    try {
      const accountNode = cortex.getOrCreateNode(
        accountLabel,
        { type: "account_asset", sellerId },
        sellerId,
      );
      try {
        cortex.createEdge(accountNode.id, lessonNode.id);
      } catch {
        // Edge exists — idempotent
      }
    } catch {
      // Account node missing — record lesson anyway
    }
  }
}

/**
 * Record multiple lessons to Cortex.
 */
export function recordLessonsToCortex(
  cortex: GraphEngine,
  lessons: AgentLesson[],
  session: AgentWorkSession,
  sellerId: string,
): void {
  recordWorkSessionToCortex(cortex, session, sellerId);
  for (const lesson of lessons) {
    recordLessonToCortex(cortex, lesson, sellerId);
  }
}

/**
 * Connect a work session to a proposal node in Cortex.
 * Edge weight initialized at 0.5.
 */
export function connectSessionToProposal(
  cortex: GraphEngine,
  sessionId: string,
  proposalId: string,
  sellerId: string,
): void {
  const sessionLabel = `work_session:${sessionId}`;
  const proposalLabel = `proposal:${proposalId}`;

  try {
    const sessionNode = cortex.getOrCreateNode(
      sessionLabel,
      { type: "work_session", sessionId, sellerId },
      sellerId,
    );
    const proposalNode = cortex.getOrCreateNode(
      proposalLabel,
      { type: "proposal", proposalId, sellerId },
      sellerId,
    );
    try {
      cortex.createEdge(sessionNode.id, proposalNode.id);
    } catch {
      // Edge exists — idempotent
    }
  } catch {
    // Nodes missing — no-op
  }
}

/**
 * Connect a work session to an outcome node, enabling Hebbian learning.
 * Initializes edge at weight 0.5; caller should reinforceEdge on positive outcome.
 */
export function connectSessionToOutcome(
  cortex: GraphEngine,
  sessionId: string,
  outcomeNodeLabel: string,
  sellerId: string,
): void {
  const sessionLabel = `work_session:${sessionId}`;

  try {
    const sessionNode = cortex.getOrCreateNode(
      sessionLabel,
      { type: "work_session", sessionId, sellerId },
      sellerId,
    );
    const outcomeNode = cortex.getOrCreateNode(
      outcomeNodeLabel,
      { type: "outcome", sellerId },
      sellerId,
    );
    try {
      cortex.createEdge(sessionNode.id, outcomeNode.id);
    } catch {
      // Edge exists — idempotent
    }
  } catch {
    // Nodes missing — no-op
  }
}
