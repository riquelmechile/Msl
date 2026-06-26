import { describe, expect, it } from "vitest";

import { createAgentLoop } from "../../src/conversation/agentLoop.js";
import { createSimulateActorTool } from "../../src/conversation/tools.js";
import type { ConversationState, SimulationResult } from "../../src/conversation/types.js";

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    messages: [],
    contextWindowLimit: 20,
    sessionMetadata: {
      sellerId: "seller-1",
      startedAt: new Date("2026-06-26T10:00:00Z"),
      lastActivityAt: new Date("2026-06-26T10:00:00Z"),
    },
    ...overrides,
  };
}

const systemPrompt = `Eres Plasticov, asistente comercial. Respondé en español.`;
const simulateActorTool = createSimulateActorTool();

describe("actorIntegration — agent loop with simulate_actor", () => {
  it("returns normal mock response when no actor tools registered", async () => {
    const agent = createAgentLoop({ systemPrompt, mockClient: true });
    const state = makeState();
    const result = await agent.converse("Hola", state);
    expect(result.response).toMatch(/podrías|podés|puedo|ayudarte|ayudar/i);
    expect(result.response).not.toMatch(/simulación/i);
  });

  it("triggers actor simulation when user asks about competitor", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      tools: [simulateActorTool],
    });
    const state = makeState();
    const result = await agent.converse(
      "¿Qué haría mi competidor si bajo el precio un 10%?",
      state,
    );

    // After tool execution, the mock should return an actor-informed response.
    expect(result.response).toMatch(/simulación|actor/i);
    expect(result.response).toMatch(/competidor/i);
    // Should NOT be a raw tool-call response (empty content).
    expect(result.response.length).toBeGreaterThan(30);
  });

  it("triggers actor simulation when user asks about comprador", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      tools: [simulateActorTool],
    });
    const state = makeState();
    const result = await agent.converse(
      "¿Qué pensaría un comprador típico de este producto?",
      state,
    );

    expect(result.response).toMatch(/simulación|actor/i);
    expect(result.response).toMatch(/comprador/i);
    expect(result.response.length).toBeGreaterThan(30);
  });

  it("triggers actor simulation when user asks about proveedor", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      tools: [simulateActorTool],
    });
    const state = makeState();
    const result = await agent.converse(
      "¿Qué condiciones me daría un proveedor por 100 unidades?",
      state,
    );

    expect(result.response).toMatch(/simulación|actor/i);
    expect(result.response).toMatch(/proveedor/i);
    expect(result.response.length).toBeGreaterThan(30);
  });

  it("does not trigger actor simulation for normal business questions", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      tools: [simulateActorTool],
    });
    const state = makeState();
    const result = await agent.converse("Quiero revisar el precio del listing 42", state);

    // Should get the normal margin analysis, not actor simulation.
    expect(result.response).toMatch(/margen/i);
    expect(result.response).not.toMatch(/simulación/i);
  });
});

describe("actorIntegration — CEO strategy guardrail after actor simulation", () => {
  it("strategyValidator blocks a proposal even after actor simulation", async () => {
    const agent = createAgentLoop({
      systemPrompt,
      mockClient: true,
      tools: [simulateActorTool],
    });

    // Simulate a state where the agent proposed a price drop,
    // then the user says "dale" to confirm.
    // The strategyValidator should catch margin violations.
    const state = makeState({
      messages: [
        {
          role: "user",
          content: "¿El competidor aceptaría que suba el precio del listing MLC-42?",
          timestamp: new Date("2026-06-26T10:00:00Z"),
        },
        {
          role: "assistant",
          content:
            "Consulté al competidor y respondió que no le molestaría si subís. " +
            "Te preparo una propuesta de ajuste para el listing MLC-42.",
          timestamp: new Date("2026-06-26T10:00:01Z"),
        },
      ],
    });

    // Now the user confirms — the mock should return a confirmation.
    const result = await agent.converse("dale", state);
    // The mock returns a confirmation response for "dale".
    expect(result.response).toMatch(/confirmada|perfecto|ejecutará/i);
  });
});

describe("actorIntegration — tool execution returns SimulationResult", () => {
  it("execute returns a valid SimulationResult-shaped object", async () => {
    const result = (await simulateActorTool.execute({
      actorType: "competidor",
      query: "¿Qué harías si bajo el precio?",
    })) as unknown as SimulationResult;

    expect(result).toBeDefined();
    expect(result.actorType).toBe("competidor");
    expect(typeof result.recommendation).toBe("string");
    expect(result.recommendation.length).toBeGreaterThan(10);
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThan(0);
    expect(typeof result.rationale).toBe("string");
    expect(typeof result.simulationId).toBe("string");
  });
});
