import { describe, it, expect, vi } from "vitest";
import { catalogSpecialist } from "./catalogSpecialist.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";
import type { MlcApiClient, MlcListingSummary } from "@msl/mercadolibre";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-catalog-1",
    senderAgentId: "product-recognition",
    receiverAgentId: "product-research",
    messageType: "finding",
    payloadJson: JSON.stringify({
      brand: "Apple",
      model: "Watch Ultra 2",
      title: "Apple Watch Ultra 2 Titanium",
      sellerId: "test-seller",
    }),
    status: "pending",
    priority: 0,
    attempts: 0,
    dedupeKey: null,
    lockedAt: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    resultJson: null,
    errorJson: null,
    cancelReason: null,
    correlationId: null,
    parentMessageId: null,
    sellerId: "test-seller",
    learnedAt: null,
    outcomeScore: null,
    actionId: null,
    ...overrides,
  };
}

function makeBus() {
  const enqueued: Array<{
    senderAgentId: string;
    receiverAgentId: string;
    messageType: string;
    payloadJson: string;
    dedupeKey?: string;
  }> = [];
  return {
    enqueue: vi.fn(
      (input: {
        senderAgentId: string;
        receiverAgentId: string;
        messageType: string;
        payloadJson: string;
        dedupeKey?: string;
      }) => {
        enqueued.push(input);
        return { messageId: `bus-msg-${enqueued.length}` };
      },
    ),
    enqueued,
    claimNext: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
  };
}

function makeMockMlcClient(overrides?: Partial<MlcApiClient>): MlcApiClient {
  return {
    getListings: vi.fn().mockResolvedValue({
      data: [] as ReadonlyArray<MlcListingSummary>,
    }),
    getItem: vi.fn().mockResolvedValue({}),
    getOrders: vi.fn().mockResolvedValue({ data: [] }),
    getReputation: vi.fn().mockResolvedValue({ data: {} }),
    getMessages: vi.fn().mockResolvedValue({ data: [] }),
    getCategoryAttributes: vi.fn().mockResolvedValue({ data: {} }),
    getCategoryTechnicalSpecs: vi.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("catalogSpecialist", () => {
  describe("stub mode (no mlcClient)", () => {
    it("returns found: false when mlcClient is not provided", async () => {
      const bus = makeBus();
      const result = await catalogSpecialist({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.summary).toContain("not found");

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const catalogResult = payload.catalogResult as Record<string, unknown>;
      expect(catalogResult.found).toBe(false);
    });
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await catalogSpecialist({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      const f = result.findings[0]!;
      expect(f.severity).toBe("warning");
      expect(f.summary).toContain("invalid payload");
    });
  });

  describe("with mlcClient", () => {
    it("returns catalog product ID when matching listing + getItem finds it", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient({
        getListings: vi.fn().mockResolvedValue({
          data: [
            {
              id: "MLC123",
              title: "Apple Watch Ultra 2 Titanium GPS + Cellular 49mm",
              status: "active",
            },
          ] as ReadonlyArray<MlcListingSummary>,
        }),
        getItem: vi.fn().mockResolvedValue({
          catalog_product_id: "MLC6005934",
          id: "MLC123",
        }),
      });

      const result = await catalogSpecialist({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
        mlcClient: mockMlcClient,
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.summary).toContain("found");

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const catalogResult = payload.catalogResult as Record<string, unknown>;
      expect(catalogResult.found).toBe(true);
      expect(catalogResult.catalogProductId).toBe("MLC6005934");
    });

    it("returns not found when no matching listing exists", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient({
        getListings: vi.fn().mockResolvedValue({
          data: [
            {
              id: "MLC456",
              title: "Samsung Galaxy Watch 7",
              status: "active",
            },
          ] as ReadonlyArray<MlcListingSummary>,
        }),
      });

      const _result = await catalogSpecialist({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
        mlcClient: mockMlcClient,
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const catalogResult = payload.catalogResult as Record<string, unknown>;
      expect(catalogResult.found).toBe(false);
    });

    it("handles mlcClient error gracefully by returning not found", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient({
        getListings: vi.fn().mockRejectedValue(new Error("API error")),
      });

      const result = await catalogSpecialist({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["test-seller"],
        mlcClient: mockMlcClient,
      });

      expect(result.proposalEnqueued).toBe(true);
      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const catalogResult = payload.catalogResult as Record<string, unknown>;
      expect(catalogResult.found).toBe(false);
    });
  });
});
