import { describe, expect, it, vi } from "vitest";
import { EcommerceEvidenceRequestPlanner } from "./ecommerceEvidenceRequestPlanner.js";
import type { AgentMessage, AgentMessageBusStore } from "../conversation/agentMessageBusStore.js";
import type { MissingEvidenceReport } from "./ownedEcommerceMerchandisingAdvisor.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeReport(overrides: Partial<MissingEvidenceReport> = {}): MissingEvidenceReport {
  return {
    category: "cost",
    severity: "medium",
    description: "Missing cost data for accurate margin calculation.",
    candidateId: "cand-1",
    targetAgentId: "cost-supplier",
    question: "What is the current supplier cost for this product?",
    ...overrides,
  };
}

/** Creates a fake message bus that captures enqueued messages in memory. */
function makeCapturingBus(): { bus: AgentMessageBusStore; messages: AgentMessage[] } {
  const messages: AgentMessage[] = [];
  let nextId = 1;

  const bus: AgentMessageBusStore = {
    enqueue: (input) => {
      const msg: AgentMessage = {
        id: nextId++,
        messageId: `msg-${nextId - 1}`,
        senderAgentId: input.senderAgentId,
        receiverAgentId: input.receiverAgentId,
        messageType: input.messageType,
        payloadJson: input.payloadJson,
        status: "pending",
        priority: input.priority ?? 5,
        attempts: 0,
        dedupeKey: input.dedupeKey ?? null,
        lockedAt: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resultJson: null,
        errorJson: null,
        cancelReason: null,
        correlationId: input.correlationId ?? null,
        parentMessageId: input.parentMessageId ?? null,
        sellerId: input.sellerId ?? null,
        learnedAt: null,
        outcomeScore: null,
        actionId: input.actionId ?? null,
      };
      messages.push(msg);
      return msg;
    },
    claimNext: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
    reenqueueFailed: vi.fn(),
    getProcessingStuck: vi.fn().mockReturnValue([]),
    getPendingCount: vi.fn().mockReturnValue(0),
    getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
    getLearningHistory: vi.fn().mockReturnValue([]),
    recordOutcome: vi.fn(),
    getUnscoredMessages: vi.fn().mockReturnValue([]),
  };

  return { bus, messages };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("EcommerceEvidenceRequestPlanner", () => {
  describe("message generation by target agent", () => {
    // Test 11: Generates request to cost-supplier for missing margin
    it("generates request to cost-supplier for missing margin", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const requests = [
        makeReport({
          category: "cost",
          severity: "high",
          targetAgentId: "cost-supplier",
          question: "What is the supplier cost in USD?",
        }),
      ];

      const messages = planner.planRequests(requests, "cand-1");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.targetAgentId).toBe("cost-supplier");
      expect(messages[0]!.priority).toBe("high");
      expect(messages[0]!.question).toContain("supplier cost");
      expect(messages[0]!.messageHash).toHaveLength(64); // sha256 hex
      expect(messages[0]!.timestamp).toBeGreaterThan(0);
    });

    // Test 12: Generates request to creative-assets for missing image
    it("generates request to creative-assets for missing image", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const requests = [
        makeReport({
          category: "images",
          severity: "medium",
          targetAgentId: "creative-assets",
          question: "Are product images available for this SKU?",
        }),
      ];

      const messages = planner.planRequests(requests, "cand-2");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.targetAgentId).toBe("creative-assets");
      expect(messages[0]!.priority).toBe("medium");
      expect(messages[0]!.question).toContain("product images");
    });

    // Test 13: Generates request to market-catalog for competition data
    it("generates request to market-catalog for competition data", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const requests = [
        makeReport({
          category: "competition",
          severity: "medium",
          targetAgentId: "market-catalog",
          question: "What is the current market price range for this category?",
        }),
      ];

      const messages = planner.planRequests(requests, "cand-3");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.targetAgentId).toBe("market-catalog");
      expect(messages[0]!.reason).toContain("Missing cost data");
    });

    // Test 14: Generates request to account-brain for channel recommendation
    it("generates request to account-brain for channel recommendation", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const requests = [
        makeReport({
          category: "account",
          severity: "low",
          targetAgentId: "account-brain",
          question: "Which account is better suited for this product?",
        }),
      ];

      const messages = planner.planRequests(requests, "cand-4");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.targetAgentId).toBe("account-brain");
      expect(messages[0]!.priority).toBe("low");
    });
  });

  describe("deduplication", () => {
    // Test 15: Same candidateId + targetAgentId + question → only one message
    it("deduplicates: same candidateId, targetAgentId, and question produces only one message", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const request = makeReport({
        question: "What is the cost?",
        targetAgentId: "cost-supplier",
      });

      // Pass the same request twice (simulating duplicate reports)
      const messages = planner.planRequests([request, { ...request }], "cand-1");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.messageHash).toHaveLength(64);
    });

    // Test 16: Different questions → separate messages
    it("generates separate messages for different questions", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const req1 = makeReport({
        question: "What is the supplier cost?",
        targetAgentId: "cost-supplier",
      });
      const req2 = makeReport({
        question: "What is the shipping cost?",
        targetAgentId: "cost-supplier",
      });

      const messages = planner.planRequests([req1, req2], "cand-1");

      expect(messages).toHaveLength(2);
      expect(messages[0]!.messageHash).not.toBe(messages[1]!.messageHash);
    });
  });

  describe("no-op when no messageBus", () => {
    // Test 17: No-op when no messageBus (returns messages without sending)
    it("returns messages without sending when no messageBus", () => {
      const planner = new EcommerceEvidenceRequestPlanner(); // no bus
      const requests = [
        makeReport({ targetAgentId: "cost-supplier" }),
        makeReport({ targetAgentId: "creative-assets", question: "Images?" }),
      ];

      const messages = planner.planRequests(requests, "cand-1");

      // Messages are returned — no side effects
      expect(messages).toHaveLength(2);
      expect(messages[0]!.targetAgentId).toBe("cost-supplier");
      expect(messages[1]!.targetAgentId).toBe("creative-assets");
    });

    it("does not throw when planner has no messageBus", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const requests = [makeReport()];

      expect(() => planner.planRequests(requests, "cand-1")).not.toThrow();
    });
  });

  describe("seller isolation", () => {
    // Test 18: Messages tagged with sellerId context when bus is available
    it("tags enqueued messages with sellerId context", () => {
      const { bus, messages } = makeCapturingBus();
      const planner = new EcommerceEvidenceRequestPlanner({ messageBus: bus });

      const requests = [
        makeReport({
          candidateId: "cand-seller-plasticov",
          targetAgentId: "cost-supplier",
          question: "What is the supplier cost?",
        }),
      ];

      planner.planRequests(requests, "cand-seller-plasticov");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.sellerId).toBe("cand-seller-plasticov");
      expect(messages[0]!.senderAgentId).toBe("merchandising-advisor");
      expect(messages[0]!.receiverAgentId).toBe("cost-supplier");
      expect(messages[0]!.messageType).toBe("evidence-request");
    });

    it("enqueues messages via fire-and-forget without throwing on bus failure", () => {
      // Create a bus whose enqueue throws
      const throwingBus: AgentMessageBusStore = {
        enqueue: () => {
          throw new Error("Simulated bus failure");
        },
        claimNext: vi.fn().mockReturnValue([]),
        resolve: vi.fn(),
        fail: vi.fn(),
        cancel: vi.fn(),
        lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
        getFailedMessages: vi.fn().mockReturnValue([]),
        reenqueueFailed: vi.fn(),
        getProcessingStuck: vi.fn().mockReturnValue([]),
        getPendingCount: vi.fn().mockReturnValue(0),
        getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
        getLearningHistory: vi.fn().mockReturnValue([]),
        recordOutcome: vi.fn(),
        getUnscoredMessages: vi.fn().mockReturnValue([]),
      };

      const planner = new EcommerceEvidenceRequestPlanner({ messageBus: throwingBus });
      const requests = [makeReport()];

      // Should NOT throw — fire-and-forget
      const messages = planner.planRequests(requests, "cand-1");
      expect(messages).toHaveLength(1);
      // Messages still returned even though bus threw
      expect(messages[0]!.targetAgentId).toBe("cost-supplier");
    });
  });

  describe("supplier-manager routing", () => {
    it("routes to supplier-manager for stale supplier freshness", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const requests = [
        makeReport({
          category: "cortex",
          severity: "high",
          targetAgentId: "supplier-manager",
          question: "Is the supplier data still fresh? Last update was 30 days ago.",
          description: "Supplier freshness is stale — needs refresh.",
        }),
      ];

      const messages = planner.planRequests(requests, "cand-stale");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.targetAgentId).toBe("supplier-manager");
      expect(messages[0]!.priority).toBe("high");
    });
  });

  describe("clock dependency", () => {
    it("uses provided clock for timestamps", () => {
      const fixedDate = new Date("2026-07-10T12:00:00Z");
      const clock = { now: () => fixedDate };
      const planner = new EcommerceEvidenceRequestPlanner({ clock });

      const messages = planner.planRequests([makeReport()], "cand-1");

      expect(messages[0]!.timestamp).toBe(fixedDate.getTime());
    });

    it("uses system clock when no clock provided", () => {
      const planner = new EcommerceEvidenceRequestPlanner();
      const before = Date.now();
      const messages = planner.planRequests([makeReport()], "cand-1");
      const after = Date.now();

      expect(messages[0]!.timestamp).toBeGreaterThanOrEqual(before);
      expect(messages[0]!.timestamp).toBeLessThanOrEqual(after);
    });
  });
});
