import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

/**
 * End-of-Day Summary daemon — generates an end-of-day briefing when triggered.
 *
 * Gathers all data since midnight and reports on orders, claims, questions,
 * top categories, and action items for tomorrow.
 */
export const eodSummaryDaemon: DaemonHandler = async ({
  reader,
  cortex,
  sellerIds,
  bus,
  ceoContext,
}) => {
  const findings: DaemonFinding[] = [];
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  // ── Gather today's data ────────────────────────────
  const summary: string[] = [];
  const actionItems: string[] = [];

  for (const sellerId of sellerIds) {
    const sellerName = ceoContext?.sellerNames?.[sellerId] ?? sellerId;
    summary.push(`\n📦 ${sellerName}:`);

    // Orders today
    try {
      const orderSnaps = await reader.searchSnapshots<{ status?: string }>({
        sellerId,
        kind: "order_snapshot",
        capturedAfter: midnight,
        limit: 200,
      });
      const paid = orderSnaps.filter((o) => o.data.status === "paid");
      summary.push(`   🛒 ${orderSnaps.length} órdenes (${paid.length} pagadas)`);
    } catch {
      /* skip */
    }

    // Claims today
    try {
      const claimSnaps = await reader.searchSnapshots<{ status?: string; reason?: string }>({
        sellerId,
        kind: "claim_snapshot",
        capturedAfter: midnight,
        limit: 100,
      });
      const openClaims = claimSnaps.filter((c) => c.data.status !== "closed");
      if (openClaims.length > 0) {
        summary.push(`   ⚠️ ${openClaims.length} claims abiertos hoy`);
        actionItems.push(`🔴 Resolver ${openClaims.length} claims abiertos en ${sellerName}`);
      }
    } catch {
      /* skip */
    }

    // Unanswered questions
    try {
      const qSnaps = await reader.searchSnapshots<{ status?: string }>({
        sellerId,
        kind: "question_snapshot",
        status: "UNANSWERED",
        limit: 100,
      });
      if (qSnaps.length > 0) {
        summary.push(`   ❓ ${qSnaps.length} preguntas sin responder`);
        actionItems.push(`🟡 Responder ${qSnaps.length} preguntas pendientes en ${sellerName}`);
      }
    } catch {
      /* skip */
    }

    // Top categories by listing count
    try {
      const listingSnaps = await reader.searchSnapshots<{
        status?: string;
        category_id?: string;
        price?: number;
      }>({
        sellerId,
        kind: "listing_snapshot",
        capturedAfter: midnight,
        limit: 500,
      });
      const categoryCount = new Map<string, number>();
      for (const snap of listingSnaps) {
        const cat = snap.data.category_id ?? "unknown";
        categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);
      }
      const topCats = [...categoryCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (topCats.length > 0) {
        summary.push(`   📊 Top categorías: ${topCats.map(([c, n]) => `${c} (${n})`).join(", ")}`);
      }
    } catch {
      /* skip */
    }

    // Reputation
    try {
      const repNodes = cortex.queryByMetadata({ type: "reputation_snapshot", sellerId, limit: 1 });
      if (repNodes.length >= 1) {
        const m = repNodes[0]!.metadata;
        const score = String(m.reputationScore as string ?? m.reputation_score as string ?? "N/A");
        const level = String(m.reputationLevel as string ?? m.reputation_level as string ?? "N/A");
        summary.push(`   ⭐ Reputación: ${level} (${score})`);
      }
    } catch {
      /* skip */
    }
  }

  // ── Send to Telegram if wired ─────────────────────
  const actionText =
    actionItems.length > 0
      ? `\n\n📋 <b>Acciones para mañana:</b>\n${actionItems.map((a) => `• ${a}`).join("\n")}`
      : "";

  const reportText = `🌙 <b>End-of-Day Summary — ${now.toLocaleDateString("es-CL")}</b>\n${summary.join("\n")}${actionText}`;

  if (ceoContext?.adminChatIds && ceoContext.sendProactiveMessage) {
    for (const chatId of ceoContext.adminChatIds) {
      try {
        await ceoContext.sendProactiveMessage(Number(chatId), reportText);
      } catch {
        /* skip */
      }
    }
  }

  // ── Enqueue findings to bus ───────────────────────
  if (actionItems.length > 0) {
    const messageId = bus.enqueue({
      senderAgentId: "eod-summary",
      receiverAgentId: "ceo",
      messageType: "eod_summary",
      payloadJson: JSON.stringify({
        summary: reportText,
        actionItems,
        generatedAt: now.toISOString(),
      }),
      priority: 3,
    });
    findings.push({
      kind: "info",
      summary: "EOD summary with action items generated",
      evidenceIds: [],
      severity: "info",
    });
    return { findings, proposalEnqueued: true, messageIds: [messageId.messageId] };
  }

  findings.push({
    kind: "info",
    summary: "EOD summary: all clear",
    evidenceIds: [],
    severity: "info",
  });
  return { findings, proposalEnqueued: false, messageIds: [] };
};
