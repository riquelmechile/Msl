/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OWNED_ECOMMERCE_DEEPSEEK_TIMEOUT_MS,
  OWNED_ECOMMERCE_DEEPSEEK_CANDIDATE_LIMIT,
  OWNED_ECOMMERCE_PROJECTION_CATALOG_LIMIT,
  buildOwnedEcommerceDeepSeekPromptPlan,
  collectOwnedEcommerceCandidates,
  estimateOwnedEcommerceDeepSeekCostMicros,
  runOwnedEcommerceProjectionWorker,
  selectOwnedEcommerceDeepSeekModel,
  type OwnedEcommerceDeepSeekClient,
  type OwnedEcommerceSourceRecord,
} from "./index.js";

describe("owned ecommerce candidate collection", () => {
  it("collects ML accounts, Supplier Mirror, future suppliers, read-model, and Cortex evidence", () => {
    const candidates = collectOwnedEcommerceCandidates({
      now: new Date("2026-07-04T12:00:00.000Z"),
      evidence: {
        mlAccounts: [
          sourceRecord({ id: "plasticov-1", source: "plasticov", accountId: "plasticov" }),
        ],
        supplierMirror: [
          sourceRecord({ id: "jinpeng-1", source: "supplier-mirror", supplierId: "jinpeng" }),
        ],
        futureSuppliers: [
          sourceRecord({ id: "future-1", source: "future-supplier", supplierId: "future-x" }),
        ],
        readModel: [sourceRecord({ id: "read-1", source: "read-model" })],
        cortex: [
          sourceRecord({ id: "cortex-1", source: "cortex", cortexNodeIds: ["node-cortex-1"] }),
        ],
      },
    });

    expect(candidates.map((candidate) => candidate.provenance.source)).toEqual([
      "plasticov",
      "supplier-mirror",
      "future-supplier",
      "read-model",
      "cortex",
    ]);
    expect(candidates.map((candidate) => candidate.evidenceIds)).toEqual(
      expect.arrayContaining([expect.arrayContaining(["plasticov-1-evidence"])]),
    );
  });

  it("blocks stale, weak, secret, approval, and unsupported risky-claim candidates", () => {
    const candidates = collectOwnedEcommerceCandidates({
      evidence: {
        supplierMirror: [
          sourceRecord({
            id: "unsafe-1",
            source: "supplier-mirror",
            stock: { status: "unknown", authority: "unknown" },
            margin: undefined,
            evidenceState: {
              stockFreshness: "stale",
              marginFreshness: "unknown",
              supplierFreshness: "stale",
              completeness: "partial",
            },
            containsSecret: true,
            requestedOperations: ["checkout", "publish", "price", "stock"],
            riskyClaims: [{ id: "claim-unsafe", text: "Best legal cure", claimType: "benefit" }],
          }),
        ],
      },
    });

    expect(candidates[0]?.blockedReasons).toEqual(
      expect.arrayContaining([
        "stale-stock-evidence",
        "unknown-margin-evidence",
        "stale-supplier-evidence",
        "incomplete-evidence",
        "unknown-stock-evidence",
        "secret-detected",
        "checkout-approval-required",
        "publish-approval-required",
        "price-approval-required",
        "stock-approval-required",
        "unsupported-risky-claim",
      ]),
    );
    expect(candidates[0]?.redactedReasons.join(" ")).not.toContain("Best legal cure");
  });

  it("blocks out-of-stock candidates from storefront eligibility", () => {
    const candidates = collectOwnedEcommerceCandidates({
      evidence: {
        mlAccounts: [
          sourceRecord({
            id: "sold-out-1",
            stock: {
              status: "out-of-stock",
              authority: "stock-authoritative",
              quantity: 0,
              evidenceId: "sold-out-1-stock",
            },
          }),
        ],
      },
    });

    expect(candidates[0]?.blockedReasons).toEqual(
      expect.arrayContaining(["unknown-stock-evidence"]),
    );
    expect(candidates[0]?.redactedReasons).toEqual(
      expect.arrayContaining(["Stock evidence reports no available stock."]),
    );
  });
});

