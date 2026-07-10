import type { AgentWorkSessionStore } from "./AgentWorkSessionStore.js";

// ── Public types ────────────────────────────────────────────────────────────

export type MorningBrief = {
  kind: "morning-brief";
  sellerId: string;
  date: string;
  overnightObservations: Array<{
    kind: string;
    severity: string;
    summary: string;
    agentId: string;
  }>;
  pendingProposals: string[];
  lessonsLearned: string[];
  confidence: "low" | "medium" | "high";
  noMutationExecuted: true;
};

export type EndOfDaySummary = {
  kind: "end-of-day";
  sellerId: string;
  date: string;
  agents: Array<{
    agentId: string;
    sessionCount: number;
    observations: number;
    proposals: number;
    lessonsLearned: number;
  }>;
  topObservations: Array<{ kind: string; severity: string; summary: string }>;
  pendingProposals: string[];
  lessonsLearned: string[];
  nextDayRecommendations: string[];
  confidence: "low" | "medium" | "high";
  noMutationExecuted: true;
};

export type AccountShiftSummary = {
  sellerId: string;
  since: string;
  until: string;
  sessionCount: number;
  observationCounts: Record<string, number>;
  proposalCount: number;
  lessonCount: number;
  completedSessionIds: string[];
};

// ── Summary functions ───────────────────────────────────────────────────────

/**
 * Create a morning brief for a seller account.
 * Queries session store for overnight activity.
 */
export function createMorningBrief(
  store: AgentWorkSessionStore,
  sellerId: string,
  agentId?: string,
): MorningBrief {
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const since = todayStart.toISOString();

  const shift = store.summarizeShift(sellerId, since);

  // Gather observations from overnight sessions
  const overnightObservations: MorningBrief["overnightObservations"] = [];
  const lessonsLearned: string[] = [];

  for (const sessionId of shift.completedSessionIds) {
    const session = store.getSession(sessionId, sellerId);
    if (!session) continue;

    // Collect lessons from this session
    const lessons = store.listRecentLessons(sellerId, session.agentId, 10);
    for (const lesson of lessons) {
      if (lesson.sessionId === sessionId && !lessonsLearned.includes(lesson.lesson)) {
        lessonsLearned.push(lesson.lesson);
      }
    }
  }

  // For observations, we iterate over session observation counts converted to summaries
  const observationKinds = Object.entries(shift.observationCounts).filter(([, count]) => count > 0);
  for (const [kind, count] of observationKinds) {
    overnightObservations.push({
      kind,
      severity: kind === "risk" ? "warning" : "info",
      summary: `${count} ${kind} observation(s) overnight`,
      agentId: agentId ?? "system",
    });
  }

  // Compute confidence based on observation coverage
  const totalObservations = Object.values(shift.observationCounts).reduce((a, b) => a + b, 0);
  const confidence: MorningBrief["confidence"] =
    totalObservations >= 5 ? "high" : totalObservations >= 1 ? "medium" : "low";

  return {
    kind: "morning-brief",
    sellerId,
    date: today.toISOString().slice(0, 10),
    overnightObservations,
    pendingProposals: [],
    lessonsLearned,
    confidence,
    noMutationExecuted: true,
  };
}

/**
 * Create an end-of-day summary for a seller account.
 * Aggregates all agent sessions from today.
 */
export function createEndOfDaySummary(
  store: AgentWorkSessionStore,
  sellerId: string,
): EndOfDaySummary {
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const since = todayStart.toISOString();

  const shift = store.summarizeShift(sellerId, since);

  // Per-agent breakdown
  const agentMap = new Map<
    string,
    { sessionCount: number; observations: number; proposals: number; lessonsLearned: number }
  >();

  for (const sessionId of shift.completedSessionIds) {
    const session = store.getSession(sessionId, sellerId);
    if (!session) continue;

    const agentKey = session.agentId;
    const acc = agentMap.get(agentKey) ?? {
      sessionCount: 0,
      observations: 0,
      proposals: 0,
      lessonsLearned: 0,
    };
    acc.sessionCount += 1;
    acc.observations += Object.values(shift.observationCounts).reduce((a, b) => a + b, 0);
    acc.proposals += shift.proposalCount;
    acc.lessonsLearned += shift.lessonCount;
    agentMap.set(agentKey, acc);
  }

  const agents = Array.from(agentMap.entries()).map(([agentId, counts]) => ({
    agentId,
    ...counts,
  }));

  // Top observations from shift summary
  const topObservations: EndOfDaySummary["topObservations"] = Object.entries(
    shift.observationCounts,
  )
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({
      kind,
      severity: kind === "risk" ? "warning" : "info",
      summary: `${count} ${kind} observation(s) today`,
    }));

  // Lessons learned (deduplicated)
  const lessonsSet = new Set<string>();
  for (const sessionId of shift.completedSessionIds) {
    const session = store.getSession(sessionId, sellerId);
    if (!session) continue;
    const lessons = store.listRecentLessons(sellerId, session.agentId, 10);
    for (const l of lessons) {
      if (l.sessionId === sessionId) {
        lessonsSet.add(l.lesson);
      }
    }
  }

  // Next-day recommendations based on observations
  const nextDayRecommendations: string[] = [];
  if (shift.observationCounts.risk > 0) {
    nextDayRecommendations.push("Review risk observations and take corrective action");
  }
  if (shift.observationCounts.opportunity > 0) {
    nextDayRecommendations.push("Explore identified opportunities");
  }
  if (shift.observationCounts.missing_data > 0) {
    nextDayRecommendations.push("Address data gaps identified by agents");
  }
  if (nextDayRecommendations.length === 0) {
    nextDayRecommendations.push("No urgent items — routine monitoring");
  }

  const totalObservations = Object.values(shift.observationCounts).reduce((a, b) => a + b, 0);
  const confidence: EndOfDaySummary["confidence"] =
    totalObservations >= 10 ? "high" : totalObservations >= 3 ? "medium" : "low";

  return {
    kind: "end-of-day",
    sellerId,
    date: today.toISOString().slice(0, 10),
    agents,
    topObservations,
    pendingProposals: [],
    lessonsLearned: [...lessonsSet],
    nextDayRecommendations,
    confidence,
    noMutationExecuted: true,
  };
}

/**
 * Summarize account shift — seller-scoped aggregation for Cortex injection.
 * DB-query-first, no required LLM call.
 */
export function summarizeAccountShift(
  store: AgentWorkSessionStore,
  sellerId: string,
): AccountShiftSummary {
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);

  const shift = store.summarizeShift(sellerId, todayStart.toISOString());

  return {
    sellerId: shift.sellerId,
    since: shift.since,
    until: shift.until,
    sessionCount: shift.sessionCount,
    observationCounts: shift.observationCounts,
    proposalCount: shift.proposalCount,
    lessonCount: shift.lessonCount,
    completedSessionIds: shift.completedSessionIds,
  };
}
