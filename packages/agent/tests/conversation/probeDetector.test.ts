import { describe, expect, it } from "vitest";

import {
  analyzeQuestions,
  detectViewAnomalies,
} from "../../src/conversation/probeDetector.js";
import type { ProbeAlert } from "../../src/conversation/types.js";

// ── Helpers ───────────────────────────────────────────────────────────

function makeQuestion(
  text: string,
  overrides: Partial<{ from: string; date: string }> = {},
) {
  return {
    text,
    from: overrides.from ?? "usuario-X",
    date: overrides.date ?? "2026-06-26T10:00:00Z",
  };
}

// ── analyzeQuestions ──────────────────────────────────────────────────

describe("analyzeQuestions", () => {
  it("returns empty array for empty input", () => {
    expect(analyzeQuestions([])).toEqual([]);
  });

  it("returns no alert for a single normal question", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Cómo están mis ventas hoy?"),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("detects question_spike when same user sends >3 similar questions", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Cuál es el precio de este producto?", { from: "tienda-X" }),
      makeQuestion("¿Qué precio tiene este artículo?", { from: "tienda-X" }),
      makeQuestion("¿Cuánto sale este producto?", { from: "tienda-X" }),
      makeQuestion("¿Me decís el precio?", { from: "tienda-X" }),
    ]);

    const spike = alerts.find((a) => a.pattern === "question_spike");
    expect(spike).toBeDefined();
    expect(spike!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(spike!.competitorId).toBe("tienda-X");
    expect(spike!.description).toContain("tienda-X");
    expect(spike!.recommendedAction).toBe("monitor");
  });

  it("does NOT trigger question_spike with <=3 questions from same user", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Precio?", { from: "tienda-Y" }),
      makeQuestion("¿Costo?", { from: "tienda-Y" }),
      makeQuestion("¿Margen?", { from: "tienda-Y" }),
    ]);

    const spike = alerts.find((a) => a.pattern === "question_spike");
    expect(spike).toBeUndefined();
  });

  it("detects price_reaction when user asks >=2 pricing-focused questions", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Cuál es tu precio? ¿Cuánto margen manejás?", { from: "tienda-Z" }),
      makeQuestion("¿Hacés descuento por volumen? ¿Cómo está la rentabilidad?", {
        from: "tienda-Z",
      }),
    ]);

    const price = alerts.find((a) => a.pattern === "price_reaction");
    expect(price).toBeDefined();
    expect(price!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(price!.competitorId).toBe("tienda-Z");
    expect(price!.recommendedAction).toBe("deploy_decoy");
    expect(price!.description).toMatch(/precio/i);
  });

  it("does NOT trigger price_reaction for a single pricing question", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Cuál es el precio?", { from: "tienda-W" }),
    ]);

    const price = alerts.find((a) => a.pattern === "price_reaction");
    expect(price).toBeUndefined();
  });

  it("detects new_competitor from detailed business questions by low-activity user", () => {
    const alerts = analyzeQuestions([
      makeQuestion(
        "¿Cómo calculás el margen de ganancia en la categoría de electrónica " +
          "y cuánto stock manejás por producto?",
        { from: "cuenta-nueva-1" },
      ),
    ]);

    const newComp = alerts.find((a) => a.pattern === "new_competitor");
    expect(newComp).toBeDefined();
    expect(newComp!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(newComp!.competitorId).toBe("cuenta-nueva-1");
    expect(newComp!.recommendedAction).toBe("deploy_decoy");
    expect(newComp!.description).toMatch(/competidor/i);
    expect(newComp!.description).toMatch(/nueva/i);
  });

  it("does NOT trigger new_competitor for short, simple questions", () => {
    const alerts = analyzeQuestions([
      makeQuestion("Hola", { from: "cuenta-nueva-2" }),
      makeQuestion("Precio?", { from: "cuenta-nueva-2" }),
    ]);

    const newComp = alerts.find((a) => a.pattern === "new_competitor");
    expect(newComp).toBeUndefined();
  });

  it("can detect multiple alert types across different users", () => {
    const alerts = analyzeQuestions([
      // User A: spike
      makeQuestion("¿Precio?", { from: "A" }),
      makeQuestion("¿Costo?", { from: "A" }),
      makeQuestion("¿Margen?", { from: "A" }),
      makeQuestion("¿Rentabilidad?", { from: "A" }),
      // User B: price_reaction
      makeQuestion("¿Cuál es tu precio y margen?", { from: "B" }),
      makeQuestion("¿Ofrecés descuento? ¿Cuánto margen tenés?", { from: "B" }),
    ]);

    expect(alerts.some((a) => a.pattern === "question_spike")).toBe(true);
    expect(alerts.some((a) => a.pattern === "price_reaction")).toBe(true);
  });

  it("every generated alert has required ProbeAlert fields", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Precio?", { from: "X" }),
      makeQuestion("¿Costo?", { from: "X" }),
      makeQuestion("¿Margen?", { from: "X" }),
      makeQuestion("¿Rentabilidad?", { from: "X" }),
    ]);

    for (const alert of alerts) {
      expect(alert).toHaveProperty("pattern");
      expect(alert).toHaveProperty("confidence");
      expect(alert).toHaveProperty("description");
      expect(typeof alert.description).toBe("string");
      expect(alert.description.length).toBeGreaterThan(0);
      expect(alert.confidence).toBeGreaterThanOrEqual(0);
      expect(alert.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("confidence is always >= 0.6 when an alert is emitted", () => {
    const alerts = analyzeQuestions([
      makeQuestion("¿Precio?", { from: "X" }),
      makeQuestion("¿Costo?", { from: "X" }),
      makeQuestion("¿Margen?", { from: "X" }),
      makeQuestion("¿Rentabilidad?", { from: "X" }),
    ]);

    for (const alert of alerts) {
      expect(alert.confidence).toBeGreaterThanOrEqual(0.6);
    }
  });
});

