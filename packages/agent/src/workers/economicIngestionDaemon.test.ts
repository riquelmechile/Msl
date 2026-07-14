import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEconomicIngestionDaemon } from "./economicIngestionDaemon.js";
import type { EconomicIngestionRuntime } from "../economics/factory.js";
import type { AgentMessage } from "../conversation/agentMessageBusStore.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createDurableRuntime(
  sellerSlug: "source" | "target" = "source",
  numericSellerId = "plasticov",
): EconomicIngestionRuntime {
  const sellerId = sellerSlug === "source" ? "plasticov" : "maustian";
  return {
    pipeline: vi.fn().mockResolvedValue({
      run: {
        runId: "economic-ingestion-daemon-run",
        sellerId,
        status: "completed",
        checkpointAfter: "order-1",
        noExternalMutationExecuted: true,
      },
      snapshots: [{}],
      reconciliation: { status: "balanced", details: "balanced" },
    }),
    health: { sellerId, numericSellerId, sellerSlug },
    close: vi.fn(),
  } as unknown as EconomicIngestionRuntime;
}

function makeClaim(overrides?: Partial<AgentMessage>): AgentMessage {
  const sellerId = overrides?.sellerId ?? "plasticov";
  return {
    id: 1,
    messageId: "msg-1",
    senderAgentId: "system",
    receiverAgentId: "economic-ingestion",
    messageType: "daemon-tick",
    payloadJson: JSON.stringify({ cycleTimestamp: new Date().toISOString(), sellerId }),
    status: "pending",
    priority: 0,
    attempts: 0,
    dedupeKey: "test-tick",
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("economicIngestionDaemon", () => {
  beforeEach(() => {
    delete (process.env as Record<string, string | undefined>).MSL_ECONOMIC_INGESTION_ENABLED;
  });

  describe("feature gate off", () => {
    it("returns empty result when enabled flag is false", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: false,
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings).toHaveLength(0);
      expect(result.proposalEnqueued).toBe(false);
    });

    it("returns empty result when env var is not 'true'", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings).toHaveLength(0);
      expect(result.proposalEnqueued).toBe(false);
    });
  });

  describe("feature gate on", () => {
    beforeEach(() => {
      process.env.MSL_ECONOMIC_INGESTION_ENABLED = "true";
    });

    it("runs pipeline and returns findings", async () => {
      const runtime = createDurableRuntime("source", "1001");
      const runtimeFactory = vi.fn().mockReturnValue(runtime);
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        sellerRoutes: new Map([["1001", "source"]]),
        runtimeFactory,
      });

      const result = await handler({
        claim: makeClaim({ sellerId: "1001" }),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0]!.kind).toBe("info");
      expect(result.findings[0]!.summary).toContain("1001");
      expect(result.findings[0]!.summary).toContain("noExternalMutationExecuted=true");
      expect(runtimeFactory).toHaveBeenCalledWith("source");
      expect(runtime.pipeline).toHaveBeenCalledWith(expect.objectContaining({ noPersist: false }));
      expect(runtime.close).toHaveBeenCalledOnce();
    });

    it("alerts when seller cannot select a durable runtime", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
      });

      const result = await handler({
        claim: makeClaim({ sellerId: "unknown-seller" }),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      expect(result.findings[0]!.kind).toBe("alert");
      expect(result.findings[0]!.summary).toContain("durable runtime");
    });

    it("redacts PII, credentials, raw payloads, and stack paths from daemon errors", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        runtimeFactory: vi.fn(() => {
          throw new Error(
            "buyer@example.com token=secret-value raw_payload=private /home/user/app.ts\n    at run (/home/user/app.ts:1:1)",
          );
        }),
      });

      const result = await handler({
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      });

      const summary = result.findings[0]!.summary;
      expect(summary).not.toMatch(/buyer@example\.com|secret-value|private|\/home\/|\bat\s/);
      expect(summary).toContain("[email]");
    });

    it("routes a target tick from its claimed seller", async () => {
      const runtime = createDurableRuntime("target", "1002");
      const runtimeFactory = vi.fn().mockReturnValue(runtime);
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        sellerRoutes: new Map([["1002", "target"]]),
        runtimeFactory,
      });

      const result = await handler({
        claim: makeClaim({ sellerId: "1002" }),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov", "maustian"],
      });

      expect(result.findings[0]!.summary).toContain("1002");
      expect(runtimeFactory).toHaveBeenCalledWith("target");
      expect(runtime.pipeline).toHaveBeenCalledWith(
        expect.objectContaining({ sellerId: "maustian" }),
      );
    });
  });

  describe("idempotency / checkpoint", () => {
    beforeEach(() => {
      process.env.MSL_ECONOMIC_INGESTION_ENABLED = "true";
    });

    it("can be called multiple times without errors", async () => {
      const handler = createEconomicIngestionDaemon({
        enabled: true,
        runtimeFactory: vi.fn().mockReturnValue(createDurableRuntime()),
      });

      const ctx = {
        claim: makeClaim(),
        reader: {} as never,
        cortex: {} as never,
        bus: {} as never,
        sellerIds: ["plasticov"],
      };

      const result1 = await handler(ctx);
      const result2 = await handler(ctx);

      expect(result1.findings.length).toBeGreaterThan(0);
      expect(result2.findings.length).toBeGreaterThan(0);
    });
  });
});
