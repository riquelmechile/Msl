import { describe, expect, it, vi, beforeEach } from "vitest";
import OpenAI from "openai";
import { DeepSeekReasoningGateway } from "../../src/reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../../src/reasoning/reasoningTypes.js";
import type { ReasoningCall } from "../../src/reasoning/reasoningTypes.js";
import type { WorkforceCostCacheLedgerStore } from "../../src/conversation/workforceCostCacheLedgerStore.js";
import type { AutonomyEngine } from "../../src/conversation/autonomyEngine.js";

// ── Mock OpenAI ─────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

// ── Fixtures ────────────────────────────────────────────────────────

function makeCall(overrides?: Partial<ReasoningCall>): ReasoningCall {
  return {
    laneId: "test-lane",
    level: ReasoningLevel.Classification,
    stablePrefix: "You are a helpful assistant.",
    volatileInput: "Analyze this data.",
    departmentId: "test-dept",
    agentId: "test-agent",
    ...overrides,
  };
}

function makeMockLedger(): WorkforceCostCacheLedgerStore {
  return {
    insertEntry: vi.fn(),
    listEntries: vi.fn().mockReturnValue([]),
    count: vi.fn().mockReturnValue(0),
    aggregateCosts: vi.fn().mockReturnValue({
      byAgent: new Map(),
      byDepartment: new Map(),
      byPeriod: [],
      cacheEfficiency: 0,
    }),
  };
}

function makeMockAutonomy(allowed: boolean): AutonomyEngine {
  return {
    canAutoApprove: vi.fn().mockReturnValue(allowed),
    getCurrentLevel: vi.fn().mockReturnValue(3),
    setLevel: vi.fn(),
    recordKpi: vi.fn(),
    evaluateDegradation: vi.fn().mockReturnValue(null),
    evaluatePromotion: vi.fn().mockReturnValue({ recommend: false, to: 3 }),
  };
}