describe("owned ecommerce DeepSeek policy", () => {
  it("keeps stable/cacheable and volatile evidence blocks separate", () => {
    const plan = buildOwnedEcommerceDeepSeekPromptPlan({
      projectionId: "projection-1",
      candidateIds: ["candidate-b", "candidate-a"],
      evidenceIds: ["evidence-b", "evidence-a"],
      accountScope: ["plasticov"],
      supplierScope: ["jinpeng"],
      sourceSummaries: ["plasticov:1", "supplier-mirror:1"],
    });

    expect(plan.stablePrefix).toContain("proposal-only");
    expect(plan.cacheableContextBlock).toContain("Medusa-ready static storefront projection");
    expect(plan.volatileContextBlock).toContain("candidate-a, candidate-b");
    expect(plan.cacheableContextBlock).toContain("sourceBuckets: 2");
    expect(plan.cacheableContextBlock).not.toContain("plasticov");
    expect(plan.cacheableContextBlock).not.toContain("supplier-mirror");
    expect(plan.cacheableContextBlock).not.toContain("jinpeng");
    expect(plan.metadata).toMatchObject({
      provider: "deepseek",
      cacheStrategy: "stable-prefix-plus-refreshable-evidence",
      laneId: "owned-ecommerce",
    });
    expect(selectOwnedEcommerceDeepSeekModel({ operation: "policy-conflict" })).toBe(
      "deepseek-v4-pro",
    );
    expect(
      estimateOwnedEcommerceDeepSeekCostMicros({
        model: "deepseek-v4-flash",
        promptCacheHitTokens: 1_000,
        promptCacheMissTokens: 1_000,
        outputTokens: 1_000,
      }),
    ).toBe(423);
  });
});

