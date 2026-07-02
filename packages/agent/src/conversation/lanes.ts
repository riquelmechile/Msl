export type LaneId = "ceo" | "cost-supplier" | "market-catalog" | "creative-commercial";

export type CacheTelemetry = {
  provider: string;
  model: string;
  laneId: LaneId;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  credentialRef?: string;
  measuredAt: string;
};

export type LaneOutput = {
  laneId: LaneId;
  recommendation: string;
  missingInputs: string[];
  risks: string[];
  evidenceIds: string[];
  freshness: "fresh" | "stale" | "partial" | "unknown";
  cacheTelemetry?: CacheTelemetry;
  boundaryWarnings: string[];
};

export type LaneContract = {
  laneId: LaneId;
  label: string;
  stablePrefix: string;
  refreshableContextProvider: string;
  inputs: string[];
  outputs: string[];
  boundaries: string[];
  requiredEvidenceKinds: string[];
  credentialScope: "provider-default" | "api-key" | "account" | "user";
};

const phaseOneBoundary =
  "Phase 1 is proposal-only: never publish, mutate MercadoLibre, charge payments, contact SII, message customers, or execute external effects.";

export const CEO_LANE: LaneContract = {
  laneId: "ceo",
  label: "CEO/Socio",
  stablePrefix: [
    "You are the CEO/Socio lane for the seller.",
    "Coordinate bounded specialist investigations and synthesize one Spanish proposal.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "seller conversation, specialist outputs, approvals, and evidence IDs",
  inputs: ["seller request", "approved scope", "specialist lane outputs"],
  outputs: ["combined recommendation", "rationale", "risks", "missing inputs", "evidence IDs"],
  boundaries: ["ask before expanding scope", phaseOneBoundary],
  requiredEvidenceKinds: ["specialist-output", "approval-scope"],
  credentialScope: "provider-default",
};

export const COST_SUPPLIER_LANE: LaneContract = {
  laneId: "cost-supplier",
  label: "Cost/Supplier",
  stablePrefix: [
    "You are the Cost/Supplier lane.",
    "Evaluate cost, supplier, replenishment, and margin viability.",
    "Ask for missing cost, supplier, or target margin before claiming profitability.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider: "local cost, supplier, margin, stock, and freshness evidence",
  inputs: ["cost evidence", "supplier constraints", "target margin"],
  outputs: ["margin viability", "missing inputs", "risk notes", "evidence IDs"],
  boundaries: ["no confirmed profitability without cost/supplier evidence", phaseOneBoundary],
  requiredEvidenceKinds: ["cost", "supplier", "margin"],
  credentialScope: "provider-default",
};

export const MARKET_CATALOG_LANE: LaneContract = {
  laneId: "market-catalog",
  label: "Market/Catalog",
  stablePrefix: [
    "You are the Market/Catalog lane.",
    "Rank catalog, stock, rotation, competition, and freshness opportunities.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "local catalog, stock, rotation, visits, competition, and freshness evidence",
  inputs: ["catalog evidence", "stock evidence", "market evidence"],
  outputs: ["opportunity ranking", "freshness limits", "evidence IDs"],
  boundaries: ["do not remote-read before local evidence is checked", phaseOneBoundary],
  requiredEvidenceKinds: ["catalog", "stock", "market"],
  credentialScope: "provider-default",
};

export const CREATIVE_COMMERCIAL_LANE: LaneContract = {
  laneId: "creative-commercial",
  label: "Creative/Commercial",
  stablePrefix: [
    "You are the Creative/Commercial lane.",
    "Draft commercial angles, campaign copy, and preparation artifacts only.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider: "local product, campaign, channel, and prior outcome evidence",
  inputs: ["product evidence", "channel constraints", "campaign goals"],
  outputs: ["draft proposal", "campaign angle", "risks", "evidence IDs"],
  boundaries: ["draft only; never publish", phaseOneBoundary],
  requiredEvidenceKinds: ["product", "campaign", "outcome"],
  credentialScope: "provider-default",
};

export const LANE_CONTRACTS: readonly LaneContract[] = [
  CEO_LANE,
  COST_SUPPLIER_LANE,
  MARKET_CATALOG_LANE,
  CREATIVE_COMMERCIAL_LANE,
];

export function getLaneContract(laneId: LaneId): LaneContract {
  const contract = LANE_CONTRACTS.find((lane) => lane.laneId === laneId);
  if (!contract) throw new Error(`Unknown lane: ${laneId}`);
  return contract;
}
