import { describe, expect, it } from "vitest";

import { generateDailySummary, type InsightCandidate } from "./index.js";

const now = new Date("2026-06-25T12:00:00.000Z");

describe("daily business insight summary", () => {
  it("ranks priorities by profit, urgency, reputation risk, and confidence", () => {
    const summary = generateDailySummary({
      now,
      candidates: [
        candidate({
          id: "low",
          profitImpact: 4,
          urgency: 3,
          reputationRisk: 1,
          confidence: "medium",
        }),
        candidate({
          id: "high",
          profitImpact: 8,
          urgency: 8,
          reputationRisk: 7,
          confidence: "high",
        }),
      ],
    });

    expect(summary.priorities.map((priority) => priority.id)).toEqual(["high", "low"]);
    expect(summary.priorities[0]).toMatchObject({ rank: 1, confidence: "high" });
    expect(summary.priorities[0]?.businessReason).toContain("profit");
    expect(summary.priorities[0]?.expectedTradeoff).toContain("risk");
  });

  it("discloses stale data for critical priorities", () => {
    const summary = generateDailySummary({
      now,
      candidates: [
        candidate({
          id: "stale-claim",
          signalKind: "claim",
          capturedAt: new Date("2026-06-25T11:50:00.000Z"),
          profitImpact: 6,
          urgency: 9,
          reputationRisk: 10,
          confidence: "low",
        }),
      ],
    });

    expect(summary.priorities[0]?.freshness.status).toBe("stale");
    expect(summary.staleDataDisclosures).toEqual([
      "Datos desactualizados en reclamos; refrescar antes de la guía final si afecta una prioridad crítica.",
    ]);
    expect(summary.staleDataDisclosures.join(" ")).not.toContain("stale");
    expect(summary.staleDataDisclosures.join(" ")).not.toContain("claim");
  });
});

function candidate(overrides: Partial<InsightCandidate>): InsightCandidate {
  return {
    id: "candidate",
    title: "Prioridad diaria",
    businessReason: "Improve profit while protecting buyer experience.",
    expectedTradeoff: "Higher margin may increase reputation risk if claims are ignored.",
    profitImpact: 5,
    urgency: 5,
    reputationRisk: 5,
    confidence: "medium",
    signalKind: "order",
    capturedAt: new Date("2026-06-25T11:59:00.000Z"),
    ...overrides,
  };
}
