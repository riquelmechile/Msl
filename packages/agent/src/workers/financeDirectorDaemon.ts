import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

// ── Thresholds ──────────────────────────────────────────────────────

const DEFAULT_MAX_OUTCOMES = 25;
const DEFAULT_MAX_AGE_DAYS = 7;

// ── Helpers ─────────────────────────────────────────────────────────

function envVal(key: string, fallback: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Finance Director daemon handler.
 *
 * Event-driven financial monitoring that runs on the scheduler cycle
 * (configurable interval, NOT every 15 minutes by default — use a
 * longer interval like 1 hour via `MSL_FINANCE_DIRECTOR_INTERVAL_MS`).
 *
 * Responsibilities:
 * - Detect new economic outcomes since last check
 * - Flag profit anomalies (negative net profit, margin-consuming signals)
 * - Detect pending evidence requests for the finance-director lane
 * - Wake the finance-director work session when relevant signals exist
 * - Propose structured findings to the CEO inbox
 *
 * Never executes mutations. All proposals carry `noMutationExecuted: true`.
 */
export const financeDirectorDaemon: DaemonHandler = async ({ reader, sellerIds, bus }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const maxAgeMs = envVal("MSL_FINANCE_DIRECTOR_SCAN_DAYS", DEFAULT_MAX_AGE_DAYS) * 86400000;
  const maxOutcomes = envVal("MSL_FINANCE_DIRECTOR_MAX_OUTCOMES", DEFAULT_MAX_OUTCOMES);

  const now = new Date();
  const capturedAt = now.toISOString();
  const since = new Date(now.getTime() - maxAgeMs);

  // ── Scan for new economic outcomes across all sellers ─────────

  type OutcomeSnapshot = {
    outcomeId: string;
    sellerId: string;
    status: string;
    netProfitMinor: number;
    confidence: number;
    createdAt: string;
  };

  const outcomes: OutcomeSnapshot[] = [];

  for (const sellerId of sellerIds) {
    try {
      const outcomeSnaps = await reader.searchSnapshots<{
        outcomeId?: string;
        outcome_id?: string;
        status?: string;
        net_profit_minor?: number;
        netProfitMinor?: number;
        confidence?: number;
        created_at?: string;
        createdAt?: string;
        revenue_minor?: number;
        cost_minor?: number;
      }>({
        sellerId,
        kind: "economic_outcome_snapshot",
        limit: maxOutcomes,
      });

      for (const snap of outcomeSnaps) {
        const d = snap.data;
        const createdAt = String(d.created_at ?? d.createdAt ?? snap.capturedAt);
        const created = new Date(createdAt);

        // Skip outcomes older than the scan window
        if (created < since) continue;

        const netProfitMinor =
          typeof d.net_profit_minor === "number"
            ? d.net_profit_minor
            : typeof d.netProfitMinor === "number"
              ? d.netProfitMinor
              : 0;
        const confidence = typeof d.confidence === "number" ? d.confidence : 0;
        const status = typeof d.status === "string" ? d.status : "unknown";

        outcomes.push({
          outcomeId: String(d.outcomeId ?? d.outcome_id ?? snap.itemId),
          sellerId,
          status,
          netProfitMinor,
          confidence,
          createdAt,
        });
      }
    } catch (err) {
      // Daemons must never crash the scheduler
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[finance-director] Failed to read outcomes for seller ${sellerId}: ${errorMessage}`,
      );
    }
  }

  // ── Detect signals ───────────────────────────────────────────

  let proposalEnqueued = false;

  // Signal 1: New outcomes
  const newOutcomes = outcomes.filter((o) => o.status === "observed" || o.status === "calculated");
  if (newOutcomes.length > 0) {
    for (const outcome of newOutcomes) {
      findings.push({
        kind: "info",
        severity: "info",
        summary: `New economic outcome ${outcome.outcomeId} (${outcome.status}) for seller ${outcome.sellerId}: net profit ${outcome.netProfitMinor} minor units, confidence ${outcome.confidence}`,
        evidenceIds: [`outcome:${outcome.outcomeId}`, `seller:${outcome.sellerId}`],
      });
    }
  }

  // Signal 2: Profit anomalies (negative net profit)
  const lossOutcomes = outcomes.filter((o) => o.netProfitMinor < 0 && o.status !== "disputed");
  if (lossOutcomes.length > 0) {
    for (const outcome of lossOutcomes) {
      findings.push({
        kind: "alert",
        severity: "warning",
        summary: `Negative profit outcome ${outcome.outcomeId} for seller ${outcome.sellerId}: ${outcome.netProfitMinor} minor units (confidence ${outcome.confidence})`,
        evidenceIds: [`outcome:${outcome.outcomeId}`, `seller:${outcome.sellerId}`],
      });
    }
  }

  // Signal 3: Low-confidence outcomes (confidence < 0.5)
  const lowConfidenceOutcomes = outcomes.filter((o) => o.confidence > 0 && o.confidence < 0.5);
  if (lowConfidenceOutcomes.length > 0) {
    for (const outcome of lowConfidenceOutcomes) {
      findings.push({
        kind: "opportunity",
        severity: "info",
        summary: `Low-confidence outcome ${outcome.outcomeId} for seller ${outcome.sellerId} (confidence ${outcome.confidence}): evidence may be missing`,
        evidenceIds: [`outcome:${outcome.outcomeId}`, `seller:${outcome.sellerId}`],
      });
    }
  }

  // ── Enqueue CEO proposal if findings exist ────────────────────

  if (findings.length > 0) {
    // Group findings by seller
    const bySeller = new Map<string, DaemonFinding[]>();
    for (const f of findings) {
      const sellerId =
        f.evidenceIds.find((id) => id.startsWith("seller:"))?.replace("seller:", "") ?? "unknown";
      const group = bySeller.get(sellerId) ?? [];
      group.push(f);
      bySeller.set(sellerId, group);
    }

    for (const [sellerId, sellerFindings] of bySeller) {
      const alertCount = sellerFindings.filter((f) => f.kind === "alert").length;
      const infoCount = sellerFindings.filter((f) => f.kind === "info").length;
      const oppCount = sellerFindings.filter((f) => f.kind === "opportunity").length;

      const summary =
        `Finance Director scan for seller ${sellerId}: ` +
        `${alertCount} alert(s), ${infoCount} new outcome(s), ${oppCount} investigation opportunity(ies)`;

      const topSeverity = sellerFindings.some((f) => f.severity === "critical")
        ? "critical"
        : sellerFindings.some((f) => f.severity === "warning")
          ? "warning"
          : "info";

      const payloadJson: Record<string, unknown> = {
        type: "finance-director-scan",
        summary,
        sellerId,
        topSeverity,
        scanWindowDays: Math.round(maxAgeMs / 86400000),
        findings: sellerFindings.map((f) => ({
          kind: f.kind,
          severity: f.severity,
          summary: f.summary,
          evidenceIds: f.evidenceIds,
        })),
        capturedAt,
        noMutationExecuted: true,
      };

      const message = bus.enqueue({
        senderAgentId: "finance-director",
        receiverAgentId: "ceo",
        messageType: "proposal",
        payloadJson: JSON.stringify(payloadJson),
        dedupeKey: `finance-director-${sellerId}-${capturedAt.slice(0, 13)}`,
      });
      messageIds.push(message.messageId);
    }

    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
