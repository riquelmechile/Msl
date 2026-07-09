import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { createDaemonAdvisorsFromEnv } from "../../src/conversation/createDaemonAdvisors.js";
import { resetDeepSeekClient } from "../../src/conversation/deepseekClient.js";

// ── Tests ────────────────────────────────────────────────────────────

describe("createDaemonAdvisorsFromEnv", () => {
  beforeEach(() => {
    resetDeepSeekClient();
  });

  afterEach(() => {
    resetDeepSeekClient();
    vi.restoreAllMocks();
  });

  it("returns empty object when DEEPSEEK_API_KEY is missing", () => {
    const result = createDaemonAdvisorsFromEnv({});
    expect(result).toEqual({});
  });

  it("returns empty object when DEEPSEEK_API_KEY is empty string", () => {
    const result = createDaemonAdvisorsFromEnv({ DEEPSEEK_API_KEY: "" });
    expect(result).toEqual({});
  });

  it("returns empty object when seller IDs are missing", () => {
    const result = createDaemonAdvisorsFromEnv({
      DEEPSEEK_API_KEY: "sk-test",
    });
    expect(result).toEqual({});
  });

  it("returns only advisors without supplier mirror when store is missing", () => {
    const result = createDaemonAdvisorsFromEnv({
      DEEPSEEK_API_KEY: "sk-test",
      MERCADOLIBRE_SOURCE_SELLER_ID: "seller-1",
      MERCADOLIBRE_TARGET_SELLER_ID: "seller-2",
    });

    // SupplierMirrorDeepSeekAdvisor should be undefined (no store)
    expect(result.advisor).toBeUndefined();

    // Other advisors should be created
    expect(result.operationsAdvisor).toBeDefined();
    expect(result.catalogAdvisor).toBeDefined();
    expect(result.costSupplierAdvisor).toBeDefined();
    expect(result.creativeAdvisor).toBeDefined();
  });

  it("creates SupplierMirrorDeepSeekAdvisor when store is provided", () => {
    const mockStore = {
      getStoredSuppliers: vi.fn().mockReturnValue([]),
      getSupplier: vi.fn(),
    } as never;

    const result = createDaemonAdvisorsFromEnv(
      {
        DEEPSEEK_API_KEY: "sk-test",
        MERCADOLIBRE_SOURCE_SELLER_ID: "seller-1",
        MERCADOLIBRE_TARGET_SELLER_ID: "seller-2",
      },
      { supplierMirrorStore: mockStore },
    );

    expect(result.advisor).toBeDefined();
    expect(result.operationsAdvisor).toBeDefined();
    expect(result.catalogAdvisor).toBeDefined();
    expect(result.costSupplierAdvisor).toBeDefined();
    expect(result.creativeAdvisor).toBeDefined();
  });

  it("works with only source seller ID", () => {
    const result = createDaemonAdvisorsFromEnv({
      DEEPSEEK_API_KEY: "sk-test",
      MERCADOLIBRE_SOURCE_SELLER_ID: "seller-1",
    });

    expect(result.operationsAdvisor).toBeDefined();
    expect(result.catalogAdvisor).toBeDefined();
    expect(result.costSupplierAdvisor).toBeDefined();
    expect(result.creativeAdvisor).toBeDefined();
  });

  it("includes ledger when provided", () => {
    const mockLedger = {} as never;
    const result = createDaemonAdvisorsFromEnv(
      {
        DEEPSEEK_API_KEY: "sk-test",
        MERCADOLIBRE_SOURCE_SELLER_ID: "seller-1",
      },
      { ledger: mockLedger },
    );

    // Should not throw — ledger is passed through to constructors
    expect(result.operationsAdvisor).toBeDefined();
  });
});
