import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Thresholds ──────────────────────────────────────────────────────

const DEFAULT_DEADLINE_HOURS = 24;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract optional env config with fallback.
 */
function envVal(key: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return isNaN(parsed) ? fallback : parsed;
}

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Unanswered Questions daemon handler.
 *
 * Scans buyer questions via `OperationalReadModelReader`, detects questions
 * older than a configurable deadline without a seller response, groups them
 * by seller, and enqueues aggregated CEO proposals.
 *
 * All findings are enqueued as CEO proposals with `noMutationExecuted: true`.
 * This daemon is proposal-only and never answers questions directly.
 */
export const unansweredQuestionsDaemon: DaemonHandler = async ({ reader, bus, sellerIds }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const now = new Date();
  const capturedAt = now.toISOString();
  const deadlineHours = envVal("MSL_UNANSWERED_QUESTIONS_DEADLINE_HOURS", DEFAULT_DEADLINE_HOURS);

  // ── Collect unanswered questions across all sellers ───────────

  type QuestionEntry = {
    itemId: string;
    sellerId: string;
    text: string;
    questionId: string;
    createdAt: string;
    ageHours: number;
  };

  const allQuestions: QuestionEntry[] = [];

  for (const sellerId of sellerIds) {
    try {
      const questionSnaps = await reader.searchSnapshots<{
        status?: string;
        text?: string;
        question_id?: string;
        questionId?: string;
        created_at?: string;
        createdAt?: string;
      }>({ sellerId, kind: "question_snapshot", status: "UNANSWERED", limit: 500 });

      for (const snap of questionSnaps) {
        const d = snap.data;
        const createdAt = metadataString(d.created_at ?? d.createdAt, snap.capturedAt);
        const created = new Date(createdAt);
        const ageMs = now.getTime() - created.getTime();
        const ageHours = ageMs / (1000 * 60 * 60);

        allQuestions.push({
          itemId: snap.itemId,
          sellerId,
          text: String(d.text ?? ""),
          questionId: String(d.question_id ?? d.questionId ?? snap.itemId),
          createdAt,
          ageHours,
        });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[unanswered-questions] Failed to read questions for seller ${sellerId}: ${errorMessage}`,
      );
    }
  }

  // ── Filter by age ─────────────────────────────────────────────

  const overdueQuestions = allQuestions.filter((q) => q.ageHours >= deadlineHours);

  // ── Group by seller ───────────────────────────────────────────

  const bySeller = new Map<string, QuestionEntry[]>();
  for (const q of overdueQuestions) {
    const group = bySeller.get(q.sellerId) ?? [];
    group.push(q);
    bySeller.set(q.sellerId, group);
  }

  // ── Enqueue CEO proposals (one per seller with overdue questions) ──

  let proposalEnqueued = false;

  if (overdueQuestions.length > 0) {
    for (const [sellerId, sellerQuestions] of bySeller) {
      const questionsList = sellerQuestions
        .map(
          (q) =>
            `#${q.questionId} (${q.ageHours.toFixed(0)}h old): "${q.text.slice(0, 120)}${q.text.length > 120 ? "…" : ""}"`,
        )
        .join("\n");

      const summary = `Unanswered questions for seller ${sellerId}: ${sellerQuestions.length} overdue question(s) (deadline: ${deadlineHours}h)`;

      const payloadJson: Record<string, unknown> = {
        type: "proposal",
        summary,
        sellerId,
        questions: sellerQuestions.map((q) => ({
          questionId: q.questionId,
          itemId: q.itemId,
          text: q.text,
          ageHours: Math.round(q.ageHours),
          createdAt: q.createdAt,
        })),
        questionsText: questionsList,
        recommendedAction: "Review unanswered questions and prepare buyer responses",
        capturedAt,
        noMutationExecuted: true,
      };

      const message = bus.enqueue({
        senderAgentId: "unanswered-questions",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payloadJson),
        dedupeKey: `unanswered-questions-${sellerId}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);

      // Add findings for each overdue question
      for (const q of sellerQuestions) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Unanswered buyer question (${q.ageHours.toFixed(0)}h): #${q.questionId} — "${q.text.slice(0, 80)}${q.text.length > 80 ? "…" : ""}" (seller: ${sellerId})`,
          evidenceIds: [`question_snapshot:${q.itemId}`, `seller:${sellerId}`],
        });
      }
    }

    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
