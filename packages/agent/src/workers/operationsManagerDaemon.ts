import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { OperationsAnalysisFinding } from "../conversation/operationsDeepSeekAdvisor.js";

// ── Thresholds ──────────────────────────────────────────────────────

const UNANSWERED_QUESTION_HOURS = 24;
const REPUTATION_SCORE_THRESHOLD = 0.4; // below this = warning
const DELAYED_ORDER_GRACE_HOURS = 4; // allow small buffer after estimated delivery

// ── Helpers ─────────────────────────────────────────────────────────

function metadataString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

/**
 * Operations-manager daemon handler.
 *
 * Investigates operational snapshots from the OperationalReadModel +
 * Cortex for the seller. Detects:
 *   - Open post-purchase claims (severity: critical)
 *   - Unanswered buyer questions past deadline (severity: warning)
 *   - Delayed orders past estimated delivery (severity: critical)
 *   - Reputation score below threshold (severity: warning)
 *
 * All findings are enqueued as CEO proposals with `noMutationExecuted: true`.
 */
export const operationsManagerDaemon: DaemonHandler = async ({
  reader,
  cortex,
  bus,
  sellerIds,
  operationsAdvisor,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const now = new Date();
  const capturedAt = now.toISOString();

  // ── Collect evidence across all sellers ──────────────────────

  type ClaimEntry = {
    itemId: string;
    sellerId: string;
    status: string;
    reason: string;
    claimId: string;
  };
  type QuestionEntry = {
    itemId: string;
    sellerId: string;
    status: string;
    text: string;
    questionId: string;
    createdAt: string;
  };
  type OrderEntry = {
    itemId: string;
    sellerId: string;
    status: string;
    estimatedDelivery: string;
    orderId: string;
  };

  const allClaims: ClaimEntry[] = [];
  const allQuestions: QuestionEntry[] = [];
  const allOrders: OrderEntry[] = [];
  const reputationBySeller: Record<string, { score: number; color: string }> = {};
  for (const sellerId of sellerIds) {
    // ── 1. Claims ───────────────────────────────────────────
    const claimSnaps = await reader.searchSnapshots<{
      status?: string;
      reason?: string;
      claim_id?: string;
      claimId?: string;
    }>({ sellerId, kind: "claim_snapshot", status: "open", limit: 500 });

    for (const snap of claimSnaps) {
      const d = snap.data;
      allClaims.push({
        itemId: snap.itemId,
        sellerId,
        status: String(d.status ?? "unknown"),
        reason: String(d.reason ?? ""),
        claimId: String(d.claim_id ?? d.claimId ?? snap.itemId),
      });
    }

    // ── 2. Questions ────────────────────────────────────────
    const questionSnaps = await reader.searchSnapshots<{
      status?: string;
      text?: string;
      question_id?: string;
      questionId?: string;
      created_at?: string;
      createdAt?: string;
    }>({ sellerId, kind: "question_snapshot", status: "unanswered", limit: 500 });

    for (const snap of questionSnaps) {
      const d = snap.data;
      allQuestions.push({
        itemId: snap.itemId,
        sellerId,
        status: String(d.status ?? "unknown"),
        text: String(d.text ?? ""),
        questionId: String(d.question_id ?? d.questionId ?? snap.itemId),
        createdAt: metadataString(d.created_at ?? d.createdAt, snap.capturedAt),
      });
    }

    // ── 3. Orders ───────────────────────────────────────────
    const orderSnaps = await reader.searchSnapshots<{
      status?: string;
      estimated_delivery?: string;
      estimatedDelivery?: string;
      order_id?: string;
      orderId?: string;
    }>({ sellerId, kind: "order_snapshot", status: "delayed", limit: 500 });

    for (const snap of orderSnaps) {
      const d = snap.data;
      allOrders.push({
        itemId: snap.itemId,
        sellerId,
        status: String(d.status ?? "unknown"),
        estimatedDelivery: metadataString(d.estimated_delivery ?? d.estimatedDelivery, ""),
        orderId: String(d.order_id ?? d.orderId ?? snap.itemId),
      });
    }

    // ── 4. Reputation ───────────────────────────────────────
    // Try ORM first, then Cortex fallback
    const repSnaps = await reader.searchSnapshots<{
      level?: string;
      score?: number;
      color?: string;
    }>({ sellerId, kind: "reputation_snapshot", limit: 1 });

    const rep =
      repSnaps.length > 0 && repSnaps[0]
        ? {
            score: Number(repSnaps[0].data.score ?? 0),
            color: String(repSnaps[0].data.color ?? ""),
          }
        : (() => {
            // Fallback: Cortex query
            const cortexRepNodes = cortex.queryByMetadata({
              type: "reputation_snapshot",
              sellerId,
              limit: 1,
            });
            if (cortexRepNodes.length > 0 && cortexRepNodes[0]) {
              const rm = cortexRepNodes[0].metadata;
              return {
                score: Number(rm.score ?? 0),
                color: typeof rm.color === "string" ? rm.color : "",
              };
            }
            return null;
          })();

    if (rep) {
      reputationBySeller[sellerId] = rep;
      if (rep.score < REPUTATION_SCORE_THRESHOLD) {
        findings.push({
          kind: "alert",
          severity: "warning",
          summary: `Seller ${sellerId} reputation score ${rep.score} below threshold ${REPUTATION_SCORE_THRESHOLD} (color: ${rep.color || "unknown"})`,
          evidenceIds: [`reputation_snapshot`],
        });
      }
    }
  }

  // ── Detection ──────────────────────────────────────────────

  // A. Open claims → critical (pre-filtered by searchSnapshots)
  for (const claim of allClaims) {
    findings.push({
      kind: "alert",
      severity: "critical",
      summary: `Open post-purchase claim: #${claim.claimId} (${claim.reason || "no reason"})`,
      evidenceIds: [`claim_snapshot:${claim.itemId}`, `seller:${claim.sellerId}`],
    });
  }

  // B. Unanswered questions > 24h → warning (pre-filtered by searchSnapshots)
  const deadline = new Date(now);
  deadline.setHours(deadline.getHours() - UNANSWERED_QUESTION_HOURS);

  for (const q of allQuestions) {
    const created = new Date(q.createdAt);
    if (isNaN(created.getTime())) continue;
    if (created < deadline) {
      const hoursUnanswered = Math.round((now.getTime() - created.getTime()) / (1000 * 60 * 60));
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Unanswered buyer question (${hoursUnanswered}h): #${q.questionId} — "${q.text.slice(0, 80)}${q.text.length > 80 ? "…" : ""}"`,
        evidenceIds: [`question_snapshot:${q.itemId}`, `seller:${q.sellerId}`],
      });
    }
  }

  // C. Delayed orders → critical
  const delayedThreshold = new Date(now);
  delayedThreshold.setHours(delayedThreshold.getHours() - DELAYED_ORDER_GRACE_HOURS);

  for (const order of allOrders) {
    // Check status-based first
    if (order.status === "delayed") {
      findings.push({
        kind: "alert",
        severity: "critical",
        summary: `Delayed shipment: #${order.orderId} — order marked as delayed`,
        evidenceIds: [`order_snapshot:${order.itemId}`, `seller:${order.sellerId}`],
      });
    }

    // Then check estimated_delivery date
    if (!order.estimatedDelivery) continue;
    const estDate = new Date(order.estimatedDelivery);
    if (isNaN(estDate.getTime())) continue;
    if (estDate < delayedThreshold) {
      const daysLate = Math.round((now.getTime() - estDate.getTime()) / (1000 * 60 * 60 * 24));
      findings.push({
        kind: "alert",
        severity: "critical",
        summary: `Order past estimated delivery (${daysLate}d late): #${order.orderId}`,
        evidenceIds: [`order_snapshot:${order.itemId}`, `seller:${order.sellerId}`],
      });
    }
  }

  // ── AI Enrichment (claims + reputation only) ────────────────
  const hasClaims = allClaims.length > 0;
  const hasReputationIssues =
    Object.keys(reputationBySeller).length > 0 &&
    Object.values(reputationBySeller).some((r) => r.score < REPUTATION_SCORE_THRESHOLD);
  let aiEnrichment:
    | {
        findings: OperationsAnalysisFinding[];
        summary: string;
        modelUsed: string;
        enrichedAt: string;
      }
    | undefined;

  if (operationsAdvisor && (hasClaims || hasReputationIssues)) {
    try {
      const repScores = Object.values(reputationBySeller);
      const avgRepScore =
        repScores.length > 0
          ? repScores.reduce((sum, r) => sum + r.score, 0) / repScores.length
          : 1;

      const analysis = await operationsAdvisor.analyze({
        sellerId: sellerIds.join(","),
        openClaims: allClaims.map((c) => ({
          claimId: c.claimId,
          reason: c.reason,
          sellerId: c.sellerId,
          itemId: c.itemId,
        })),
        reputationScore: avgRepScore,
      });

      aiEnrichment = {
        findings: analysis.findings,
        summary: analysis.summary,
        modelUsed: analysis.modelUsed,
        enrichedAt: capturedAt,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[operations-manager] Advisor enrichment failed, using rule-only: ${errorMessage}`,
      );
    }
  }

  // ── Enqueue CEO proposals ──────────────────────────────────
  let proposalEnqueued = false;

  if (findings.length > 0) {
    // Group by severity tier
    const criticals = findings.filter((f) => f.severity === "critical");
    const warnings = findings.filter((f) => f.severity === "warning");
    const infos = findings.filter((f) => f.severity === "info");

    const enqueueGroup = (
      group: DaemonFinding[],
      kind: string,
      enrichment?: typeof aiEnrichment,
    ) => {
      if (group.length === 0) return;
      const summary = `Operations ${kind}s: ${group.length} finding(s)`;
      const recommendedAction =
        kind === "critical"
          ? "Review and resolve immediately — open claims and delayed orders require urgent attention"
          : "Review and respond — unanswered questions and reputation risks should be addressed";

      const payloadJson: Record<string, unknown> = {
        type: "proposal",
        summary,
        findings: group.map((f) => ({
          kind: f.kind,
          severity: f.severity,
          summary: f.summary,
          evidenceIds: f.evidenceIds,
        })),
        recommendedAction,
        capturedAt,
        noMutationExecuted: true,
      };

      // Attach AI enrichment to critical (claims) and warning (reputation) groups
      if (enrichment && (kind === "critical" || kind === "warning")) {
        payloadJson.aiEnrichment = enrichment;
      }

      const message = bus.enqueue({
        senderAgentId: "operations-manager",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payloadJson),
        dedupeKey: `operations-manager-${kind}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);
    };

    enqueueGroup(criticals, "critical", aiEnrichment);
    enqueueGroup(warnings, "warning", aiEnrichment);
    enqueueGroup(infos, "opportunity");
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
