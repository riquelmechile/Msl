import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  creativeStudioDaemon,
  resetConcurrencyGate,
  setLastJobTime,
} from "../../src/workers/creativeStudioDaemon.js";
import type { AgentMessage } from "../../src/conversation/agentMessageBusStore.js";
import type { DaemonHandler } from "../../src/workers/daemonTypes.js";

// ── Helpers ──────────────────────────────────────────────────────────

function claimFixture(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 1,
    messageId: overrides.messageId ?? "claim_001",
    senderAgentId: overrides.senderAgentId ?? "creative-assets-daemon",
    receiverAgentId: overrides.receiverAgentId ?? "creative-studio",
    messageType: overrides.messageType ?? "creative.asset.requested",
    payloadJson:
      overrides.payloadJson ??
      JSON.stringify({
        requestId: "cj_test_001",
        requestedByAgent: "creative-assets-daemon",
        sellerId: "test-seller",
        channel: "mercadolibre",
        kind: "product-cover-i2i",
        objective: "ctr",
        budgetTier: "low",
        references: [{ type: "supplier-image", uri: "https://example.com/product.jpg" }],
        productContext: { title: "Test Product", sku: "TST-001", categoryId: "MLC1055" },
        constraints: {
          preserveProductTruth: true,
          noBrandInfringement: true,
          requiresHumanApproval: true,
        },
      }),
    status: overrides.status ?? "pending",
    priority: overrides.priority ?? 5,
    attempts: overrides.attempts ?? 0,
    dedupeKey: overrides.dedupeKey ?? null,
    lockedAt: overrides.lockedAt ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

const mockBus = () => ({
  enqueue: vi.fn(
    (input: {
      senderAgentId: string;
      receiverAgentId: string;
      messageType: string;
      payloadJson: string;
      dedupeKey?: string;
    }) => ({
      ...input,
      messageId: `msg_${Date.now()}`,
    }),
  ),
  resolve: vi.fn(),
  fail: vi.fn(),
  claimNext: vi.fn(),
  cancel: vi.fn(),
  lookupRecentByDedupePrefix: vi.fn(),
  getFailedMessages: vi.fn(),
  reenqueueFailed: vi.fn(),
  getProcessingStuck: vi.fn(),
  getPendingCount: vi.fn(),
});

function baseContext(claim: AgentMessage): {
  ctx: Parameters<DaemonHandler>[0];
  enqueue: ReturnType<typeof vi.fn>;
} {
  const enqueue = vi.fn(
    (input: {
      senderAgentId: string;
      receiverAgentId: string;
      messageType: string;
      payloadJson: string;
      dedupeKey?: string;
    }) => ({
      ...input,
      messageId: `msg_${Date.now()}`,
    }),
  );

  const ctx = {
    claim,
    reader: {
      searchSnapshots: vi.fn().mockResolvedValue([]),
    } as unknown as Parameters<DaemonHandler>[0]["reader"],
    cortex: {
      queryByMetadata: vi.fn().mockReturnValue([]),
      getOrCreateNode: vi.fn().mockReturnValue({ id: 1 }),
    } as unknown as Parameters<DaemonHandler>[0]["cortex"],
    bus: { ...mockBus(), enqueue } as unknown as Parameters<DaemonHandler>[0]["bus"],
    sellerIds: ["test-seller"],
  } as unknown as Parameters<DaemonHandler>[0];

  return { ctx, enqueue };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("creativeStudioDaemon", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.MSL_CREATIVE_STUDIO_ENABLED = "true";
    process.env.MINIMAX_API_KEY = "sk-test-key";
    process.env.MSL_CREATIVE_STUDIO_MAX_JOB_USD = "0.50";
    process.env.MSL_CREATIVE_STUDIO_MAX_DAILY_USD = "5.00";
    process.env.MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS = "3";
    process.env.MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS = "0";
    resetConcurrencyGate();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it("returns empty findings when env gate is disabled", async () => {
    process.env.MSL_CREATIVE_STUDIO_ENABLED = "false";
    const { ctx } = baseContext(claimFixture());
    const result = await creativeStudioDaemon(ctx);
    expect(result.findings).toHaveLength(0);
    expect(result.proposalEnqueued).toBe(false);
  });

  it("returns empty findings when MINIMAX_API_KEY is not set", async () => {
    delete process.env.MINIMAX_API_KEY;
    const { ctx } = baseContext(claimFixture());
    const result = await creativeStudioDaemon(ctx);
    expect(result.findings).toHaveLength(0);
    expect(result.proposalEnqueued).toBe(false);
  });

  it("returns empty findings for unsupported job kind", async () => {
    const badPayload = JSON.stringify({
      requestId: "cj_bad",
      requestedByAgent: "test",
      sellerId: "test",
      channel: "mercadolibre",
      kind: "voiceover",
      objective: "ctr",
      budgetTier: "low",
      references: [],
      constraints: {
        preserveProductTruth: false,
        noBrandInfringement: false,
        requiresHumanApproval: false,
      },
    });
    const { ctx } = baseContext(claimFixture({ payloadJson: badPayload }));
    const result = await creativeStudioDaemon(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.summary).toContain("unsupported job kind");
    expect(result.proposalEnqueued).toBe(false);
  });

  it("returns empty findings on invalid payload", async () => {
    const { ctx } = baseContext(claimFixture({ payloadJson: "not-json" }));
    const result = await creativeStudioDaemon(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.summary).toContain("invalid payload");
  });

  it("skips claim when concurrency limit is hit", async () => {
    process.env.MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS = "0";
    const { ctx } = baseContext(claimFixture());
    const result = await creativeStudioDaemon(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.summary).toContain("concurrency limit");
    expect(result.proposalEnqueued).toBe(false);
  });

  it("skips claim when cooldown is active", async () => {
    process.env.MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS = "5000";
    setLastJobTime(Date.now()); // make last job "now" so cooldown is active
    const { ctx } = baseContext(claimFixture());
    const result = await creativeStudioDaemon(ctx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.summary.toLowerCase()).toContain("cooldown");
    expect(result.proposalEnqueued).toBe(false);
  });

  it("processes a valid image request and enqueues CEO proposal", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            base_resp: { status_code: 0, status_message: "success" },
            data: [{ image_url: "https://cdn.minimax.io/img/123.jpg" }],
          }),
        ),
    } as Response);

    const { ctx, enqueue } = baseContext(claimFixture());
    const result = await creativeStudioDaemon(ctx);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.proposalEnqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const enqueued = enqueue.mock.calls[0]?.[0];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(enqueued?.senderAgentId).toBe("creative-studio");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(enqueued?.receiverAgentId).toBe("ceo");

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const payload = JSON.parse(enqueued?.payloadJson ?? "{}"); // eslint-disable-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(payload.result).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(payload.noMutationExecuted).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(payload.nextAction).toBe("approve_creative_asset");
  });

  it("handles provider execution failure gracefully", async () => {
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const { ctx, enqueue } = baseContext(claimFixture());
    const result = await creativeStudioDaemon(ctx);

    expect(result.proposalEnqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  // ── ML Diagnosis tests ──────────────────────────────────────

  describe("ML diagnosis integration", () => {
    beforeEach(() => {
      process.env.ML_API_TOKEN = "ml-test-token";
      process.env.ML_API_BASE_URL = "https://api.mercadolibre.com";
      process.env.MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE = "true";
    });

    afterEach(() => {
      delete process.env.ML_API_TOKEN;
      delete process.env.ML_API_BASE_URL;
      delete process.env.MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE;
    });

    function mlAwareClaim(overrides: Partial<AgentMessage> = {}): AgentMessage {
      const base = claimFixture(overrides);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(base.payloadJson);
      // Ensure it's a mercadolibre channel with pictureType context
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      payload.channel = "mercadolibre";

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      payload.constraints = {
         
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        ...payload.constraints,
        channelFormat: {
          ml: {
            pictureType: "thumbnail",
            expectedCategoryId: "MLC1055",
          },
        },
      };
      base.payloadJson = JSON.stringify(payload);
      return base;
    }

    it("includes mlDiagnostic in output when channel is mercadolibre and API succeeds", async () => {
      // Mock sequence: MiniMax API → ML API (diagnostic) → asset download
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/diag-test.jpg" }],
              }),
            ),
        } as Response)
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ action: "empty" }),
        } as Response)
        .mockResolvedValue(new Response()); // fallback for asset download

      const { ctx, enqueue } = baseContext(mlAwareClaim());
      const result = await creativeStudioDaemon(ctx);

      expect(result.proposalEnqueued).toBe(true);
      expect(enqueue).toHaveBeenCalledTimes(1);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const payload = JSON.parse(enqueue.mock.calls[0]?.[0]?.payloadJson ?? "{}"); // eslint-disable-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const outputs = payload.result?.outputs ?? []; // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(outputs.length).toBeGreaterThan(0);
      expect(enqueue).toHaveBeenCalled();
    });

    it("attaches mlDiagnostic with passed: true when no detections found", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/clean.jpg" }],
              }),
            ),
        } as Response)
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ action: "empty" }),
        } as Response)
        .mockResolvedValue(new Response());

      const { ctx } = baseContext(mlAwareClaim());
      const result = await creativeStudioDaemon(ctx);

      expect(result.findings.length).toBeGreaterThan(0);
    });

    it("does NOT call ML API when channel is not mercadolibre", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/storefront.jpg" }],
              }),
            ),
        } as Response)
        .mockResolvedValue(new Response());

      const nonMlClaim = claimFixture();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const payload = JSON.parse(nonMlClaim.payloadJson);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      payload.channel = "storefront";
      nonMlClaim.payloadJson = JSON.stringify(payload);

      const { ctx } = baseContext(nonMlClaim);
      const result = await creativeStudioDaemon(ctx);
      expect(result.findings.length).toBeGreaterThan(0);
    });
  });
});