function makeSuccessResponse(content: string, usageOverrides?: Record<string, unknown>) {
  return {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: 50,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 10 },
      ...usageOverrides,
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("DeepSeekReasoningGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Successful reasoning call ──────────────────────────────────

  it("returns status success for a valid classification call", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.status).toBe("success");
    expect(result.modelUsed).toBe("deepseek-v4-flash");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.recommendations).toHaveLength(1);
  });

  it("returns recommendations with parsed content", async () => {
    mockCreate.mockResolvedValueOnce(
      makeSuccessResponse(JSON.stringify({ findings: [{ kind: "alert" }] })),
    );

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.status).toBe("success");
    expect(result.rawResponse).toBe(JSON.stringify({ findings: [{ kind: "alert" }] }));
  });

  // ── 2. 3-block prompt construction ────────────────────────────────

  it("passes 3-block prompt to OpenAI with stable prefix, cacheable context, and volatile input", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    await gateway.reason(
      makeCall({
        stablePrefix: "STABLE",
        cacheableContext: "CACHEABLE",
        volatileInput: "VOLATILE",
      }),
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const messages = callArgs.messages;

    // 3 blocks: system/stable, system/cacheable, user/volatile
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "system", content: "STABLE" });
    expect(messages[1]).toEqual({ role: "system", content: "CACHEABLE" });
    expect(messages[2]).toEqual({ role: "user", content: "VOLATILE" });
  });

  it("builds 2-block prompt when cacheableContext is omitted", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    await gateway.reason(
      // Omit cacheableContext to test 2-block prompt
      makeCall({
        stablePrefix: "STABLE",
        volatileInput: "VOLATILE",
      }),
    );

    const callArgs = mockCreate.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const messages = callArgs.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: "STABLE" });
    expect(messages[1]).toEqual({ role: "user", content: "VOLATILE" });
  });

  // ── 3. Model selection ────────────────────────────────────────────

  it("uses deepseek-v4-flash for classification by default", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    await gateway.reason(makeCall({ level: ReasoningLevel.Classification }));
    const callArgs = mockCreate.mock.calls[0]![0] as { model: string };
    expect(callArgs.model).toBe("deepseek-v4-flash");
  });

  it("uses deepseek-v4-pro for recommendation", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    await gateway.reason(makeCall({ level: ReasoningLevel.Recommendation }));
    const callArgs = mockCreate.mock.calls[0]![0] as { model: string };
    expect(callArgs.model).toBe("deepseek-v4-pro");
  });

  it("uses deepseek-v4-pro for decision", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    await gateway.reason(makeCall({ level: ReasoningLevel.Decision }));
    const callArgs = mockCreate.mock.calls[0]![0] as { model: string };
    expect(callArgs.model).toBe("deepseek-v4-pro");
  });

  it("forcePro forces deepseek-v4-pro for classification", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    await gateway.reason(makeCall({ level: ReasoningLevel.Classification, forcePro: true }));
    const callArgs = mockCreate.mock.calls[0]![0] as { model: string };
    expect(callArgs.model).toBe("deepseek-v4-pro");
  });

  // ── 4. Fallback on errors ─────────────────────────────────────────

  it("returns status fallback on network error (never throws)", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network failure"));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.status).toBe("fallback");
    expect(result.recommendations).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("returns status fallback on empty response (never throws)", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.status).toBe("fallback");
    expect(result.summary).toContain("Empty response");
  });

  it("returns status fallback on invalid JSON (never throws)", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not-json-at-all" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.status).toBe("fallback");
    expect(result.summary).toContain("Invalid JSON");
  });

  it("returns status fallback on schema mismatch (never throws)", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"unexpected": "shape"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(
      makeCall({
        expectedSchema: {
          type: "object",
          required: ["requiredField"],
          properties: { requiredField: { type: "string" } },
        },
      }),
    );

    expect(result.status).toBe("fallback");
    expect(result.summary).toContain("schema");
  });

  // ── 5. Timeout behavior ───────────────────────────────────────────

  it("returns fallback when the request times out", async () => {
    mockCreate.mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall({ level: ReasoningLevel.Classification }));

    expect(result.status).toBe("fallback");
  });

  // ── 6. Autonomy gate ──────────────────────────────────────────────

  it("auto-execute level: requiresApproval false when autonomy allows", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const autonomy = makeMockAutonomy(true); // canAutoApprove returns true
    const gateway = new DeepSeekReasoningGateway(
      new OpenAI({ apiKey: "test" }),
      undefined,
      autonomy,
    );
    const result = await gateway.reason(makeCall({ level: ReasoningLevel.Classification }));

    expect(result.requiresApproval).toBe(false);
  });

  it("auto-execute level: requiresApproval true when autonomy blocks", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const autonomy = makeMockAutonomy(false); // canAutoApprove returns false
    const gateway = new DeepSeekReasoningGateway(
      new OpenAI({ apiKey: "test" }),
      undefined,
      autonomy,
    );
    const result = await gateway.reason(makeCall({ level: ReasoningLevel.Prioritization }));

    expect(result.requiresApproval).toBe(true);
  });

  it("recommendation always requires approval regardless of autonomy", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const autonomy = makeMockAutonomy(true);
    const gateway = new DeepSeekReasoningGateway(
      new OpenAI({ apiKey: "test" }),
      undefined,
      autonomy,
    );
    const result = await gateway.reason(makeCall({ level: ReasoningLevel.Recommendation }));

    expect(result.requiresApproval).toBe(true);
  });

  it("decision always requires approval regardless of autonomy", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const autonomy = makeMockAutonomy(true);
    const gateway = new DeepSeekReasoningGateway(
      new OpenAI({ apiKey: "test" }),
      undefined,
      autonomy,
    );
    const result = await gateway.reason(makeCall({ level: ReasoningLevel.Decision }));

    expect(result.requiresApproval).toBe(true);
  });

  // ── 7. Cost ledger entry ──────────────────────────────────────────

  it("records cost ledger entry on successful call", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const ledger = makeMockLedger();
    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }), ledger);
    await gateway.reason(makeCall());

    expect(ledger.insertEntry).toHaveBeenCalledTimes(1); // eslint-disable-line @typescript-eslint/unbound-method
    const entry = (ledger.insertEntry as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(entry.provider).toBe("deepseek");
    expect(entry.model).toBe("deepseek-v4-flash");
    expect(entry.departmentId).toBe("test-dept");
    expect(entry.agentId).toBe("test-agent");
    expect(entry.cacheStatus).toBe("hit"); // cached_tokens = 10
    expect(typeof entry.estimatedCostMicros).toBe("number");
  });

  it("records cost on costLedgerOverride when provided", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const constructorLedger = makeMockLedger();
    const overrideLedger = makeMockLedger();
    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }), constructorLedger);
    await gateway.reason(makeCall(), overrideLedger);

    // override ledger should be used, not constructor ledger
    expect(constructorLedger.insertEntry).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method
    expect(overrideLedger.insertEntry).toHaveBeenCalledTimes(1); // eslint-disable-line @typescript-eslint/unbound-method
  });

  it("does not throw when ledger insertEntry fails", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const ledger = makeMockLedger();
    (ledger.insertEntry as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("Ledger full");
    });

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }), ledger);
    const result = await gateway.reason(makeCall());

    // Should still return success even if ledger recording fails
    expect(result.status).toBe("success");
  });

  // ── 8. Cost telemetry structure ───────────────────────────────────

  it("returns costTelemetry with all fields populated on success", async () => {
    mockCreate.mockResolvedValueOnce(makeSuccessResponse('{"result": "ok"}'));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.costTelemetry).toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      inputTokens: expect.any(Number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      outputTokens: expect.any(Number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      cacheHitTokens: expect.any(Number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      cacheMissTokens: expect.any(Number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      estimatedCostMicros: expect.any(Number),
    });
    expect(result.costTelemetry.inputTokens).toBeGreaterThan(0);
  });

  it("returns zero costTelemetry on fallback", async () => {
    mockCreate.mockRejectedValueOnce(new Error("fail"));

    const gateway = new DeepSeekReasoningGateway(new OpenAI({ apiKey: "test" }));
    const result = await gateway.reason(makeCall());

    expect(result.costTelemetry).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      estimatedCostMicros: 0,
    });
  });
});
