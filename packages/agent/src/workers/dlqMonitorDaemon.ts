import type { AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";

/**
 * Monitor the agent message bus for messages stuck in `failed` status.
 *
 * Unlike message-driven daemons, this is a standalone scheduler-driven check
 * that queries the bus store directly for failed and stuck-in-processing
 * messages, re-enqueues them, and sends Telegram alerts.
 *
 * @param bus        — The agent message bus store.
 * @param adminChatIds — Telegram admin chat IDs for alerts.
 * @param sendMessage  — Optional function to send Telegram messages.
 */
export async function runDlqMonitor(
  bus: AgentMessageBusStore,
  adminChatIds: string[],
  sendMessage?: (chatId: number, text: string) => Promise<void>,
): Promise<void> {
  const alerts: string[] = [];

  // ── Check failed messages ─────────────────────────
  try {
    const failed = bus.getFailedMessages?.(50) ?? [];
    for (const msg of failed) {
      try {
        bus.reenqueueFailed?.(msg.messageId);
        alerts.push(`🔄 Re-enqueued failed message ${msg.messageId} (${msg.senderAgentId} → ${msg.receiverAgentId})`);
      } catch { /* re-enqueue may fail if already claimed — skip */ }
    }
  } catch { /* bus methods may not exist yet */ }

  // ── Check stuck processing messages ──────────────
  try {
    const stuck = bus.getProcessingStuck?.(10) ?? [];
    for (const msg of stuck) {
      try {
        bus.reenqueueFailed?.(msg.messageId);
        alerts.push(`🔄 Re-enqueued stuck message ${msg.messageId} (was processing >10min)`);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // ── Send alerts ──────────────────────────────────
  if (alerts.length > 0 && sendMessage && adminChatIds.length > 0) {
    const text = `🗑️ <b>DLQ Monitor</b>\n${alerts.map(a => `• ${a}`).join("\n")}`;
    for (const chatId of adminChatIds) {
      try {
        await sendMessage(Number(chatId), text);
      } catch { /* skip */ }
    }
  }
}
