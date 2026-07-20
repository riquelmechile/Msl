import { afterEach, describe, expect, it, vi } from "vitest";
import { MinimaxClient } from "../infrastructure/providers/minimax/minimax-client.js";
import { MinimaxRealTransport } from "../infrastructure/providers/minimax/minimaxTransport.js";

const context = {
  idempotencyKey: "attempt-a1",
  evidenceRef: "evidence:attempt-a1:submission",
  recordedAt: "2026-07-20T12:00:00.000Z",
};
const transport = new MinimaxRealTransport(
  new MinimaxClient({
    apiKey: "sk-test",
    apiHost: "https://api.minimax.io",
    timeoutMs: 30_000,
  }),
);
const submit = (body: unknown = {}, path = "/v1/image_generation") =>
  transport.submit({ path, body, ...context });
const response = (body: unknown, status: number, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, ...(headers ? { headers } : {}) });

afterEach(() => vi.restoreAllMocks());

describe("MiniMax durable submission evidence", () => {
  it("sends the canonical idempotency key and returns acceptance evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        { base_resp: { status_code: 0 }, task_id: "task-1", provider_request_id: "provider-1" },
        200,
      ),
    );
    const result = await submit({}, "/v1/video_generation");

    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": context.idempotencyKey,
    });
    expect(result).toMatchObject({
      kind: "accepted",
      providerRequestId: "provider-1",
      evidence: {
        ref: context.evidenceRef,
        kind: "submission",
        payload: { idempotencyKey: context.idempotencyKey, providerRequestId: "provider-1" },
      },
    });
  });

  it("returns transport-before-send proof only when zero body bytes were offered", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const result = await submit(cyclic);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      kind: "not-submitted",
      proof: {
        kind: "transport-before-send",
        authority: "minimax-transport",
        bodyBytesOffered: 0,
        evidenceRef: context.evidenceRef,
      },
    });
  });

  it("returns provider-rejection proof only for explicit unaccepted and uncharged evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response(
        {
          base_resp: { status_code: 1002, status_message: "rate limited" },
          provider_request_id: "provider-reject-1",
          accepted: false,
          charged: false,
        },
        429,
      ),
    );
    const result = await submit();

    expect(result).toMatchObject({
      kind: "rejected",
      proof: {
        kind: "provider-rejection",
        accepted: false,
        charged: false,
        providerRequestId: "provider-reject-1",
      },
    });
  });

  it.each([
    ["accepted", { provider_request_id: "forged-1", accepted: true, charged: false }],
    ["charged", { provider_request_id: "forged-2", accepted: false, charged: true }],
    ["missing request ID", { accepted: false, charged: false }],
    ["malformed status", { provider_request_id: "forged-3", accepted: false, charged: false }],
  ])("rejects forged %s rejection proof", async (variant, forged) => {
    const base_resp = {
      status_code: variant === "malformed status" ? "1002" : 1002,
      status_message: "rate limited",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ base_resp, ...forged }, 429));
    const result = await submit();
    expect(result).toMatchObject({ kind: "ambiguous" });
    expect(result).not.toHaveProperty("proof");
  });

  it("marks timeout after dispatch as ambiguous without proof", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timed out", "AbortError"));
    const result = await submit();
    expect(result).toMatchObject({ kind: "ambiguous" });
    expect(result).not.toHaveProperty("proof");
  });

  it("loseResponseAfterProviderAccept remains ambiguous and cannot release the hold", async () => {
    const providerAcceptanceLedger = new Map<string, string>();
    const order: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
      const key = (options?.headers as Record<string, string>)["Idempotency-Key"];
      if (!key) throw new Error("missing canonical idempotency key");
      providerAcceptanceLedger.set(key, "provider-request-accepted");
      order.push(`accepted:${key}`);
      order.push(`response-lost:${key}`);
      return Promise.reject(new Error("loseResponseAfterProviderAccept"));
    });
    const result = await submit({}, "/v1/video_generation");
    expect(providerAcceptanceLedger.get(context.idempotencyKey)).toBe("provider-request-accepted");
    expect(order.join("|")).toBe(
      `accepted:${context.idempotencyKey}|response-lost:${context.idempotencyKey}`,
    );
    expect(result).toMatchObject({
      kind: "ambiguous",
      evidence: {
        kind: "error",
        payload: { idempotencyKey: context.idempotencyKey, sendState: "possibly-sent" },
      },
    });
    expect(result).not.toHaveProperty("proof");
  });
});
