import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";

const UNANSWERED_THRESHOLD_HOURS = 24;

/**
 * Unanswered Questions Watcher daemon — scans for questions unanswered >24h.
 *
 * Fires every 2 hours via scheduler messages. Enqueues CEO alerts with
 * priority 7 for each old unanswered question, and sends Telegram notifications.
 */
export const unansweredQuestionsWatcher: DaemonHandler = async ({
  reader, bus, sellerIds, ceoContext,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  const cutoff = new Date(Date.now() - UNANSWERED_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();

  for (const sellerId of sellerIds) {
    try {
      const qSnaps = await reader.searchSnapshots<{
        status?: string; text?: string; question_id?: string; date_created?: string;
      }>({
        sellerId, kind: "question_snapshot", status: "UNANSWERED", limit: 100,
      });

      const oldUnanswered = qSnaps.filter(snap => {
        const created = snap.data.date_created;
        return created && created < cutoff;
      });

      if (oldUnanswered.length > 0) {
        const sellerName = ceoContext?.sellerNames?.[sellerId] ?? sellerId;
        const summary = `📬 ${sellerName}: ${oldUnanswered.length} preguntas sin responder >${UNANSWERED_THRESHOLD_HOURS}h`;

        for (const q of oldUnanswered.slice(0, 5)) {
          const msgId = bus.enqueue({
            senderAgentId: "unanswered-questions-watcher",
            receiverAgentId: "ceo",
            messageType: "unanswered_question_alert",
            payloadJson: JSON.stringify({
              sellerId,
              itemId: q.itemId,
              questionId: q.data.question_id ?? q.itemId,
              text: q.data.text ?? "(sin texto)",
              hoursUnanswered: UNANSWERED_THRESHOLD_HOURS,
              summary,
            }),
            priority: 7,
          });
          messageIds.push(msgId.messageId);
        }

        findings.push({
          kind: "alert", summary, evidenceIds: oldUnanswered.map(q => q.itemId), severity: "warning",
        });

        // ── Send direct Telegram ──
        if (ceoContext?.adminChatIds && ceoContext.sendProactiveMessage) {
          for (const chatId of ceoContext.adminChatIds) {
            await ceoContext.sendProactiveMessage(Number(chatId), `⚠️ ${summary}`);
          }
        }
      }
    } catch { /* skip */ }
  }

  return { findings, proposalEnqueued: messageIds.length > 0, messageIds };
};
