import { describe, expect, it, vi } from "vitest";
import type { EconomicOutcome } from "@msl/domain";

import { createEconomicLearningDaemon } from "./economicLearningDaemon.js";

const verifiedOutcome: EconomicOutcome = {
  outcomeId: "outcome-target",
  sellerId: "seller-target",
  status: "verified",
  confidence: 1,
  completeness: 1,
  evidenceIds: [],
  createdAt: 1,
};

function claim(sellerId: string, outcomeId = "outcome-target") {
  return {
    messageId: "message-1",
    sellerId,
    payloadJson: JSON.stringify({ sellerId, outcomeId, status: "verified" }),
  };
}

describe("economicLearningDaemon", () => {
  it("reads only the referenced verified outcome in the claimed seller namespace", async () => {
    const getOutcome = vi.fn().mockReturnValue(verifiedOutcome);
    const handler = createEconomicLearningDaemon(
      {
        getOutcome,
        listOutcomesBySeller: vi.fn(() => {
          throw new Error("must not select the latest outcome");
        }),
      } as never,
      {
        isAlreadyProcessed: vi.fn().mockReturnValue(true),
        listByOutcome: vi.fn().mockReturnValue([]),
      } as never,
    );

    const result = await handler({
      claim: claim("seller-target") as never,
      sellerIds: ["seller-target"],
      reader: {} as never,
      cortex: {} as never,
      bus: {} as never,
    });

    expect(getOutcome).toHaveBeenCalledWith("outcome-target", "seller-target");
    expect(result.findings[0]?.summary).toContain("outcome-target");
  });

  it("does not read a cross-seller outcome and reports a missing outcome as a no-op", async () => {
    const getOutcome = vi.fn().mockReturnValue(null);
    const handler = createEconomicLearningDaemon({ getOutcome } as never, {} as never);

    const wrongSeller = await handler({
      claim: claim("seller-other") as never,
      sellerIds: ["seller-target"],
      reader: {} as never,
      cortex: {} as never,
      bus: {} as never,
    });
    expect(wrongSeller.findings).toEqual([]);
    expect(getOutcome).not.toHaveBeenCalled();

    const noOutcome = await handler({
      claim: claim("seller-target", "missing-outcome") as never,
      sellerIds: ["seller-target"],
      reader: {} as never,
      cortex: {} as never,
      bus: {} as never,
    });
    expect(noOutcome.findings[0]?.summary).toContain("missing-outcome");
    expect(noOutcome.proposalEnqueued).toBe(false);
  });
});
