import type { GraphEngine } from "@msl/memory";

import type {
  AgentProposal,
  ConversationMessage,
  ConversationState,
  EscribanoConfig,
  TurnOutcome,
} from "./types.js";

// ── Strategy keyword patterns (reuse from guardrails/strategyParser domains) ──

const STRATEGY_KEYWORD_RE =
  /\b(?:margen|precio|stock|unidad|inventario|categor(?:[íi]a|ia)|competencia|competidor|cliente|prioridad)\b/i;

const KEYWORD_TO_LABEL: Record<string, string> = {
  margen: "strategy_margin",
  precio: "strategy_pricing",
  stock: "strategy_stock",
  unidad: "strategy_stock",
  inventario: "strategy_stock",
  categoría: "strategy_category",
  categoria: "strategy_category",
  competencia: "strategy_competitive",
  competidor: "strategy_competitive",
  cliente: "strategy_customer",
  prioridad: "strategy_priority",
};

/**
 * El Escribano — Memory Scribe agent (Phase 1: rule-based observer).
 *
 * Observes every conversation turn and autonomously applies Hebbian
 * learning to the Cortex neural graph: strengthening edges on confirmed
 * proposals, weakening on guardrail rejections, and incrementing
 * co-occurrence on strategy-domain mentions.
 *
 * Injected into the agent loop via {@link EscribanoConfig} in
 * {@link AgentLoopConfig.escribano}. Runs synchronously, zero API cost.
 */
export class EscribanoObserver {
  readonly #engine: GraphEngine;
  readonly #pruneInterval: number;
  readonly #maxConceptNodes: number;
  #turnCount = 0;

  // ── Cache concept node ids to avoid repeated DB lookups ────
  readonly #conceptCache = new Map<string, number>();

  constructor(config: EscribanoConfig) {
    this.#engine = config.engine;
    this.#pruneInterval = config.pruneInterval ?? 10;
    this.#maxConceptNodes = config.maxConceptNodes ?? 5000;
  }

  /**
   * Observe a completed conversation turn and apply Hebbian updates to Cortex.
   *
   * @param prevState — Conversation state BEFORE this turn (used to find the user message).
   * @param newState — Conversation state AFTER this turn (includes the full message history).
   * @param response — The assistant's response text for this turn.
   * @param proposal — Optional agent proposal from this turn.
   * @param outcome — Resolved turn outcome: "confirmed", "rejected", "blocked", or "none".
   */
  observeTurn(
    prevState: ConversationState,
    newState: ConversationState,
    response: string,
    proposal: AgentProposal | undefined,
    outcome: TurnOutcome,
  ): void {
    this.#turnCount++;

    // Find the last user message (the one that triggered this turn).
    const lastUserMsg = [...newState.messages].reverse().find((m) => m.role === "user");

    if (outcome === "confirmed" && proposal) {
      this.#handleConfirmation(proposal);
    }

    if (outcome === "blocked") {
      this.#handleGuardrailRejection(proposal, response);
    }

    if (lastUserMsg) {
      this.#handleStrategyMention(lastUserMsg.content);
    }

    this.#handleActorConsult(newState.messages);

    // Periodic Darwinian pruning
    if (this.#pruneInterval > 0 && this.#turnCount % this.#pruneInterval === 0) {
      this.#engine.prune({ maxNodes: this.#maxConceptNodes });
    }

    // Concept node FIFO cap: if the graph has accumulated more concept
    // nodes than maxConceptNodes, force a prune to evict inactive ones.
    if (this.#turnCount % (this.#pruneInterval * 5) === 0) {
      this.#engine.prune({ maxNodes: this.#maxConceptNodes });
    }
  }

  // ── Private detectors ──────────────────────────────────────────

  /** Hebbian reinforcement: confirmed proposal strengthens edges on involved concept nodes. */
  #handleConfirmation(proposal: AgentProposal): void {
    const conceptLabel = this.#proposalToConceptLabel(proposal);
    const sourceId = this.#getOrCreateConcept(conceptLabel);
    const targetId = this.#getOrCreateConcept("CEO_decision");

