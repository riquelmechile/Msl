import type { AgentWorkSessionStore } from "../../sessions/AgentWorkSessionStore.js";
import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";

/**
 * CEO tool: get_agent_work_status
 *
 * Queries the AgentWorkSessionStore for recent agent work sessions and
 * returns a structured status report per seller. Read-only — no mutations.
 */
export function createGetAgentWorkStatusTool(sessionStore?: AgentWorkSessionStore): ToolDefinition {
  return {
    name: "get_agent_work_status",
    description:
      "Consulta el estado de trabajo de los agentes autónomos por cuenta. Retorna agentes que trabajaron hoy, observaciones recientes, propuestas pendientes, costo estimado, eficiencia de caché, y próximos pasos. Solo lectura.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description:
            "ID del vendedor (plasticov, maustian). Opcional — si se omite, retorna todas las cuentas.",
        },
        agentId: {
          type: "string",
          description: "ID del agente específico. Opcional.",
        },
        since: {
          type: "string",
          description: "Fecha ISO desde la cual consultar (default: inicio del día actual).",
        },
        includeLessons: {
          type: "boolean",
          description: "Incluir lecciones aprendidas transferibles en la respuesta.",
        },
      },
      required: [],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      if (!sessionStore) {
        return {
          agentsWorkedToday: [],
          perAccount: {},
          latestObservations: [],
          pendingProposals: [],
          failedSessions: 0,
          estimatedCost: "unavailable",
          cacheEfficiency: "unavailable",
          nextSteps: [
            "Session store not configured. Enable work sessions to track agent activity.",
          ],
          noMutationExecuted: true,
        };
      }

      const sellerId = safeString(args.sellerId) || undefined;
      const agentId = safeString(args.agentId) || undefined;
      const includeLessons = args.includeLessons === true;

      // Default since: start of today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const since = typeof args.since === "string" ? args.since : today.toISOString();

      // Collect data per seller
      const sellers = sellerId ? [sellerId] : ["plasticov", "maustian"];
      const perAccount: Record<string, unknown> = {};
      const allObservations: Array<Record<string, unknown>> = [];
      const allPendingProposals: string[] = [];
      let totalFailures = 0;
      const allLessons: string[] = [];
      const agentsWorked: Set<string> = new Set();

      for (const seller of sellers) {
        const shift = sessionStore.summarizeShift(seller, since);

        if (shift.sessionCount === 0) {
          perAccount[seller] = {
            sessionsToday: 0,
            status: "no_activity",
            observations: {},
            proposals: 0,
            lessons: 0,
          };
          continue;
        }

        // Count observations by kind
        const obsKinds: Record<string, number> = {};
        for (const [kind, count] of Object.entries(shift.observationCounts)) {
          if (count > 0) obsKinds[kind] = count;
        }

        // Collect agent IDs from completed sessions
        const sessionAgents: string[] = [];
        for (const sid of shift.completedSessionIds) {
          const session = sessionStore.getSession(sid, seller);
          if (session) {
            sessionAgents.push(session.agentId);
            agentsWorked.add(`${seller}:${session.agentId}`);
          }
        }

        perAccount[seller] = {
          sessionsToday: shift.sessionCount,
          status: shift.sessionCount > 0 ? "active" : "idle",
          agents: [...new Set(sessionAgents)],
          observations: obsKinds,
          proposals: shift.proposalCount,
          lessons: shift.lessonCount,
          completedSessions: shift.completedSessionIds,
        };

        // Collect observations from recent sessions
        for (const sid of shift.completedSessionIds.slice(0, 5)) {
          const session = sessionStore.getSession(sid, seller);
          if (session) {
            allObservations.push({
              sessionId: sid,
              sellerId: seller,
              agentId: session.agentId,
              status: session.status,
              summary: session.summaryJson,
              startedAt: session.startedAt,
            });
          }
        }

        // Check for failed sessions
        if (agentId) {
          const recentSessions = sessionStore.listRecentSessionsByAgent(seller, agentId, 10);
          totalFailures += recentSessions.filter((s) => s.status === "failed").length;
        }

        // Lessons
        if (includeLessons && agentId) {
          const lessons = sessionStore.listRecentLessons(seller, agentId, 5);
          for (const l of lessons) {
            if (l.transferable && !allLessons.includes(l.lesson)) {
              allLessons.push(l.lesson);
            }
          }
        }
      }

      // Next steps
      const nextSteps: string[] = [];
      const totalSessions = Object.values(perAccount).reduce(
        (sum: number, acc) =>
          sum + (((acc as Record<string, unknown>).sessionsToday as number) ?? 0),
        0,
      );
      if (totalSessions === 0) {
        nextSteps.push(
          "No agent activity detected. Agents may be idle or session store not yet populated.",
        );
      } else if (totalFailures > 0) {
        nextSteps.push(`${totalFailures} failed session(s) detected — review error logs.`);
      }
      if (allLessons.length > 0) {
        nextSteps.push(
          `${allLessons.length} transferable lesson(s) available for cross-agent learning.`,
        );
      }

      return {
        agentsWorkedToday: [...agentsWorked],
        perAccount,
        latestObservations: allObservations.slice(0, 20),
        pendingProposals: allPendingProposals,
        failedSessions: totalFailures,
        estimatedCost: "see workforce cost ledger for detailed breakdown",
        cacheEfficiency: "see workforce cost ledger for cache efficiency metrics",
        nextSteps: nextSteps.length > 0 ? nextSteps : ["All agents operating normally."],
        ...(includeLessons && allLessons.length > 0 ? { transferableLessons: allLessons } : {}),
        noMutationExecuted: true,
      };
    },
  };
}