// ── detectViewAnomalies ───────────────────────────────────────────────

describe("detectViewAnomalies", () => {
  it("returns empty array for less than 2 data points", () => {
    expect(detectViewAnomalies([])).toEqual([]);
    expect(detectViewAnomalies([{ count: 10, date: "2026-06-26" }])).toEqual(
      [],
    );
  });

  it("returns no alert when today's views are below 2x average", () => {
    const views = [
      { count: 100, date: "2026-06-19" },
      { count: 120, date: "2026-06-20" },
      { count: 110, date: "2026-06-21" },
      { count: 90, date: "2026-06-22" },
      { count: 105, date: "2026-06-23" },
      { count: 115, date: "2026-06-24" },
      { count: 100, date: "2026-06-25" },
      { count: 105, date: "2026-06-26" }, // today, ~1x avg
    ];

    expect(detectViewAnomalies(views)).toEqual([]);
  });

  it("detects view_anomaly when today's views exceed 2x trailing average", () => {
    const views = [
      { count: 50, date: "2026-06-19" },
      { count: 60, date: "2026-06-20" },
      { count: 55, date: "2026-06-21" },
      { count: 45, date: "2026-06-22" },
      { count: 50, date: "2026-06-23" },
      { count: 55, date: "2026-06-24" },
      { count: 50, date: "2026-06-25" },
      { count: 250, date: "2026-06-26" }, // today, ~5x avg of ~52
    ];

    const alerts = detectViewAnomalies(views);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].pattern).toBe("view_anomaly");
    expect(alerts[0].confidence).toBeGreaterThanOrEqual(0.6);
    expect(alerts[0].recommendedAction).toBe("monitor");
    expect(alerts[0].description).toContain("250");
    expect(alerts[0].description).toMatch(/pico/i);
  });

  it("does NOT divide by zero when all previous views are 0", () => {
    const views = [
      { count: 0, date: "2026-06-19" },
      { count: 0, date: "2026-06-20" },
      { count: 100, date: "2026-06-21" },
    ];

    const alerts = detectViewAnomalies(views);
    // Average of [0, 0] is 0 — avoid NaN
    expect(alerts).toHaveLength(0);
  });

  it("works with exactly 2 data points", () => {
    const views = [
      { count: 10, date: "2026-06-25" },
      { count: 50, date: "2026-06-26" },
    ];

    const alerts = detectViewAnomalies(views);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].pattern).toBe("view_anomaly");
  });
});
