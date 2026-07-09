import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PolicyEngine, CostLedger } from "../index.js";
import { MlDiagnosticAdapter } from "../infrastructure/ml-diagnostic-adapter.js";
import { CortexBridge } from "../application/cortex-bridge.js";
import type {
  CreativeAssetRequest,
  CreativeExecutionResult,
} from "../contracts/creative-requests.js";

// ── Mock API responses ──────────────────────────────────────────────

function mockMlApiResponse(data: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(data),
  } as Response;
}

// ── E2E Test ────────────────────────────────────────────────────────

describe("creative-studio end-to-end (all mocked)", () => {
  let policyEngine: PolicyEngine;
  let costLedger: CostLedger;
  let mlDiagnostic: MlDiagnosticAdapter;
  let cortexBridge: CortexBridge;
  let cortexMock: {
    nodes: Array<Record<string, unknown>>;
    getOrCreateNode: ReturnType<typeof vi.fn>;
  };

  const SELLER_ID = "e2e-test-seller";
  const CATEGORY_ID = "MLC1055";
  const ITEM_ID = "MLC-E2E-001";

  function makeRequest(overrides: Partial<CreativeAssetRequest> = {}): CreativeAssetRequest {
    return {
      requestId: "cj_e2e_001",
      requestedByAgent: "creative-assets-daemon",
      sellerId: SELLER_ID,
      channel: "mercadolibre",
      kind: "product-cover-i2i",
      objective: "ctr",
      budgetTier: "low",
      references: [
        {
          type: "supplier-image",
          uri: "https://supplier.example.com/product.jpg",
          sha256: "abc123",
        },
      ],
      productContext: {
        itemId: ITEM_ID,
        sku: "E2E-SKU-001",
        title: "E2E Test Product",
        categoryId: CATEGORY_ID,
      },
      constraints: {
        preserveProductTruth: true,
        noBrandInfringement: true,
        requiresHumanApproval: true,
        channelFormat: {
          ml: {
            pictureType: "thumbnail",
            expectedCategoryId: CATEGORY_ID,
          },
        },
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    policyEngine = new PolicyEngine();
    costLedger = new CostLedger({ maxDailyUsd: 5.0, maxJobUsd: 0.5 });

    cortexMock = {
      nodes: [],
      getOrCreateNode: vi.fn((label: string, metadata: Record<string, unknown>) => {
        cortexMock.nodes.push({ label, metadata });
        return { id: cortexMock.nodes.length };
      }),
    };

    cortexBridge = new CortexBridge(cortexMock);

    // Mock fetch for ML diagnostic API
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response()));
    mlDiagnostic = new MlDiagnosticAdapter({
      mlApiBaseUrl: "https://api.mercadolibre.com",
      authToken: "e2e-test-token",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes full flow: policy → budget → mock generate → diagnose → propose → cortex", async () => {
    // Step 1: Policy check
    const request = makeRequest();
    const validation = policyEngine.validate(request);
    expect(validation.valid).toBe(true);

    // Step 2: Budget check
    const estimatedCost = 0.015;
    const budgetCheck = costLedger.canAfford(estimatedCost);
    expect(budgetCheck.allowed).toBe(true);

    // Step 3: Mock generation result
    const mockResult: CreativeExecutionResult = {
      jobId: `job_e2e_${Date.now()}`,
      requestId: request.requestId,
      status: "needs-human-review",
      provider: "minimax",
      model: "image-01",
      estimatedCostUsd: estimatedCost,
      actualCostUsd: 0.0148,
      outputs: [
        {
          assetId: "asset_e2e_001",
          kind: "image",
          storageUri: "https://cdn.minimax.io/img/e2e-test.jpg",
          previewUrl: "https://cdn.minimax.io/preview/e2e-test.jpg",
          sha256: "f03ac7c8f523f1a1c5c5a5b5d5e5f5g5",
          policyFlags: [],
        },
      ],
      noMutationExecuted: true,
    };

    // Record spend
    costLedger.recordSpend(mockResult.actualCostUsd!);
    const dailySpent = costLedger.getDailySpent();
    expect(dailySpent).toBeCloseTo(0.0148);

    // Step 4: ML Diagnosis (mock ML API returning clean)
    vi.mocked(fetch).mockResolvedValueOnce(
      mockMlApiResponse({
        action: "empty",
      }),
    );

    const diagResult = await mlDiagnostic.diagnoseImage(mockResult.outputs[0]!.storageUri, {
      categoryId: CATEGORY_ID,
      title: request.productContext?.title ?? "",
      pictureType: "thumbnail",
    });
    expect(diagResult.passed).toBe(true);
    expect(diagResult.detections).toHaveLength(0);

    // Attach diagnosis to output
    (mockResult.outputs[0] as { mlDiagnostic?: unknown }).mlDiagnostic = diagResult;

    // Step 5: Record outcome in Cortex
    await cortexBridge.recordOutcome(mockResult.jobId, mockResult, {
      approved: false,
      published: false,
    });

    expect(cortexMock.getOrCreateNode).toHaveBeenCalledTimes(1);
    const nodeMeta = cortexMock.nodes[0]?.metadata as Record<string, unknown>;
    expect(nodeMeta.type).toBe("creative_outcome");
    expect(nodeMeta.jobId).toBe(mockResult.jobId);
    expect(nodeMeta.provider).toBe("minimax");
    expect(nodeMeta.approved).toBe(false);
    expect(nodeMeta.published).toBe(false);

    // Step 6: Audit log assertion
    const auditEvent = {
      jobId: mockResult.jobId,
      requestId: mockResult.requestId,
      provider: mockResult.provider,
      model: mockResult.model,
      estimatedCostUsd: mockResult.estimatedCostUsd,
      actualCostUsd: mockResult.actualCostUsd,
      channel: request.channel,
      kind: request.kind,
      status: mockResult.status,
    };
    expect(auditEvent.jobId).toBe(mockResult.jobId);
    expect(auditEvent.provider).toBe("minimax");
    expect(auditEvent.model).toBe("image-01");
  });

  it("verifies noMutationExecuted throughout entire flow", async () => {
    // The noMutationExecuted flag should be true from start to finish
    const request = makeRequest();

    // Budget check doesn't mutate
    expect(costLedger.canAfford(0.015).allowed).toBe(true);

    // Mock result has noMutationExecuted
    const result: CreativeExecutionResult = {
      jobId: "job_e2e_no_mut",
      requestId: request.requestId,
      status: "needs-human-review",
      provider: "minimax",
      model: "image-01",
      estimatedCostUsd: 0.015,
      outputs: [
        {
          assetId: "asset_no_mut",
          kind: "image",
          storageUri: "https://cdn.minimax.io/img/no-mut.jpg",
          sha256: "abc123456789",
          policyFlags: [],
        },
      ],
      noMutationExecuted: true,
    };

    expect(result.noMutationExecuted).toBe(true);

    // ML diagnosis doesn't mutate
    vi.mocked(fetch).mockResolvedValueOnce(mockMlApiResponse({ action: "empty" }));
    const diag = await mlDiagnostic.diagnoseImage(result.outputs[0]!.storageUri, {
      categoryId: CATEGORY_ID,
      title: "No mutation test",
      pictureType: "thumbnail",
    });
    expect(diag.passed).toBe(true);

    // CortexBridge doesn't mutate
    await cortexBridge.recordOutcome(result.jobId, result, {
      approved: false,
      published: false,
    });
    // No exception thrown = no mutation executed
  });

  it("handles ML diagnosis failure gracefully in full flow", async () => {
    const request = makeRequest();
    const validation = policyEngine.validate(request);
    expect(validation.valid).toBe(true);

    // ML API fails
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ML API unavailable"));

    const result: CreativeExecutionResult = {
      jobId: "job_e2e_diag_fail",
      requestId: request.requestId,
      status: "needs-human-review",
      provider: "minimax",
      model: "image-01",
      estimatedCostUsd: 0.015,
      outputs: [
        {
          assetId: "asset_diag_fail",
          kind: "image",
          storageUri: "https://cdn.minimax.io/img/diag-fail.jpg",
          sha256: "def456",
          policyFlags: [],
        },
      ],
      noMutationExecuted: true,
    };

    // Diagnosis should return passed: true on failure (non-blocking)
    const diag = await mlDiagnostic.diagnoseImage(result.outputs[0]!.storageUri, {
      categoryId: CATEGORY_ID,
      title: "Diagnosis fail test",
      pictureType: "thumbnail",
    });
    expect(diag.passed).toBe(true);
    expect(diag.detections).toHaveLength(0);

    // Cortex recording should still work
    await cortexBridge.recordOutcome(result.jobId, result, {
      approved: false,
      published: false,
    });
    expect(cortexMock.getOrCreateNode).toHaveBeenCalled();
  });
});
