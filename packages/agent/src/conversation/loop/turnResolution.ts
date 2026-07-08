import type { AgentProposal, ConversationMessage, ConversationState } from "../types.js";
import type { TurnOutcome } from "../types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function isConfirmation(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return /^(dale|s[iíí]|ok|confirmo|confirmar|ejecut[áa]|ejecutar)\b/.test(trimmed);
}

function extractPendingProposal(messages: ConversationMessage[]): AgentProposal | undefined {
  const recent = messages.slice(-5);
  for (const msg of recent) {
    if (msg.role === "assistant") {
      if (msg.content.includes("propuesta de ajuste")) {
        return {
          action: {
            id: "prop-pending",
            sellerId: "seller-1",
            kind: "price-change",
            target: { type: "listing", listingId: "MLC-42" },
            exactChange: [{ field: "price", from: 15000, to: 13500 }],
            rationale: "Ajuste recomendado por análisis de margen.",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          naturalSummary: "¿Bajo el precio del listing MLC-42 en 10%?",
          riskLevel: "medium",
        };
      }
      if (msg.content.includes("contrainteligencia") || msg.content.includes("decoy-")) {
        return {
          action: {
            id: "decoy-pending",
            sellerId: "seller-1",
            kind: "honey-pot-deploy",
            target: { type: "listing", listingId: "decoy-listing" },
            exactChange: [{ field: "status", from: "draft", to: "active" }],
            rationale: "Operación de contrainteligencia aprobada por el CEO.",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          naturalSummary: "¿Ejecuto la operación de contrainteligencia?",
          riskLevel: "high",
        };
      }
    }
  }
  return undefined;
}

// ── Rejection pattern detection ────────────────────────────────────────

export function hasRejectionPattern(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return (
    /(?:^|\s)no quiero(?:\s|$)/i.test(lower) ||
    /(?:^|\s)cancel[aá](?:\s|$)/i.test(lower) ||
    /(?:^|\s)cancelar(?:\s|$)/i.test(lower) ||
    /(?:^|\s)rechazo(?:\s|$)/i.test(lower) ||
    /(?:^|\s)no(?:\s|$)/i.test(lower)
  );
}

// ── Turn outcome resolution ────────────────────────────────────────────

export function resolveTurnOutcome(
  userMessage: string,
  proposal: AgentProposal | undefined,
  responseText: string,
  state?: ConversationState,
): TurnOutcome {
  if (responseText.startsWith("⛔")) return "blocked";

  const effectiveProposal =
    proposal ?? (state ? extractPendingProposal(state.messages) : undefined);
  if (hasRejectionPattern(userMessage) && effectiveProposal) return "rejected";

  if (isConfirmation(userMessage) && proposal) return "confirmed";
  return "none";
}
