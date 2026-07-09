import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createAgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import type { AgentMessageBusStore } from "../../src/conversation/agentMessageBusStore.js";
import { createWebhookIngestor } from "../../src/conversation/webhookIngestor.js";
import type { WebhookIngestor } from "../../src/conversation/webhookIngestor.js";

let db: Database.Database;
let bus: AgentMessageBusStore;
let ingestor: WebhookIngestor;

beforeEach(() => {
  db = new Database(":memory:");
  bus = createAgentMessageBusStore(db);
  ingestor = createWebhookIngestor(bus);
});

afterEach(() => {
  db.close();
});

describe("webhookIngestor", () => {
  describe("handle()", () => {
    it("returns 202 for valid order notification", () => {
      const response = ingestor.handle({
        topic: "orders",
        resource: "order-42",
        user_id: 123,
        received: new Date().toISOString(),
      });

      expect(response.status).toBe(202);
      expect(response.body.status).toBe("accepted");
      expect(response.body.messageId).toBeTruthy();
    });

    it("returns 202 for valid question notification", () => {
      const response = ingestor.handle({
        topic: "questions",
        resource: "question-99",
        user_id: 123,
        received: new Date().toISOString(),
      });

      expect(response.status).toBe(202);
      expect(response.body.status).toBe("accepted");
    });

    it("returns 202 for valid claims notification", () => {
      const response = ingestor.handle({
        topic: "claims",
        resource: "claim-7",
        user_id: 123,
        received: new Date().toISOString(),
      });

      expect(response.status).toBe(202);
    });

    it("returns 202 for valid items notification", () => {
      const response = ingestor.handle({
        topic: "items",
        resource: "MLC123",
        user_id: 123,
        received: new Date().toISOString(),
      });

      expect(response.status).toBe(202);
    });

    it("returns 202 for valid shipments notification", () => {
      const response = ingestor.handle({
        topic: "shipments",
        resource: "ship-456",
        user_id: 123,
        received: new Date().toISOString(),
      });

      expect(response.status).toBe(202);
    });

    it("returns 400 for non-object payload", () => {
      const response = ingestor.handle("not-an-object");
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Invalid payload");
    });

    it("returns 400 for missing topic", () => {
      const response = ingestor.handle({
        resource: "order-42",
        user_id: 123,
      });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("topic");
    });

    it("returns 400 for missing resource", () => {
      const response = ingestor.handle({
        topic: "orders",
        user_id: 123,
      });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("resource");
    });

    it("routes unknown topic to CEO lane", () => {
      const response = ingestor.handle({
        topic: "unknown-topic",
        resource: "res-1",
        user_id: 123,
        received: new Date().toISOString(),
      });

      expect(response.status).toBe(202);

      // Verify the message was enqueued to CEO
      const ceoMessages = bus.claimNext("ceo");
      expect(ceoMessages.length).toBe(1);
      expect(ceoMessages[0]!.messageType).toBe("ml-webhook:unknown-topic");
    });

    it("deduplicates identical resource+topic within window", () => {
      // First delivery
      const first = ingestor.handle({
        topic: "orders",
        resource: "dedup-order",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(first.status).toBe(202);

      // Second delivery (same resource+topic)
      const second = ingestor.handle({
        topic: "orders",
        resource: "dedup-order",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(second.status).toBe(200); // Duplicate
      expect(second.body.status).toBe("duplicate");
    });

    it("enqueues to correct lane based on topic", () => {
      ingestor.handle({
        topic: "items",
        resource: "MLC999",
        user_id: 123,
        received: new Date().toISOString(),
      });

      // Should go to market-catalog for items topic
      const catalogMsgs = bus.claimNext("market-catalog");
      expect(catalogMsgs.length).toBe(1);
      expect(catalogMsgs[0]!.messageType).toBe("ml-webhook:items");
    });

    it("allows different resources with same topic", () => {
      const r1 = ingestor.handle({
        topic: "orders",
        resource: "order-1",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(r1.status).toBe(202);

      const r2 = ingestor.handle({
        topic: "orders",
        resource: "order-2",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(r2.status).toBe(202); // Different resource, not a duplicate
    });
  });

  describe("rate limiting", () => {
    it("returns 429 when rate limit exceeded", () => {
      // Send 100 requests for the same topic (the limit)
      for (let i = 0; i < 100; i++) {
        const response = ingestor.handle({
          topic: "orders",
          resource: `order-${i}`,
          user_id: 123,
          received: new Date().toISOString(),
        });
        expect(response.status).toBe(202);
      }

      // The 101st should be rate-limited
      const rateLimited = ingestor.handle({
        topic: "orders",
        resource: "order-overflow",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(rateLimited.status).toBe(429);
      expect(rateLimited.headers?.["Retry-After"]).toBe("60");
    });

    it("allows different topics independently for rate limiting", () => {
      // Fill up orders topic
      for (let i = 0; i < 100; i++) {
        ingestor.handle({
          topic: "orders",
          resource: `order-${i}`,
          user_id: 123,
          received: new Date().toISOString(),
        });
      }

      // Different topic should still work
      const questions = ingestor.handle({
        topic: "questions",
        resource: "q-1",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(questions.status).toBe(202);
    });
  });

  describe("custom topic map", () => {
    it("uses custom topic mapping when provided", () => {
      const customIngestor = createWebhookIngestor(bus, {
        orders: "ceo",
      });

      const response = customIngestor.handle({
        topic: "orders",
        resource: "order-custom",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(response.status).toBe(202);

      // Should be in CEO lane per custom map
      const ceoMsgs = bus.claimNext("ceo");
      expect(ceoMsgs.length).toBe(1);
      expect(ceoMsgs[0]!.messageType).toBe("ml-webhook:orders");
    });

    it("falls back to CEO for unmapped topics in custom map", () => {
      const customIngestor = createWebhookIngestor(bus, {
        orders: "ceo",
      });

      const response = customIngestor.handle({
        topic: "completely-unknown-topic",
        resource: "unknown-res",
        user_id: 123,
        received: new Date().toISOString(),
      });
      expect(response.status).toBe(202);

      // Unmapped (not in default or custom map) should fall through to CEO
      const ceoMsgs = bus.claimNext("ceo");
      expect(ceoMsgs.length).toBe(1);
    });
  });
});
