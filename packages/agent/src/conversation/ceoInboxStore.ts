import crypto from "node:crypto";
import Database from "better-sqlite3";

// ── Schema ───────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL UNIQUE,
  sender_agent_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  normalized_summary TEXT NOT NULL DEFAULT '',
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK(risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','routed','reviewed','archived')),
  routed_to TEXT,
  seller_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ap_status ON agent_proposals(status);
CREATE INDEX IF NOT EXISTS idx_ap_seller_id ON agent_proposals(seller_id);
`;

// ── Row type ─────────────────────────────────────────────────────────

export type AgentProposalRow = {
  id: number;
  proposal_id: string;
  sender_agent_id: string;
  proposal_type: string;
  payload_json: string;
  normalized_summary: string;
  risk_level: "low" | "medium" | "high" | "critical";
  status: "pending" | "routed" | "reviewed" | "archived";
  routed_to: string | null;
  seller_id: string;
  created_at: string;
  updated_at: string;
};

// ── Public types ─────────────────────────────────────────────────────

export type InsertAgentProposalInput = {
  proposal_id?: string;
  sender_agent_id: string;
  proposal_type: string;
  payload_json: string;
  normalized_summary?: string;
  risk_level?: "low" | "medium" | "high" | "critical";
  seller_id: string;
  routed_to?: string | null;
};

export type CeoInboxStore = {
  insert(input: InsertAgentProposalInput): AgentProposalRow;
  listByStatus(status?: string): AgentProposalRow[];
  getBySellerId(sellerId: string): AgentProposalRow[];
  /** Get proposals by status. Alias for listByStatus(status). */
  getByStatus(status: string): AgentProposalRow[];
  /**
   * Mark a proposal as routed to Telegram and set its status to "routed".
   * @param proposalId — the unique proposal ID
   * @param chatId — Telegram chat ID
   * @param threadId — optional Telegram forum thread ID
   * @returns the updated proposal row
   */
  routeToTelegram(proposalId: string, chatId: string, threadId?: string): AgentProposalRow;
};

// ── Row mapper ───────────────────────────────────────────────────────

function rowToAgentProposal(row: AgentProposalRow): AgentProposalRow {
  return { ...row };
}

// ── Factory ──────────────────────────────────────────────────────────

export function createCeoInboxStore(db: Database.Database): CeoInboxStore {
  db.exec(SCHEMA_SQL);

  // ── Prepared statements ────────────────────────────────────

  const selectByProposalIdStmt = db.prepare(`
    SELECT * FROM agent_proposals WHERE proposal_id = ?
  `);

  const insertStmt = db.prepare(`
    INSERT INTO agent_proposals (
      proposal_id, sender_agent_id, proposal_type, payload_json,
      normalized_summary, risk_level, routed_to, seller_id
    ) VALUES (
      @proposalId, @senderAgentId, @proposalType, @payloadJson,
      @normalizedSummary, @riskLevel, @routedTo, @sellerId
    )
  `);

  const listByStatusStmt = db.prepare(`
    SELECT * FROM agent_proposals
    WHERE status = ?
    ORDER BY created_at DESC
  `);

  const listAllStmt = db.prepare(`
    SELECT * FROM agent_proposals
    ORDER BY created_at DESC
  `);

  const getBySellerIdStmt = db.prepare(`
    SELECT * FROM agent_proposals
    WHERE seller_id = ?
    ORDER BY created_at DESC
  `);

  const getByStatusStmt = db.prepare(`
    SELECT * FROM agent_proposals
    WHERE status = ?
    ORDER BY created_at DESC
  `);

  const routeToTelegramStmt = db.prepare(`
    UPDATE agent_proposals
    SET routed_to = @routedTo, status = 'routed', updated_at = datetime('now')
    WHERE proposal_id = @proposalId
  `);

  // ── API methods ────────────────────────────────────────────

  const insert = (input: InsertAgentProposalInput): AgentProposalRow => {
    const proposalId = input.proposal_id ?? crypto.randomUUID();

    // Dedup: return existing proposal if proposal_id already in store
    const existing = selectByProposalIdStmt.get(proposalId) as AgentProposalRow | undefined;
    if (existing) {
      return rowToAgentProposal(existing);
    }

    insertStmt.run({
      proposalId,
      senderAgentId: input.sender_agent_id,
      proposalType: input.proposal_type,
      payloadJson: input.payload_json,
      normalizedSummary: input.normalized_summary ?? "",
      riskLevel: input.risk_level ?? "low",
      routedTo: input.routed_to ?? null,
      sellerId: input.seller_id,
    });

    const row = selectByProposalIdStmt.get(proposalId) as AgentProposalRow;
    return rowToAgentProposal(row);
  };

  const listByStatus = (status?: string): AgentProposalRow[] => {
    if (status) {
      return listByStatusStmt.all(status) as AgentProposalRow[];
    }
    return listAllStmt.all() as AgentProposalRow[];
  };

  const getBySellerId = (sellerId: string): AgentProposalRow[] => {
    return getBySellerIdStmt.all(sellerId) as AgentProposalRow[];
  };

  const getByStatus = (status: string): AgentProposalRow[] => {
    return getByStatusStmt.all(status) as AgentProposalRow[];
  };

  const routeToTelegram = (
    proposalId: string,
    chatId: string,
    threadId?: string,
  ): AgentProposalRow => {
    const routedTo = threadId ? `telegram:${chatId}:${threadId}` : `telegram:${chatId}`;
    const info = routeToTelegramStmt.run({ proposalId, routedTo });
    if (info.changes === 0) {
      throw new Error(`Proposal "${proposalId}" not found. Cannot route to Telegram.`);
    }
    const row = selectByProposalIdStmt.get(proposalId) as AgentProposalRow;
    return rowToAgentProposal(row);
  };

  return {
    insert,
    listByStatus,
    getBySellerId,
    getByStatus,
    routeToTelegram,
  };
}
