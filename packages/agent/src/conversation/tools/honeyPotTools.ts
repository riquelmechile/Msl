import type { DecoyProposal, Strategy } from "../types.js";
import type { GuardResult } from "../guardrails.js";
import { proposeDecoy as defaultProposeDecoy } from "../honeyPotProposer.js";
import type { ToolDefinition } from "./types.js";

// ── Helper types ───────────────────────────────────────────────────────

type ProposeDecoyFn = typeof defaultProposeDecoy;
type HoneyPotValidatorFn = (proposal: DecoyProposal, strategies: Strategy[]) => GuardResult;

// ── Propose Honey Pot Tool ─────────────────────────────────────────────

export function createProposeHoneyPotTool(
  proposer: ProposeDecoyFn,
  guardrail: HoneyPotValidatorFn,
  getStrategies: () => Strategy[],
  onProposed?: (proposal: DecoyProposal) => void,
): ToolDefinition {
  return {
    name: "propose_honey_pot",
    description:
      "Propone una operación de contrainteligencia basada en estrategias " +
      "activas del CEO. La propuesta incluye un listing señuelo para " +
      "detectar y analizar el comportamiento de competidores.",
    parameters: {
      type: "object",
      properties: {
        strategyId: {
          type: "number",
          description:
            "ID de la estrategia activa de tipo 'probe' a utilizar. " +
            "Obtenelo de la lista de estrategias activas.",
        },
      },
      required: ["strategyId"],
    },
    execute: (args: Record<string, unknown>): Record<string, unknown> => {
      const strategyId = typeof args.strategyId === "number" ? args.strategyId : NaN;
      if (isNaN(strategyId)) {
        return { error: "El parámetro 'strategyId' debe ser un número." };
      }

      const strategies = getStrategies();
      const strategy = strategies.find((s) => s.id === strategyId && s.status === "active");

      if (!strategy) {
        return {
          error:
            `No se encontró una estrategia activa con ID ${strategyId}. ` +
            "Revisá las estrategias activas con 'listá mis estrategias'.",
        };
      }

      if (strategy.ruleType !== "probe") {
        return {
          error:
            `La estrategia #${strategyId} es de tipo "${strategy.ruleType}", ` +
            "no de tipo 'probe'. Seleccioná una estrategia de contrainteligencia.",
        };
      }

      const proposal = proposer(strategy);
      const guard = guardrail(proposal, strategies);

      if (!guard.passed) {
        return { error: guard.reason };
      }

      onProposed?.(proposal);

      return proposal;
    },
  };
}
