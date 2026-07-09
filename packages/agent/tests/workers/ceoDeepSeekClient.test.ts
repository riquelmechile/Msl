
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { GraphEngine } from "@msl/memory";
import type { WorkforceCostCacheLedgerStore } from "../../src/conversation/workforceCostCacheLedgerStore.js";
import type { CeoFinding } from "../../src/workers/ceoDeepSeekClient.js";

import { createCeoDeepSeekClient } from "../../src/workers/ceoDeepSeekClient.js";

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

function makeFindings(overrides?: Partial<CeoFinding>[]): CeoFinding[] {
  const defaults: CeoFinding = {
    sellerId: "seller-plasticov",
    campaignId: "camp-1",
    itemId: "MLC-TEST-001",
    signal: "margin-consuming",
    severity: "critical",
    summary: "Margin loss of 8000 CLP on item",
    evidenceIds: ["listing_snapshot:MLC-TEST-001"],
    capturedAt: new Date().toISOString(),
    recommendationIdentity: "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming",
  };

  if (overrides && overrides.length > 0) {
    return overrides.map((o) => ({ ...defaults, ...o }));
  }
  return [{ ...defaults }];
}

function makeMockCortex(): GraphEngine {
  return {
    queryByMetadata: vi.fn().mockReturnValue([]),
  } as unknown as GraphEngine;
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

// ── Tests ───────────────────────────────────────────────────────────

describe("createCeoDeepSeekClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Missing API key → null factory ───────────────────────────

  it("returns null when DEEPSEEK_API_KEY is not set", () => {
    const client = createCeoDeepSeekClient({
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).toBeNull();
  });

  it("returns null when DEEPSEEK_API_KEY is empty", () => {
    const client = createCeoDeepSeekClient({
      apiKey: "",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).toBeNull();
  });

  it("returns a client when DEEPSEEK_API_KEY is set", () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test-key",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();
    expect(client).toHaveProperty("reason");
  });

  // ── 2. Valid JSON parsed ────────────────────────────────────────

  it("returns recommendation map for valid DeepSeek JSON response", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    const identity = "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming";

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              [identity]: { proposalType: "pause-campaign", rationale: "Severe margin loss" },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });

    const findings = makeFindings();
    const cortex = makeMockCortex();
    const ledger = makeMockLedger();

    const result = await client!.reason(findings, cortex, ledger);

    expect(result.size).toBe(1);
    expect(result.get(identity)).toBe("pause-campaign");
  });

  it("handles multiple findings in a single response", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    const id1 = "product-ads-cfo:seller-plasticov:camp-1:MLC-A:margin-consuming";
    const id2 = "product-ads-cfo:seller-plasticov:camp-1:MLC-B:scale-candidate";

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              [id1]: { proposalType: "pause-campaign", rationale: "Loss" },
              [id2]: { proposalType: "adjust-campaign-budget", rationale: "Growth" },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });

    const findings = makeFindings([
      { recommendationIdentity: id1, itemId: "MLC-A", signal: "margin-consuming" },
      { recommendationIdentity: id2, itemId: "MLC-B", signal: "scale-candidate" },
    ]);
    const ledger = makeMockLedger();

    const result = await client!.reason(findings, makeMockCortex(), ledger);

    expect(result.size).toBe(2);
    expect(result.get(id1)).toBe("pause-campaign");
    expect(result.get(id2)).toBe("adjust-campaign-budget");
  });

  // ── 3. Invalid proposalType → throws ────────────────────────────

  it("throws when LLM returns an unknown proposalType", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    const identity = "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming";

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              [identity]: { proposalType: "unknown-action", rationale: "Nonsense" },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
      },
    });

    await expect(
      client!.reason(makeFindings(), makeMockCortex(), makeMockLedger()),
    ).rejects.toThrow("Invalid proposalType");
  });

  it("throws when LLM returns empty content", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 50, completion_tokens: 0 },
    });

    await expect(
      client!.reason(makeFindings(), makeMockCortex(), makeMockLedger()),
    ).rejects.toThrow("Empty response");
  });

  it("throws when LLM returns invalid JSON", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not-json-at-all" } }],
      usage: { prompt_tokens: 50, completion_tokens: 5 },
    });

    await expect(
      client!.reason(makeFindings(), makeMockCortex(), makeMockLedger()),
    ).rejects.toThrow("Invalid JSON response");
  });

  // ── 4. Timeout → throws ─────────────────────────────────────────

  it("throws on DeepSeek API timeout", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    mockCreate.mockRejectedValueOnce(new Error("AbortError: The operation was aborted"));

    await expect(
      client!.reason(makeFindings(), makeMockCortex(), makeMockLedger()),
    ).rejects.toThrow();
  });

  // ── 5. Cortex enrichment ────────────────────────────────────────

  it("queries Cortex for profitability context per finding", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    const identity = "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming";

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              [identity]: { proposalType: "pause-campaign", rationale: "Loss" },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 20,
      },
    });

    const queryByMetadata = vi.fn().mockReturnValue([
      {
        id: 1,
        label: "profitability:plasticov",
        metadata: { type: "profitability", sellerId: "seller-plasticov", margin: -0.15 },
      },
    ]);

    const cortex = { queryByMetadata } as unknown as GraphEngine;
    const ledger = makeMockLedger();

    await client!.reason(makeFindings(), cortex, ledger);

    expect(queryByMetadata).toHaveBeenCalledWith({
      type: "profitability",
      sellerId: "seller-plasticov",
      limit: 5,
    });
  });

  // ── 6. Cost ledger recording ────────────────────────────────────

  it("records an insertEntry on the cost ledger after a successful call", async () => {
    const client = createCeoDeepSeekClient({
      apiKey: "sk-test",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
    });
    expect(client).not.toBeNull();

    const identity = "product-ads-cfo:seller-plasticov:camp-1:MLC-TEST-001:margin-consuming";

    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              [identity]: { proposalType: "pause-campaign", rationale: "Loss" },
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 150,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    });

    const insertEntry = vi.fn();
    const ledger = {
      insertEntry,
      listEntries: vi.fn().mockReturnValue([]),
      count: vi.fn().mockReturnValue(0),
      aggregateCosts: vi.fn().mockReturnValue({
        byAgent: new Map(),
        byDepartment: new Map(),
        byPeriod: [],
        cacheEfficiency: 0,
      }),
    } as unknown as WorkforceCostCacheLedgerStore;

    await client!.reason(makeFindings(), makeMockCortex(), ledger);

    expect(insertEntry).toHaveBeenCalledTimes(1);

    const callArg = insertEntry.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.departmentId).toBe("product-ads-ceo-profitability");
    expect(callArg.provider).toBe("deepseek");
    expect(callArg.inputTokens).toBe(150);
    expect(callArg.outputTokens).toBe(20);
    // Gateway selects deepseek-v4-pro for recommendation level
    // and records cost with reasoning-gateway source
    expect(callArg.metadata).toEqual({ model: "deepseek-v4-pro", source: "reasoning-gateway" });
  });
});
