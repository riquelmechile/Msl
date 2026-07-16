import { describe, it, expect, vi } from "vitest";
import { specTechnician } from "./specTechnician.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";
import type { MlcApiClient } from "@msl/mercadolibre";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  return {
    id: 1,
    messageId: "msg-spec-1",
    senderAgentId: "copywriter",
    receiverAgentId: "listing-composition",
    messageType: "finding",
    payloadJson: JSON.stringify({
      categoryId: "MLC1743",
      brand: "Apple",
      model: "Watch Ultra 2",
      color: "Titanium",
      sellerId: "plasticov",
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
    sellerId: "plasticov",
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

function makeMockMlcClient(attributes?: unknown[]): MlcApiClient {
  return {
    getListings: vi.fn().mockResolvedValue({ data: [] }),
    getItem: vi.fn().mockResolvedValue({}),
    getOrders: vi.fn().mockResolvedValue({ data: [] }),
    getReputation: vi.fn().mockResolvedValue({ data: {} }),
    getMessages: vi.fn().mockResolvedValue({ data: [] }),
    getCategoryAttributes: vi.fn().mockResolvedValue({
      data: attributes ?? mockCelularesAttributes(),
    }),
    getCategoryTechnicalSpecs: vi.fn().mockResolvedValue({ data: {} }),
  };
}

function mockCelularesAttributes() {
  return [
    {
      id: "BRAND",
      name: "Marca",
      valueType: "string",
      required: true,
      catalogRequired: true,
      variationAttribute: false,
      readOnly: false,
      values: [
        { id: "123", name: "Apple" },
        { id: "456", name: "Samsung" },
      ],
      units: [],
    },
    {
      id: "MODEL",
      name: "Modelo",
      valueType: "string",
      required: true,
      catalogRequired: true,
      variationAttribute: false,
      readOnly: false,
      values: [],
      units: [],
    },
    {
      id: "COLOR",
      name: "Color principal",
      valueType: "string",
      required: true,
      catalogRequired: false,
      variationAttribute: true,
      readOnly: false,
      values: [],
      units: [],
    },
    {
      id: "SCREEN_SIZE",
      name: "Tamaño de pantalla",
      valueType: "string",
      required: true,
      catalogRequired: false,
      variationAttribute: false,
      readOnly: false,
      values: [],
      units: ["pulgadas"],
    },
    {
      id: "RAM",
      name: "Memoria RAM",
      valueType: "string",
      required: true,
      catalogRequired: false,
      variationAttribute: false,
      readOnly: false,
      values: [],
      units: ["GB"],
    },
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("specTechnician", () => {
  describe("stub mode (no mlcClient)", () => {
    it("returns mock attribute schema when mlcClient is not provided", async () => {
      const bus = makeBus();
      const result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      expect(result.proposalEnqueued).toBe(true);
      expect(result.findings.length).toBe(1);

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;
      const attrs = specValidation.requiredAttributes as Array<Record<string, unknown>>;
      expect(attrs.length).toBeGreaterThanOrEqual(2);
      expect(specValidation.completenessPercent).toBe(100);
      expect(specValidation.missingAttributes).toEqual([]);
    });

    it("includes color attribute in stub mode when provided", async () => {
      const bus = makeBus();
      const _result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;
      const attrs = specValidation.requiredAttributes as Array<Record<string, unknown>>;
      const colorAttr = attrs.find((a) => a.id === "COLOR");
      expect(colorAttr).toBeDefined();
      expect(colorAttr!.valueName).toBe("Titanium");
    });
  });

  describe("input validation", () => {
    it("returns alert for invalid JSON payload", async () => {
      const bus = makeBus();
      const result = await specTechnician({
        claim: makeClaim({ payloadJson: "not-json" }),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings.length).toBe(1);
      expect(result.findings[0]!.summary).toContain("invalid payload");
    });

    it("returns alert for missing categoryId", async () => {
      const bus = makeBus();
      const claim = makeClaim({
        payloadJson: JSON.stringify({ brand: "Apple", model: "Watch" }),
      });

      const result = await specTechnician({
        claim,
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
      });

      expect(result.proposalEnqueued).toBe(false);
      expect(result.findings[0]!.summary).toContain("missing categoryId");
    });
  });

  describe("with mlcClient", () => {
    it("maps brand and model to ML attribute values", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient();

      const _result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
        mlcClient: mockMlcClient,
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;
      const attrs = specValidation.requiredAttributes as Array<Record<string, unknown>>;

      const brandAttr = attrs.find((a) => a.id === "BRAND");
      expect(brandAttr).toBeDefined();
      expect(brandAttr!.valueId).toBe("123"); // matched Apple in values
      expect(brandAttr!.name).toBe("Marca");

      const modelAttr = attrs.find((a) => a.id === "MODEL");
      expect(modelAttr).toBeDefined();
      expect(modelAttr!.name).toBe("Modelo");
    });

    it("detects missing required attributes", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient();

      const _result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
        mlcClient: mockMlcClient,
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;

      // SCREEN_SIZE and RAM should be missing (we didn't provide them in input)
      const missing = specValidation.missingAttributes as string[];
      expect(missing).toContain("Tamaño de pantalla");
      expect(missing).toContain("Memoria RAM");
    });

    it("skips variation attributes even if required", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient();

      const _result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
        mlcClient: mockMlcClient,
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;
      const attrs = specValidation.requiredAttributes as Array<Record<string, unknown>>;

      // COLOR is a variation_attribute → should be skipped in requiredAttributes output
      const colorAttr = attrs.find((a) => a.id === "COLOR");
      expect(colorAttr).toBeUndefined();
    });

    it("handles mlcClient error gracefully with stub fallback", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient();
      (mockMlcClient.getCategoryAttributes as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("API error"),
      );

      const result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
        mlcClient: mockMlcClient,
      });

      expect(result.proposalEnqueued).toBe(true);
      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;
      expect(specValidation.completenessPercent).toBe(100); // stub always 100%
    });

    it("computes completeness percentage correctly with missing attrs", async () => {
      const bus = makeBus();
      const mockMlcClient = makeMockMlcClient();

      const _result = await specTechnician({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: bus as never,
        sellerIds: ["plasticov"],
        mlcClient: mockMlcClient,
      });

      const enqueued = bus.enqueued[0]!;
      const payload = JSON.parse(enqueued.payloadJson) as Record<string, unknown>;
      const specValidation = payload.specValidation as Record<string, unknown>;

      // 4 required non-variation attrs (BRAND, MODEL, SCREEN_SIZE, RAM)
      // BRAND + MODEL mapped = 2/4 = 50%
      // Actually let me recount: we have 5 attrs total. COLOR is variation (skip).
      // Remaining required: BRAND, MODEL, SCREEN_SIZE, RAM = 4
      // Mapped: BRAND + MODEL = 2. Completeness = 2/4 * 100 = 50%
      expect(specValidation.completenessPercent).toBe(50);

      const missing = specValidation.missingAttributes as string[];
      expect(missing.length).toBe(2);
    });
  });
});
