import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import {
  createAgentConsensusStore,
  type AgentConsensusStore,
  type AgentReview, // eslint-disable-line @typescript-eslint/no-unused-vars
} from "../../src/conversation/agentConsensusStore.js";

// ── Fixtures ─────────────────────────────────────────────────────────

function validReview(
  overrides: Partial<{
    proposalId: string;
    reviewerAgentId: string;
    verdict: "approve" | "reject" | "needs_more_evidence" | "risk_warning";
    rationale: string;
    confidence: number;
  }> = {},
) {
  return {
    proposalId: overrides.proposalId ?? "prop-1",
    reviewerAgentId: overrides.reviewerAgentId ?? "agent-alpha",
    verdict: overrides.verdict ?? "approve",
    rationale: overrides.rationale ?? "Looks good based on margin analysis.",
    confidence: overrides.confidence ?? 0.85,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

describe("agentConsensusStore", () => {
  let db: Database.Database;
  let store: AgentConsensusStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    store = createAgentConsensusStore(db);
  });

  // ═══════════════════════════════════════════════════════════════
  // Schema integrity
  // ═══════════════════════════════════════════════════════════════

  describe("schema integrity", () => {
    it("migration is idempotent (runs twice, no error, data preserved)", () => {
      const review = store.submitReview(validReview());

      // Run migration again via a new factory call — must not throw
      const store2 = createAgentConsensusStore(db);

      // Data should survive and be readable through the new store
      const consensus = store2.getConsensus("prop-1");
      expect(consensus.reviews).toHaveLength(1);
      expect(consensus.reviews[0]!.id).toBe(review.id);
    });

    it("has all required columns and does not affect existing tables", () => {
      const db2 = new Database(":memory:");
      db2.exec("CREATE TABLE pre_existing (id INTEGER PRIMARY KEY, name TEXT)");
      db2.prepare("INSERT INTO pre_existing (name) VALUES (?)").run("test-row");

      // Run migration
      createAgentConsensusStore(db2);

      // Pre-existing table must be untouched
      const preRow = db2.prepare("SELECT name FROM pre_existing").get() as {
        name: string;
      };
      expect(preRow.name).toBe("test-row");

      // Verify column count and names
      const columns = db2.pragma("table_info(agent_reviews)") as Array<{
        cid: number;
        name: string;
        type: string;
      }>;
      const columnNames = columns.map((c) => c.name);
      expect(columns.length).toBe(8);

      const expected = [
        "id",
        "proposal_id",
        "reviewer_agent_id",
        "verdict",
        "rationale",
        "confidence",
        "created_at",
        "seller_id",
      ];
      expect(columnNames).toEqual(expected);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // submitReview
  // ═══════════════════════════════════════════════════════════════

  describe("submitReview", () => {
    it("persists a valid review and returns it with id and timestamp", () => {
      const review = store.submitReview(validReview());

      expect(review.id).toBeGreaterThan(0);
      expect(review.proposalId).toBe("prop-1");
      expect(review.reviewerAgentId).toBe("agent-alpha");
      expect(review.verdict).toBe("approve");
      expect(review.rationale).toBe("Looks good based on margin analysis.");
      expect(review.confidence).toBe(0.85);
      expect(review.createdAt).toBeTruthy();
    });

    it("rejects invalid verdict", () => {
      expect(() => store.submitReview(validReview({ verdict: "maybe" as never }))).toThrow(
        /Invalid verdict.*maybe/,
      );
    });

    it("rejects confidence below 0", () => {
      expect(() => store.submitReview(validReview({ confidence: -0.1 }))).toThrow(
        /Confidence must be a number between 0.0 and 1.0/,
      );
    });

    it("rejects confidence above 1", () => {
      expect(() => store.submitReview(validReview({ confidence: 1.5 }))).toThrow(
        /Confidence must be a number between 0.0 and 1.0/,
      );
    });

    it("rejects NaN confidence", () => {
      expect(() => store.submitReview(validReview({ confidence: Number.NaN }))).toThrow(
        /Confidence must be a number between 0.0 and 1.0/,
      );
    });

    it("rejects empty rationale", () => {
      expect(() => store.submitReview(validReview({ rationale: "" }))).toThrow(
        /Rationale is required/,
      );
    });

    it("rejects whitespace-only rationale", () => {
      expect(() => store.submitReview(validReview({ rationale: "   " }))).toThrow(
        /Rationale is required/,
      );
    });

    it("accepts all valid verdicts", () => {
      const verdicts = ["approve", "reject", "needs_more_evidence", "risk_warning"] as const;

      for (let i = 0; i < verdicts.length; i++) {
        const verdict = verdicts[i]!;
        const review = store.submitReview(
          validReview({
            verdict,
            rationale: `Rationale for ${verdict}`,
            reviewerAgentId: `agent-${i}`,
          }),
        );
        expect(review.verdict).toBe(verdict);
        expect(review.id).toBeGreaterThan(0);
      }

      // Verify all 4 rows persisted
      const count = (
        db.prepare("SELECT COUNT(*) as cnt FROM agent_reviews").get() as {
          cnt: number;
        }
      ).cnt;
      expect(count).toBe(4);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // getConsensus
  // ═══════════════════════════════════════════════════════════════

  describe("getConsensus", () => {
    it("returns empty reviews and insufficient_reviews for unknown proposal", () => {
      const consensus = store.getConsensus("unknown-proposal");

      expect(consensus.proposalId).toBe("unknown-proposal");
      expect(consensus.reviews).toEqual([]);
      expect(consensus.verdicts).toEqual({});
      expect(consensus.recommendation).toBe("insufficient_reviews");
      expect(consensus.hasQuorum).toBe(false);
      expect(consensus.minReviewsRequired).toBe(2);
    });

    it("returns reviews in chronological order", () => {
      // Insert two reviews with explicit ordering via timestamps
      store.submitReview(validReview({ proposalId: "prop-order" }));
      store.submitReview(
        validReview({
          proposalId: "prop-order",
          reviewerAgentId: "agent-beta",
          verdict: "needs_more_evidence",
          rationale: "Need more data.",
        }),
      );

      const consensus = store.getConsensus("prop-order");

      expect(consensus.reviews).toHaveLength(2);
      expect(consensus.reviews[0]!.reviewerAgentId).toBe("agent-alpha");
      expect(consensus.reviews[1]!.reviewerAgentId).toBe("agent-beta");
    });

    it("computes verdict counts correctly", () => {
      store.submitReview(validReview({ verdict: "approve", reviewerAgentId: "a" }));
      store.submitReview(validReview({ verdict: "reject", reviewerAgentId: "b" }));
      store.submitReview(validReview({ verdict: "approve", reviewerAgentId: "c" }));

      const consensus = store.getConsensus("prop-1");

      expect(consensus.verdicts).toEqual({
        approve: 2,
        reject: 1,
      });
    });

    it("recommends approved when majority approves with quorum", () => {
      store.submitReview(
        validReview({ proposalId: "q", verdict: "approve", reviewerAgentId: "a" }),
      );
      store.submitReview(
        validReview({ proposalId: "q", verdict: "approve", reviewerAgentId: "b" }),
      );
      store.submitReview(validReview({ proposalId: "q", verdict: "reject", reviewerAgentId: "c" }));

      const consensus = store.getConsensus("q");

      expect(consensus.hasQuorum).toBe(true);
      expect(consensus.recommendation).toBe("approved");
    });

    it("recommends rejected when majority rejects with quorum", () => {
      store.submitReview(
        validReview({ proposalId: "q2", verdict: "reject", reviewerAgentId: "a" }),
      );
      store.submitReview(
        validReview({ proposalId: "q2", verdict: "reject", reviewerAgentId: "b" }),
      );
      store.submitReview(
        validReview({ proposalId: "q2", verdict: "approve", reviewerAgentId: "c" }),
      );

      const consensus = store.getConsensus("q2");

      expect(consensus.hasQuorum).toBe(true);
      expect(consensus.recommendation).toBe("rejected");
    });

    it("recommends needs_review when tied with quorum", () => {
      store.submitReview(
        validReview({ proposalId: "q3", verdict: "approve", reviewerAgentId: "a" }),
      );
      store.submitReview(
        validReview({ proposalId: "q3", verdict: "reject", reviewerAgentId: "b" }),
      );

      const consensus = store.getConsensus("q3");

      expect(consensus.hasQuorum).toBe(true);
      expect(consensus.recommendation).toBe("needs_review");
    });

    it("recommends insufficient_reviews without quorum", () => {
      store.submitReview(validReview({ proposalId: "q4", reviewerAgentId: "a" }));

      const consensus = store.getConsensus("q4");

      expect(consensus.hasQuorum).toBe(false);
      expect(consensus.recommendation).toBe("insufficient_reviews");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // requiresConsensus
  // ═══════════════════════════════════════════════════════════════

  describe("requiresConsensus", () => {
    it("returns true for all high-risk kinds", () => {
      const highRisk: Array<{ kind: string; riskDelta?: number }> = [
        { kind: "listing-edit" },
        { kind: "creative-publication" },
        { kind: "product-ads-action" },
        { kind: "cancellation" },
        { kind: "refund" },
        { kind: "honey-pot-deploy" },
        { kind: "probe-analysis" },
      ];

      for (const { kind, riskDelta } of highRisk) {
        expect(store.requiresConsensus(kind, riskDelta)).toBe(true);
      }
    });

    it("returns false for 3 low-risk kinds (regardless of riskDelta)", () => {
      const lowRisk = ["info-report", "catalog-health", "restock-signal"];

      for (const kind of lowRisk) {
        expect(store.requiresConsensus(kind)).toBe(false);
        expect(store.requiresConsensus(kind, 0.99)).toBe(false);
      }
    });

    it("price-change at 25% returns true", () => {
      expect(store.requiresConsensus("price-change", 0.25)).toBe(true);
    });

    it("price-change at 10% returns false", () => {
      expect(store.requiresConsensus("price-change", 0.1)).toBe(false);
    });

    it("price-change at exactly 20% returns false", () => {
      expect(store.requiresConsensus("price-change", 0.2)).toBe(false);
    });

    it("price-change without riskDelta returns true (default: requires consensus)", () => {
      expect(store.requiresConsensus("price-change")).toBe(true);
    });

    it("returns false for unknown kind", () => {
      expect(store.requiresConsensus("nonexistent-kind")).toBe(false);
    });
  });
});
