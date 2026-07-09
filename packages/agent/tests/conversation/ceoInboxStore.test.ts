import Database from "better-sqlite3";
import { describe, expect, it, beforeEach } from "vitest";

import {
  createCeoInboxStore,
  type CeoInboxStore,
  type AgentProposalRow,
} from "../../src/conversation/ceoInboxStore.js";

// ── Setup ────────────────────────────────────────────────────────────

describe("ceoInboxStore", () => {
  let db: Database.Database;
  let store: CeoInboxStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    store = createCeoInboxStore(db);
  });

  // ── insert ─────────────────────────────────────────────────────────

  describe("insert", () => {
    it("inserts a proposal and returns it with defaults", () => {
      const result = store.insert({
        sender_agent_id: "morning-report",
        proposal_type: "briefing",
        payload_json: JSON.stringify({ summary: "test" }),
        normalized_summary: "Morning briefing test",
        seller_id: "seller-1",
      });

      expect(result).toBeDefined();
      expect(result.proposal_id).toBeTruthy();
      expect(result.sender_agent_id).toBe("morning-report");
      expect(result.proposal_type).toBe("briefing");
      expect(result.normalized_summary).toBe("Morning briefing test");
      expect(result.risk_level).toBe("low");
      expect(result.status).toBe("pending");
      expect(result.seller_id).toBe("seller-1");
      expect(result.routed_to).toBeNull();
      expect(typeof result.id).toBe("number");
      expect(typeof result.created_at).toBe("string");
      expect(typeof result.updated_at).toBe("string");
    });

    it("accepts explicit risk_level and routed_to", () => {
      const result = store.insert({
        sender_agent_id: "eod-summary",
        proposal_type: "summary",
        payload_json: JSON.stringify({ summary: "eod" }),
        risk_level: "high",
        seller_id: "seller-2",
        routed_to: "telegram",
      });

      expect(result.risk_level).toBe("high");
      expect(result.routed_to).toBe("telegram");
    });

    it("returns existing proposal on duplicate proposal_id", () => {
      const first = store.insert({
        proposal_id: "dup-001",
        sender_agent_id: "morning-report",
        proposal_type: "briefing",
        payload_json: JSON.stringify({ summary: "first" }),
        seller_id: "seller-1",
      });

      const second = store.insert({
        proposal_id: "dup-001",
        sender_agent_id: "eod-summary",
        proposal_type: "summary",
        payload_json: JSON.stringify({ summary: "second" }),
        seller_id: "seller-2",
      });

      // Should return the first row unchanged
      expect(second.proposal_id).toBe(first.proposal_id);
      expect(second.sender_agent_id).toBe(first.sender_agent_id);
      expect(second.normalized_summary).toBe(first.normalized_summary);
    });
  });

  // ── listByStatus ───────────────────────────────────────────────────

  describe("listByStatus", () => {
    it("returns only proposals with matching status", () => {
      store.insert({
        sender_agent_id: "a",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-1",
      });
      store.insert({
        sender_agent_id: "b",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-2",
      });

      const pending = store.listByStatus("pending");
      expect(pending.length).toBe(2);

      const routed = store.listByStatus("routed");
      expect(routed.length).toBe(0);
    });

    it("returns all proposals when status is omitted", () => {
      store.insert({
        sender_agent_id: "a",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-1",
      });
      store.insert({
        sender_agent_id: "b",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-2",
      });

      const all = store.listByStatus();
      expect(all.length).toBe(2);
    });
  });

  // ── getBySellerId ──────────────────────────────────────────────────

  describe("getBySellerId", () => {
    it("returns proposals for matching seller only", () => {
      store.insert({
        sender_agent_id: "a",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-1",
      });
      store.insert({
        sender_agent_id: "b",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-1",
      });
      store.insert({
        sender_agent_id: "c",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-2",
      });

      const forSeller1 = store.getBySellerId("seller-1");
      expect(forSeller1.length).toBe(2);

      const forSeller2 = store.getBySellerId("seller-2");
      expect(forSeller2.length).toBe(1);

      const forUnknown = store.getBySellerId("seller-unknown");
      expect(forUnknown.length).toBe(0);
    });
  });

  // ── routeToTelegram ──────────────────────────────────────────────

  describe("routeToTelegram", () => {
    it("updates status to routed and sets routed_to with chat info", () => {
      const proposal = store.insert({
        sender_agent_id: "morning-report",
        proposal_type: "briefing",
        payload_json: JSON.stringify({ summary: "test" }),
        seller_id: "seller-1",
      });

      const routed = store.routeToTelegram(proposal.proposal_id, "chat-123");

      expect(routed.status).toBe("routed");
      expect(routed.routed_to).toBe("telegram:chat-123");
      expect(routed.proposal_id).toBe(proposal.proposal_id);
    });

    it("includes thread_id in routed_to when provided", () => {
      const proposal = store.insert({
        sender_agent_id: "eod-summary",
        proposal_type: "summary",
        payload_json: JSON.stringify({ summary: "eod" }),
        seller_id: "seller-2",
      });

      const routed = store.routeToTelegram(proposal.proposal_id, "chat-456", "thread-789");

      expect(routed.status).toBe("routed");
      expect(routed.routed_to).toBe("telegram:chat-456:thread-789");
    });

    it("throws when proposal_id does not exist", () => {
      expect(() => store.routeToTelegram("nonexistent", "chat-000")).toThrow(
        /"nonexistent" not found/,
      );
    });

    it("preserves other fields after routing", () => {
      const proposal = store.insert({
        sender_agent_id: "morning-report",
        proposal_type: "briefing",
        payload_json: JSON.stringify({ summary: "preserve-test" }),
        normalized_summary: "Preserve test",
        risk_level: "high",
        seller_id: "seller-3",
      });

      const routed = store.routeToTelegram(proposal.proposal_id, "chat-999");

      expect(routed.sender_agent_id).toBe("morning-report");
      expect(routed.proposal_type).toBe("briefing");
      expect(routed.normalized_summary).toBe("Preserve test");
      expect(routed.risk_level).toBe("high");
      expect(routed.seller_id).toBe("seller-3");
    });
  });

  // ── getByStatus ──────────────────────────────────────────────────

  describe("getByStatus", () => {
    it("returns proposals with matching status", () => {
      const p1 = store.insert({
        sender_agent_id: "a",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-1",
      });
      const p2 = store.insert({
        sender_agent_id: "b",
        proposal_type: "type",
        payload_json: "{}",
        seller_id: "seller-2",
      });

      // Route p2 to change its status
      store.routeToTelegram(p2.proposal_id, "chat-1");

      const pending = store.getByStatus("pending");
      expect(pending).toHaveLength(1);
      expect(pending[0]!.proposal_id).toBe(p1.proposal_id);

      const routed = store.getByStatus("routed");
      expect(routed).toHaveLength(1);
      expect(routed[0]!.proposal_id).toBe(p2.proposal_id);
    });
  });
});