    this.#ensureAndReinforce(sourceId, targetId);
  }

  /** Hebbian penalization: guardrail-blocked proposals weaken edges on rejected-proposal → rejection nodes. */
  #handleGuardrailRejection(proposal: AgentProposal | undefined, _response: string): void {
    void _response;
    if (!proposal) return;

    const sourceId = this.#getOrCreateConcept(this.#proposalToConceptLabel(proposal));
    const targetId = this.#getOrCreateConcept("guardrail_rejection");

    this.#ensureAndPenalize(sourceId, targetId);
  }

  /**
   * Detect strategy-domain keywords in user messages and create/reinforce
   * co-occurrence edges between the concept node and a "conversation_turn" node.
   */
  #handleStrategyMention(message: string): void {
    const match = message.match(STRATEGY_KEYWORD_RE);
    if (!match) return;

    const matchedKeywords = new Set<string>();
    for (const kw of match) {
      const lower = kw.toLowerCase();
      const label = KEYWORD_TO_LABEL[lower];
      if (label) matchedKeywords.add(label);
    }

    const turnId = this.#getOrCreateConcept("conversation_turn");

    for (const label of matchedKeywords) {
      const conceptId = this.#getOrCreateConcept(label);
      this.#ensureEdge(conceptId, turnId);
    }
  }

  /**
   * Detect actor simulation tool results in the conversation history.
   * For each simulate_actor tool message found, reinforce the actor-concept edge.
   */
  #handleActorConsult(messages: ConversationMessage[]): void {
    for (const msg of messages) {
      if (msg.role !== "tool") continue;

      let result: Record<string, unknown> | null = null;
      try {
        result = JSON.parse(msg.content) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (typeof result.actorType !== "string") continue;

      const actorLabel = `actor_${result.actorType}`;
      const actorId = this.#getOrCreateConcept(actorLabel);
      const consultId = this.#getOrCreateConcept("actor_consultation");

      this.#ensureAndReinforce(actorId, consultId);
    }
  }

  // ── Graph helpers ──────────────────────────────────────────────

  /**
   * Retrieve (or create) a concept node by label, using an in-memory cache
   * to avoid redundant DB lookups within the same observer instance.
   */
  #getOrCreateConcept(label: string): number {
    const cached = this.#conceptCache.get(label);
    if (cached !== undefined) return cached;

    const node = this.#engine.findOrCreateConceptNode(label, { source: "escribano" });
    this.#conceptCache.set(label, node.id);
    return node.id;
  }

  /** Create an edge if it doesn't exist, then reinforce it. */
  #ensureAndReinforce(source: number, target: number): void {
    this.#ensureEdge(source, target);
    try {
      this.#engine.reinforceEdge(source, target);
    } catch {
      // Edge may have been pruned between ensure and reinforce — ignore
    }
  }

  /** Create an edge if it doesn't exist, then penalize it. */
  #ensureAndPenalize(source: number, target: number): void {
    this.#ensureEdge(source, target);
    try {
      this.#engine.penalizeEdge(source, target);
    } catch {
      // Edge may have been pruned between ensure and penalize — ignore
    }
  }

  /** Create an edge if none exists between source and target (idempotent). */
  #ensureEdge(source: number, target: number): void {
    try {
      this.#engine.createEdge(source, target);
    } catch {
      // Edge already exists — this is expected, not an error
    }
  }

  /** Map a proposal to a stable concept label. */
  #proposalToConceptLabel(proposal: AgentProposal): string {
    const kind = proposal.action.kind;
    if (kind === "honey-pot-deploy" || kind === "probe-analysis") return "proposal_honey_pot";
    if (kind === "price-change") return "proposal_price_change";
    return `proposal_${kind}`;
  }
}
