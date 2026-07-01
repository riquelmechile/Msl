import type { GraphEngine } from "@msl/memory";

import type {
  AgentProposal,
  ConversationMessage,
  ConversationState,
  EscribanoConfig,
  TurnOutcome,
} from "./types.js";
import { sanitizeReturnedToolIssueEntry, sanitizeToolErrorText } from "./toolErrorSanitizer.js";

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

  /** Business-data node IDs protected from Darwinian pruning. */
  readonly #businessNodeIds = new Set<number>();

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
      this.#engine.prune({
        maxNodes: this.#maxConceptNodes,
        excludeNodeIds: this.#businessNodeIds,
      });
    }

    // Concept node FIFO cap: if the graph has accumulated more concept
    // nodes than maxConceptNodes, force a prune to evict inactive ones.
    if (this.#turnCount % (this.#pruneInterval * 5) === 0) {
      this.#engine.prune({
        maxNodes: this.#maxConceptNodes,
        excludeNodeIds: this.#businessNodeIds,
      });
    }
  }

  /**
   * Persists MercadoLibre business data from agent tool results into Cortex.
   *
   * Creates listing nodes, visit-history nodes, and edges so the agent can
   * recall business state across sessions. Gracefully no-ops when the Cortex
   * engine is unavailable or any individual write fails.
   *
   * @param toolName — The tool that produced this result (e.g. "read_my_listings").
   * @param result — The raw tool return value (MlcListingsSnapshot or MlcVisitsTimeWindowSnapshot).
   */
  observeToolResult(toolName: string, result: Record<string, unknown>): void {
    if (!this.#engine) return;

    try {
      this.#handleReturnedToolIssue(toolName, result);

      if (toolName === "read_my_listings" || toolName === "find_paused_listings") {
        this.#handleListingResult(result);
      } else if (toolName === "check_listing_visits") {
        this.#handleVisitsResult(result);
      } else if (toolName === "check_claims" || toolName === "check_claim_detail") {
        this.#handleClaimResult(result);
      }
    } catch {
      // Cortex save failure must not break the conversation loop.
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

  // ── Business-data ingestion helpers ────────────────────────────

  /**
   * Persist returned tool-level failures that do not throw.
   *
   * Some production tools return `{ error }` or `partialErrors` while the turn
   * continues successfully. Recording them here keeps endpoint issues visible
   * even when the production bot is wired with Escribano but no metrics sink.
   */
  #handleReturnedToolIssue(toolName: string, result: Record<string, unknown>): void {
    const returnedError =
      result.error !== undefined ? sanitizeToolErrorText(result.error) : undefined;
    const partialErrors = Array.isArray(result.partialErrors)
      ? result.partialErrors
          .filter((entry): entry is Record<string, unknown> => {
            return typeof entry === "object" && entry !== null;
          })
          .map(sanitizeReturnedToolIssueEntry)
      : [];

    if (returnedError === undefined && partialErrors.length === 0) return;

    const metadata: Record<string, unknown> = {
      type: "tool_issue",
      toolName,
      source: "escribano",
      updatedAt: new Date().toISOString(),
      status: returnedError !== undefined ? "error" : "partial",
    };
    if (returnedError !== undefined) metadata.error = returnedError;
    if (partialErrors.length > 0) metadata.partialErrors = partialErrors;

    const issueNode = this.#engine.getOrCreateNode(`tool_issue_${toolName}`, metadata);
    this.#businessNodeIds.add(issueNode.id);

    const toolNode = this.#getOrCreateConcept(`tool_${toolName}`);
    this.#ensureEdge(toolNode, issueNode.id);
  }

  /**
   * Persist listing data from {@link MlcListingsSnapshot} results.
   *
   * Creates/updates `listing_{itemId}` nodes, edges from seller to listing,
   * and edges from listing to category concept nodes.
   */
  #handleListingResult(result: Record<string, unknown>): void {
    const sellerId = typeof result.sellerId === "string" ? result.sellerId : "";
    const data = result.data;
    if (!Array.isArray(data)) return;

    const now = new Date().toISOString();

    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const itemId = typeof record.id === "string" ? record.id : undefined;
      if (!itemId) continue;

      try {
        // Create/update listing node
        const metadata: Record<string, unknown> = {
          type: "listing",
          itemId,
          source: "ml-api",
          updatedAt: now,
        };
        // Copy known listing fields when present
        if (typeof record.title === "string") metadata.title = record.title;
        if (typeof record.price === "number") metadata.price = record.price;
        if (typeof record.currencyId === "string") metadata.currencyId = record.currencyId;
        if (typeof record.status === "string") metadata.status = record.status;
        if (typeof record.categoryId === "string") metadata.categoryId = record.categoryId;
        if (typeof record.listingTypeId === "string") metadata.listingTypeId = record.listingTypeId;

        const listingNode = this.#engine.getOrCreateNode(`listing_${itemId}`, metadata);
        this.#businessNodeIds.add(listingNode.id);

        // Edge: seller → listing (weight based on listing age — stale items get lower weight)
        if (sellerId) {
          const sellerNode = this.#getOrCreateConcept(`seller_${sellerId}`);
          this.#ensureEdge(sellerNode, listingNode.id);
        }

        // Edge: listing → category concept (if categoryId present)
        if (typeof record.categoryId === "string" && record.categoryId.length > 0) {
          const catLabel = `category_${record.categoryId}`;
          const catNode = this.#getOrCreateConcept(catLabel);
          this.#ensureEdge(listingNode.id, catNode);
        }
      } catch {
        // Individual listing write failure is non-fatal — skip and continue.
      }
    }
  }

  /**
   * Persist visit data from {@link MlcVisitsTimeWindowSnapshot} results.
   *
   * Creates/updates `visits_{itemId}` nodes and edges from listing to visits.
   */
  #handleVisitsResult(result: Record<string, unknown>): void {
    const data = result.data;
    if (typeof data !== "object" || data === null) return;

    const record = data as Record<string, unknown>;
    const itemId = typeof record.itemId === "string" ? record.itemId : undefined;
    if (!itemId) return;

    try {
      const metadata: Record<string, unknown> = {
        type: "visits",
        itemId,
        source: "ml-api",
        updatedAt: new Date().toISOString(),
      };
      if (typeof record.totalVisits === "number") metadata.totalVisits = record.totalVisits;
      if (typeof record.dateFrom === "string") metadata.dateFrom = record.dateFrom;
      if (typeof record.dateTo === "string") metadata.dateTo = record.dateTo;
      if (Array.isArray(record.results)) metadata.timeWindowResults = record.results;

      const visitsNode = this.#engine.getOrCreateNode(`visits_${itemId}`, metadata);
      this.#businessNodeIds.add(visitsNode.id);

      // Edge: listing → visits
      const listingNode = this.#engine.getOrCreateNode(`listing_${itemId}`, {
        type: "listing",
        itemId,
        updatedAt: new Date().toISOString(),
      });
      this.#businessNodeIds.add(listingNode.id);
      this.#ensureEdge(listingNode.id, visitsNode.id);
    } catch {
      // Individual visits write failure is non-fatal.
    }
  }

  /**
   * Persist claim data from check_claims / check_claim_detail results.
   *
   * Creates/updates `claim_{claimId}` nodes and edges from seller to claim
   * for use in reputation and dispute-resolution reasoning.
   */
  #handleClaimResult(result: Record<string, unknown>): void {
    const sellerId = typeof result.sellerId === "string" ? result.sellerId : "";
    const data = result.data;

    // check_claims returns { paging, results: [...] }
    // check_claim_detail returns { claim: {...}, messages, ... }
    const claims: Record<string, unknown>[] = [];
    if (Array.isArray(data?.results)) {
      // check_claims result
      for (const c of data.results as Record<string, unknown>[]) {
        claims.push(c);
      }
    } else if (typeof data?.claim === "object" && data.claim !== null) {
      // check_claim_detail result — single claim
      claims.push(data.claim as Record<string, unknown>);
    }

    if (claims.length === 0) return;

    const now = new Date().toISOString();

    for (const claim of claims) {
      const claimId = typeof claim.id === "string" ? claim.id : undefined;
      if (!claimId) continue;

      try {
        const metadata: Record<string, unknown> = {
          type: "claim",
          claimId,
          source: "ml-api",
          updatedAt: now,
        };
        if (typeof claim.status === "string") metadata.status = claim.status;
        if (typeof claim.type === "string") metadata.claimType = claim.type;
        if (typeof claim.stage === "string") metadata.stage = claim.stage;
        if (typeof claim.dateCreated === "string") metadata.dateCreated = claim.dateCreated;
        if (typeof claim.reasonId === "string") metadata.reasonId = claim.reasonId;
        if (typeof claim.resourceId === "string") metadata.resourceId = claim.resourceId;

        const claimNode = this.#engine.getOrCreateNode(`claim_${claimId}`, metadata);
        this.#businessNodeIds.add(claimNode.id);

        // Edge: seller → claim
        if (sellerId) {
          const sellerNode = this.#getOrCreateConcept(`seller_${sellerId}`);
          this.#ensureEdge(sellerNode, claimNode.id);
        }

        // Edge: claim → claim_status concept
        if (typeof claim.status === "string" && claim.status.length > 0) {
          const statusLabel = `claim_status_${claim.status}`;
          const statusNode = this.#getOrCreateConcept(statusLabel);
          this.#ensureEdge(claimNode.id, statusNode);
        }
      } catch {
        // Individual claim write failure is non-fatal.
      }
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