describe("owned ecommerce projection worker", () => {
  it("uses fake DeepSeek to build evidence-backed projections with media, schema, and ledger telemetry", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockImplementation(async ({ candidates }) => ({
        recommendations: [
          {
            candidateId: candidates[0]!.id,
            rank: 1,
            rationale: "Fresh evidence supports the projection.",
            evidenceIds: candidates[0]!.evidenceRefs,
            seoTitle: "Tires preview",
            geoCopy: "Tires prepared as an evidence-backed Medusa preview.",
            claims: [
              {
                id: "claim-availability",
                text: "Available with fresh stock evidence.",
                claimType: "availability",
                evidenceIds: [candidates[0]!.evidenceRefs[1]!],
              },
            ],
          },
        ],
        usage: { promptCacheHitTokens: 2_000, promptCacheMissTokens: 1_000, outputTokens: 500 },
      })),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-1",
      now: () => new Date("2026-07-04T12:00:00.000Z"),
      deepSeek,
      evidence: {
        mlAccounts: [
          sourceRecord({
            id: "plasticov-1",
            source: "plasticov",
            title: "Tires",
            media: [
              {
                src: "/storefront-preview/tire.webp",
                alt: "All-season tire",
                width: 1200,
                height: 900,
                evidenceIds: ["plasticov-1-media"],
              },
            ],
          }),
        ],
      },
    });

    expect(deepSeek.recommend).toHaveBeenCalledWith(
      expect.objectContaining({ model: "deepseek-v4-flash", candidates: expect.any(Array) }),
    );
    expect(result.projection).toMatchObject({
      id: "projection-1",
      status: "preview",
      content: {
        seoTitle: "Tires preview",
        schemaMetadata: { "@type": "ItemList" },
      },
      readiness: { status: "ready" },
    });
    expect(result.projection.media[0]).toMatchObject({
      src: "/storefront-preview/tire.webp",
      alt: "All-season tire",
      sizes: expect.stringContaining("100vw"),
      priority: true,
    });
    expect(result.projection.evidenceIds).toEqual(
      expect.arrayContaining(["plasticov-1-evidence", "plasticov-1-stock", "plasticov-1-margin"]),
    );
    expect(result.ledgerRecord).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      projectionId: "projection-1",
      promptCacheHitTokens: 2_000,
    });
  });

  it("does not send stale blocked candidates to DeepSeek and persists evidence IDs", async () => {
    const upsertCandidate = vi.fn().mockResolvedValue(undefined);
    const upsertProjection = vi.fn().mockResolvedValue(undefined);
    const recordValidation = vi.fn().mockImplementation((record) => Promise.resolve(record));
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-blocked",
      deepSeek,
      store: { upsertCandidate, upsertProjection, recordValidation },
      evidence: {
        supplierMirror: [
          sourceRecord({
            id: "stale-1",
            source: "supplier-mirror",
            evidenceState: {
              stockFreshness: "stale",
              marginFreshness: "fresh",
              supplierFreshness: "fresh",
              completeness: "complete",
            },
          }),
        ],
      },
    });

    expect(result.eligibleCandidates).toEqual([]);
    expect(deepSeek.recommend).not.toHaveBeenCalled();
    expect(result.projection.readiness.status).toBe("blocked");
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "stale-stock-evidence" })]),
    );
    expect(upsertCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "stale-1",
        evidenceIds: expect.arrayContaining(["stale-1-stock"]),
      }),
    );
    expect(upsertProjection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "projection-blocked" }),
    );
    expect(recordValidation).toHaveBeenCalledWith(
      expect.objectContaining({ evidenceIds: expect.arrayContaining(["stale-1-stock"]) }),
    );
  });

  it("keeps excluded stale candidates as warnings when a fresh candidate can be projected", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-mixed-fresh-stale",
      deepSeek,
      evidence: {
        mlAccounts: [sourceRecord({ id: "fresh-1", title: "Fresh product" })],
        supplierMirror: [
          sourceRecord({
            id: "stale-1",
            source: "supplier-mirror",
            evidenceState: {
              stockFreshness: "stale",
              marginFreshness: "fresh",
              supplierFreshness: "fresh",
              completeness: "complete",
            },
          }),
        ],
      },
    });

    expect(result.projection.candidateIds).toEqual(["fresh-1"]);
    expect(result.projection.readiness.status).toBe("ready");
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "stale-stock-evidence",
          severity: "warning",
          redactedMessage: expect.stringContaining("Excluded candidate warning"),
        }),
      ]),
    );
  });

  it("ignores recommendations for unknown or blocked candidates", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({
        recommendations: [
          {
            candidateId: "unknown-1",
            rank: 1,
            rationale: "Unknown candidate should not influence content.",
            evidenceIds: ["unknown-evidence"],
            seoTitle: "Unknown SEO",
            geoCopy: "Unknown GEO",
          },
          {
            candidateId: "blocked-1",
            rank: 2,
            rationale: "Blocked candidate should not influence content.",
            evidenceIds: ["blocked-1-evidence"],
            seoTitle: "Blocked SEO",
            geoCopy: "Blocked GEO",
          },
          {
            candidateId: "eligible-1",
            rank: 3,
            rationale: "Eligible fallback.",
            evidenceIds: ["eligible-1-evidence", "eligible-1-stock", "eligible-1-margin"],
            seoTitle: "Eligible SEO",
            geoCopy: "Eligible GEO",
          },
        ],
        usage: {},
      }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-validation",
      deepSeek,
      evidence: {
        mlAccounts: [sourceRecord({ id: "eligible-1" })],
        supplierMirror: [
          sourceRecord({
            id: "blocked-1",
            stock: { status: "unknown", authority: "unknown", evidenceId: "blocked-1-stock" },
          }),
        ],
      },
    });

    expect(result.recommendations).toEqual([]);
    expect(result.projection.content.seoTitle).toBe("eligible-1 title preview");
    expect(result.projection.content.geoCopy).toBe(
      "eligible-1 title prepared as an evidence-backed Medusa preview.",
    );
    expect(result.projection.content.seoTitle).not.toBe("Unknown SEO");
    expect(result.projection.content.geoCopy).not.toBe("Blocked GEO");
  });

  it("blocks LLM claims that are not supported by candidate evidence", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockImplementation(async ({ candidates }) => ({
        recommendations: [
          {
            candidateId: candidates[0]!.id,
            rank: 1,
            rationale: "Recommendation has its own evidence but the claim does not.",
            evidenceIds: candidates[0]!.evidenceRefs,
            claims: [
              {
                id: "unsupported-llm-claim",
                text: "Unsupported superiority claim.",
                claimType: "superiority",
                evidenceIds: ["recommendation-only-evidence"],
              },
            ],
          },
        ],
        usage: {},
      })),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-claims",
      deepSeek,
      evidence: { mlAccounts: [sourceRecord({ id: "plasticov-claim" })] },
    });

    expect(result.projection.content.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unsupported-llm-claim", status: "blocked" }),
      ]),
    );
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unsupported-risky-claim" })]),
    );
  });

  it("replaces unsupported LLM seoTitle and geoCopy claims with deterministic copy", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockImplementation(async ({ candidates }) => ({
        recommendations: [
          {
            candidateId: candidates[0]!.id,
            rank: 1,
            rationale: "Recommendation evidence is valid but copy adds risky claims.",
            evidenceIds: candidates[0]!.evidenceRefs,
            seoTitle: "Best guaranteed cure for every buyer",
            geoCopy: "Official #1 miracle product for Chile.",
          },
        ],
        usage: {},
      })),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-copy-validation",
      deepSeek,
      evidence: { mlAccounts: [sourceRecord({ id: "copy-risk", title: "Safe product" })] },
    });

    expect(result.projection.content.seoTitle).toBe("Safe product preview");
    expect(result.projection.content.geoCopy).toBe(
      "Safe product prepared as an evidence-backed Medusa preview.",
    );
    expect(result.projection.catalog.products[0]?.description).toBe(
      "Safe product prepared as an evidence-backed Medusa preview.",
    );
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-risky-claim",
          redactedMessage: expect.stringContaining("seoTitle"),
        }),
        expect.objectContaining({
          code: "unsupported-risky-claim",
          redactedMessage: expect.stringContaining("geoCopy"),
        }),
      ]),
    );
  });

  it("rejects delivery, availability, price, and origin claims in LLM seoTitle and geoCopy", async () => {
    const riskyCopies = [
      ["Fast delivery tire", "Same-day shipping available today."],
      ["Best price tire", "Cheap sale price for this product."],
      ["Origin certified tire", "Made in Italy and imported from Europe."],
    ] as const;

    for (const [seoTitle, geoCopy] of riskyCopies) {
      const deepSeek: OwnedEcommerceDeepSeekClient = {
        recommend: vi.fn().mockImplementation(async ({ candidates }) => ({
          recommendations: [
            {
              candidateId: candidates[0]!.id,
              rank: 1,
              rationale: "Recommendation evidence is valid but copy adds unsupported assertions.",
              evidenceIds: candidates[0]!.evidenceRefs,
              seoTitle,
              geoCopy,
            },
          ],
          usage: {},
        })),
      };

      const result = await runOwnedEcommerceProjectionWorker({
        projectionId: `projection-copy-${seoTitle.replace(/\W+/g, "-").toLowerCase()}`,
        deepSeek,
        evidence: { mlAccounts: [sourceRecord({ id: "copy-unsupported", title: "Safe product" })] },
      });

      expect(result.projection.content.seoTitle).toBe("Safe product preview");
      expect(result.projection.content.geoCopy).toBe(
        "Safe product prepared as an evidence-backed Medusa preview.",
      );
      expect(result.projection.readiness.checks).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "unsupported-risky-claim" })]),
      );
    }
  });

  it("does not let candidate title tokens prove LLM availability claims", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockImplementation(async ({ candidates }) => ({
        recommendations: [
          {
            candidateId: candidates[0]!.id,
            rank: 1,
            rationale: "Recommendation evidence is valid but stock evidence is missing.",
            evidenceIds: candidates[0]!.evidenceRefs,
            seoTitle: "Available in stock product",
            geoCopy: "Available in stock product is available now.",
          },
        ],
        usage: {},
      })),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-copy-availability-token-bypass",
      deepSeek,
      evidence: {
        mlAccounts: [
          sourceRecord({
            id: "availability-token-bypass",
            title: "Available in stock product",
            stock: {
              status: "in-stock",
              authority: "stock-authoritative",
              quantity: 10,
            },
          }),
        ],
      },
    });

    expect(result.projection.content.seoTitle).toBe("Available in stock product preview");
    expect(result.projection.content.geoCopy).toBe(
      "Available in stock product prepared as an evidence-backed Medusa preview.",
    );
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-risky-claim",
          redactedMessage: expect.stringContaining("seoTitle"),
        }),
        expect.objectContaining({
          code: "unsupported-risky-claim",
          redactedMessage: expect.stringContaining("geoCopy"),
        }),
      ]),
    );
  });

  it("does not send out-of-stock candidates to DeepSeek", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-out-of-stock",
      deepSeek,
      evidence: {
        mlAccounts: [
          sourceRecord({
            id: "sold-out-worker-1",
            title: "Available tire",
            stock: {
              status: "out-of-stock",
              authority: "stock-authoritative",
              quantity: 0,
              evidenceId: "sold-out-worker-1-stock",
            },
          }),
        ],
      },
    });

    expect(result.eligibleCandidates).toEqual([]);
    expect(deepSeek.recommend).not.toHaveBeenCalled();
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknown-stock-evidence",
          redactedMessage: "Stock evidence reports no available stock.",
        }),
      ]),
    );
  });

  it("maps opaque DeepSeek candidate and evidence refs back to real projection records", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockImplementation(async ({ candidates }) => ({
        recommendations: [
          {
            candidateId: candidates[0]!.id,
            rank: 1,
            rationale: "Opaque evidence refs support this candidate.",
            evidenceIds: candidates[0]!.evidenceRefs,
            seoTitle: "Opaque product preview",
            geoCopy: "Opaque product prepared as an evidence-backed Medusa preview.",
          },
        ],
        usage: {},
      })),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-opaque-response",
      deepSeek,
      evidence: {
        mlAccounts: [sourceRecord({ id: "real-candidate-id", title: "Opaque product" })],
      },
    });

    expect(result.recommendations).toEqual([
      expect.objectContaining({
        candidateId: "real-candidate-id",
        evidenceIds: [
          "real-candidate-id-evidence",
          "real-candidate-id-stock",
          "real-candidate-id-margin",
        ],
      }),
    ]);
    expect(result.projection.candidateIds).toEqual(["real-candidate-id"]);
    expect(result.projection.content.seoTitle).toBe("Opaque product preview");
  });

  it("persists deterministic fallback when DeepSeek is unavailable", async () => {
    const upsertProjection = vi.fn().mockResolvedValue(undefined);
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockRejectedValue(new Error("DeepSeek unavailable")),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-fallback",
      deepSeek,
      store: {
        upsertCandidate: vi.fn().mockResolvedValue(undefined),
        upsertProjection,
        recordValidation: vi.fn().mockResolvedValue(undefined),
      },
      evidence: { mlAccounts: [sourceRecord({ id: "fallback-1" })] },
    });

    expect(result.recommendations).toEqual([]);
    expect(result.projection.catalog.products).toHaveLength(1);
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-readiness-check",
          redactedMessage: expect.stringContaining("DeepSeek was unavailable"),
        }),
      ]),
    );
    expect(upsertProjection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "projection-fallback" }),
    );
  });

  it("uses deterministic fallback when DeepSeek recommendation exceeds the worker timeout", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-timeout-fallback",
      deepSeek,
      deepSeekTimeoutMs: 0,
      evidence: { mlAccounts: [sourceRecord({ id: "timeout-1" })] },
    });

    expect(DEFAULT_OWNED_ECOMMERCE_DEEPSEEK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(deepSeek.recommend).toHaveBeenCalledTimes(1);
    expect(result.recommendations).toEqual([]);
    expect(result.projection.catalog.products).toHaveLength(1);
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-readiness-check",
          redactedMessage: expect.stringContaining("DeepSeek was unavailable"),
        }),
      ]),
    );
  });

  it("replaces external media URLs for static preview rendering", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-external-media",
      deepSeek,
      evidence: {
        mlAccounts: [
          sourceRecord({
            id: "external-media-1",
            media: [
              {
                src: "https://cdn.example.test/external.webp",
                alt: "External media",
                evidenceIds: ["external-media-1-media"],
              },
            ],
          }),
        ],
      },
    });

    expect(result.projection.media[0]?.src).toMatch(/^data:image\/svg\+xml,/);
    expect(result.projection.media[0]?.src).not.toContain("https://cdn.example.test");
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-readiness-check",
          redactedMessage: "External media URL was replaced for static preview rendering.",
        }),
      ]),
    );
  });

  it("skips DeepSeek and builds a blocked projection when no candidates exist", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-empty",
      deepSeek,
      evidence: {},
    });

    expect(deepSeek.recommend).not.toHaveBeenCalled();
    expect(result.projection.catalog.products).toEqual([]);
    expect(result.projection.readiness.status).toBe("blocked");
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "incomplete-evidence" })]),
    );
  });

  it("sends only opaque minimal candidate DTOs to DeepSeek", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-redacted",
      deepSeek,
      evidence: {
        mlAccounts: [
          sourceRecord({
            id: "plasticov-redacted",
            itemRef: "raw-item-ref-123",
            title: "raw-title-business-name",
            accountId: "raw-account-123",
            sourceId: "raw-source-account-123",
            evidenceIds: ["raw-business-evidence-123"],
          }),
        ],
        supplierMirror: [
          sourceRecord({
            id: "supplier-redacted",
            source: "supplier-mirror",
            itemRef: "raw-supplier-item-ref-456",
            title: "raw-supplier-title-business-name",
            supplierId: "raw-supplier-456",
            sourceId: "raw-source-supplier-456",
            evidenceIds: ["raw-supplier-evidence-456"],
          }),
        ],
      },
    });

    const call = vi.mocked(deepSeek.recommend).mock.calls[0]?.[0];
    const serializedCall = JSON.stringify(call);
    expect(JSON.stringify(call?.prompt)).not.toContain("raw-account-123");
    expect(JSON.stringify(call?.prompt)).not.toContain("raw-supplier-456");
    expect(serializedCall).not.toContain("plasticov");
    expect(serializedCall).not.toContain("maustian");
    expect(serializedCall).not.toContain("supplier-mirror");
    expect(serializedCall).not.toContain("raw-supplier");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-account-123");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-supplier-456");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-source-account-123");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-source-supplier-456");
    expect(JSON.stringify(call?.candidates)).not.toContain("plasticov-redacted");
    expect(JSON.stringify(call?.candidates)).not.toContain("supplier-redacted");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-item-ref-123");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-supplier-item-ref-456");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-title-business-name");
    expect(JSON.stringify(call?.candidates)).not.toContain("raw-business-evidence-123");
    expect(call?.candidates.map((candidate) => candidate.id)).toEqual([
      "candidate-001",
      "candidate-002",
    ]);
    expect(call?.candidates[0]).toEqual(
      expect.not.objectContaining({
        itemRef: expect.any(String),
        title: expect.any(String),
        source: expect.any(String),
      }),
    );
  });

  it("caps DeepSeek candidates deterministically and records a truncation warning", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };
    const records = Array.from(
      { length: OWNED_ECOMMERCE_DEEPSEEK_CANDIDATE_LIMIT + 2 },
      (_, index) => sourceRecord({ id: `candidate-${String(index + 1).padStart(2, "0")}` }),
    ).reverse();

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-capped",
      deepSeek,
      evidence: { mlAccounts: records },
    });

    const sentIds = vi
      .mocked(deepSeek.recommend)
      .mock.calls[0]?.[0].candidates.map((candidate) => candidate.id);
    expect(sentIds).toHaveLength(OWNED_ECOMMERCE_DEEPSEEK_CANDIDATE_LIMIT);
    expect(sentIds).toEqual([...sentIds!].sort());
    expect(JSON.stringify(vi.mocked(deepSeek.recommend).mock.calls[0]?.[0])).not.toContain(
      "candidate-27",
    );
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-readiness-check",
          redactedMessage: expect.stringContaining("capped"),
        }),
      ]),
    );
  });

  it("caps projection catalog deterministically and records a readiness warning", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };
    const records = Array.from(
      { length: OWNED_ECOMMERCE_PROJECTION_CATALOG_LIMIT + 2 },
      (_, index) =>
        sourceRecord({ id: `projection-candidate-${String(index + 1).padStart(2, "0")}` }),
    ).reverse();

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-catalog-capped",
      deepSeek,
      evidence: { mlAccounts: records },
    });

    expect(result.projection.catalog.products).toHaveLength(
      OWNED_ECOMMERCE_PROJECTION_CATALOG_LIMIT,
    );
    expect(result.projection.candidateIds).toEqual([...result.projection.candidateIds].sort());
    expect(result.projection.candidateIds).not.toContain("projection-candidate-52");
    expect(result.projection.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-readiness-check",
          redactedMessage: expect.stringContaining("Projection catalog was capped"),
        }),
      ]),
    );
  });

  it("keeps validation records distinct when checks share a code", async () => {
    const recordValidation = vi.fn().mockResolvedValue(undefined);
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({ recommendations: [], usage: {} }),
    };

    await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-validation-ids",
      deepSeek,
      store: {
        upsertCandidate: vi.fn().mockResolvedValue(undefined),
        upsertProjection: vi.fn().mockResolvedValue(undefined),
        recordValidation,
      },
      evidence: {
        mlAccounts: [
          sourceRecord({ id: "media-missing-a", media: [] }),
          sourceRecord({ id: "media-missing-b", media: [] }),
        ],
      },
    });

    const validationRecords = recordValidation.mock.calls.map(([record]) => record);
    const missingReadinessRecords = validationRecords.filter(
      (record) => record.result.code === "missing-readiness-check",
    );
    expect(missingReadinessRecords.length).toBeGreaterThanOrEqual(2);
    expect(new Set(missingReadinessRecords.map((record) => record.id)).size).toBe(
      missingReadinessRecords.length,
    );
    expect(missingReadinessRecords.map((record) => record.evidenceIds)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["media-missing-a-evidence"]),
        expect.arrayContaining(["media-missing-b-evidence"]),
      ]),
    );
  });

  it("redacts credential refs and clamps ledger token and cost values", async () => {
    const deepSeek: OwnedEcommerceDeepSeekClient = {
      recommend: vi.fn().mockResolvedValue({
        recommendations: [],
        usage: {
          promptCacheHitTokens: Number.POSITIVE_INFINITY,
          promptCacheMissTokens: -5,
          outputTokens: 20_000_000,
        },
      }),
    };

    const result = await runOwnedEcommerceProjectionWorker({
      projectionId: "projection-ledger-bounds",
      credentialRef: "env:SECRET_DEEPSEEK_KEY_FOR_ACCOUNT_123",
      deepSeek,
      evidence: { mlAccounts: [sourceRecord({ id: "ledger-safe" })] },
    });

    expect(result.ledgerRecord.credentialRef).toMatch(/^redacted:env:/);
    expect(result.ledgerRecord.credentialRef).not.toContain("SECRET_DEEPSEEK_KEY_FOR_ACCOUNT_123");
    expect(result.ledgerRecord.promptCacheHitTokens).toBe(0);
    expect(result.ledgerRecord.promptCacheMissTokens).toBe(0);
    expect(result.ledgerRecord.outputTokens).toBe(10_000_000);
    expect(result.ledgerRecord.estimatedMicros).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.ledgerRecord.estimatedMicros)).toBe(true);
  });
});

function sourceRecord(overrides: Partial<OwnedEcommerceSourceRecord>): OwnedEcommerceSourceRecord {
  const id = overrides.id ?? "candidate-1";
  return {
    id,
    source: "plasticov",
    sourceId: `${id}-source`,
    itemRef: `${id}-sku`,
    title: `${id} title`,
    snapshotIds: [`${id}-snapshot`],
    evidenceIds: [`${id}-evidence`],
    stock: {
      status: "in-stock",
      authority: "stock-authoritative",
      quantity: 10,
      evidenceId: `${id}-stock`,
    },
    margin: { value: 15000, currency: "CLP", evidenceId: `${id}-margin` },
    evidenceState: {
      stockFreshness: "fresh",
      marginFreshness: "fresh",
      supplierFreshness: "fresh",
      completeness: "complete",
    },
    ...overrides,
  };
}
