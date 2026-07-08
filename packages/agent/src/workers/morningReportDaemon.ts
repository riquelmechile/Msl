import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

/**
 * Morning Report daemon — generates a morning briefing when triggered.
 *
 * Gathers overnight data (orders, claims, questions, reputation) since
 * midnight and sends a Telegram briefing + enqueues CEO alerts.
 */
export const morningReportDaemon: DaemonHandler = async ({
  reader, cortex, sellerIds, bus, ceoContext,
}) => {
  const findings: DaemonFinding[] = [];
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // ── Gather overnight data ──────────────────────────
  const summary: string[] = [];
  const allAlerts: string[] = [];

  for (const sellerId of sellerIds) {
    const sellerName = ceoContext?.sellerNames?.[sellerId] ?? sellerId;
    summary.push(`\n📦 ${sellerName}:`);

    // Orders since midnight
    try {
      const orderSnaps = await reader.searchSnapshots<{ status?: string }>({
        sellerId, kind: "order_snapshot", capturedAfter: midnight, limit: 200,
      });
      if (orderSnaps.length > 0) {
        summary.push(`   🛒 ${orderSnaps.length} órdenes nuevas`);
      }
    } catch { /* skip */ }

    // Claims since midnight
    try {
      const claimSnaps = await reader.searchSnapshots<{ status?: string; reason?: string }>({
        sellerId, kind: "claim_snapshot", capturedAfter: midnight, limit: 100,
      });
      const openClaims = claimSnaps.filter(c => c.data.status !== "closed");
      if (openClaims.length > 0) {
        summary.push(`   ⚠️ ${openClaims.length} claims abiertos`);
        allAlerts.push(`🔴 ${sellerName}: ${openClaims.length} claims sin resolver`);
      }
    } catch { /* skip */ }

    // Unanswered questions
    try {
      const qSnaps = await reader.searchSnapshots<{ status?: string }>({
        sellerId, kind: "question_snapshot", status: "UNANSWERED", limit: 100,
      });
      if (qSnaps.length > 0) {
        summary.push(`   ❓ ${qSnaps.length} preguntas sin responder`);
        allAlerts.push(`🟡 ${sellerName}: ${qSnaps.length} preguntas pendientes`);
      }
    } catch { /* skip */ }

    // Reputation delta (look at Cortex for change)
    try {
      const repNodes = cortex.queryByMetadata({ type: "reputation_snapshot", sellerId, limit: 2 });
      if (repNodes.length >= 2) {
        const latest = repNodes[0]!.metadata;
        const previous = repNodes[1]!.metadata;
        const prevScore = Number(previous.reputationScore ?? 0);
        const currScore = Number(latest.reputationScore ?? 0);
        if (prevScore > 0 && currScore < prevScore * 0.95) {
          allAlerts.push(`🔴 ${sellerName}: reputación bajó de ${prevScore} a ${currScore}`);
        }
        summary.push(`   ⭐ Reputación: ${latest.reputationLevel ?? "N/A"}`);
      }
    } catch { /* skip */ }
  }

  // ── Send to Telegram if wired ─────────────────────
  const reportText = `🌅 <b>Morning Briefing — ${now.toLocaleDateString("es-CL")}</b>\n${summary.join("\n")}`;
  const alertText = allAlerts.length > 0
    ? `\n\n⚠️ <b>Requieren atención:</b>\n${allAlerts.map(a => `• ${a}`).join("\n")}`
    : "";

  if (ceoContext?.adminChatIds && ceoContext.sendProactiveMessage) {
    for (const chatId of ceoContext.adminChatIds) {
      const id = Number(chatId);
      try {
        await ceoContext.sendProactiveMessage(id, reportText + alertText);
      } catch { /* skip */ }
    }
  }

  // ── Enqueue findings to bus ───────────────────────
  if (allAlerts.length > 0) {
    const messageId = bus.enqueue({
      senderAgentId: "morning-report",
      receiverAgentId: "ceo",
      messageType: "morning_briefing",
      payloadJson: JSON.stringify({ summary: reportText, alerts: allAlerts, generatedAt: now.toISOString() }),
      priority: 3,
    });
    findings.push({
      kind: "alert", summary: "Morning report with alerts generated",
      evidenceIds: [], severity: "info",
    });
    return { findings, proposalEnqueued: true, messageIds: [messageId.messageId] };
  }

  findings.push({ kind: "info", summary: "Morning report: all clear", evidenceIds: [], severity: "info" });
  return { findings, proposalEnqueued: false, messageIds: [] };
};
