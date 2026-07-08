export type LaneId =
  | "ceo"
  | "cost-supplier"
  | "market-catalog"
  | "creative-assets"
  | "creative-commercial"
  | "creative-studio"
  | "operations-manager"
  | "owned-ecommerce"
  | "product-ads-monitor"
  | "product-ads-ceo-profitability"
  | "product-ads-profitability"
  | "supplier-manager"
  | "morning-report"
  | "eod-summary"
  | "unanswered-questions";

export type CacheTelemetry = {
  provider: string;
  model: string;
  laneId: LaneId;
  promptCacheHitTokens: number | null;
  promptCacheMissTokens: number | null;
  credentialRefRedacted?: string;
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
    "For Supplier Mirror and Owned Ecommerce, review evidence, alerts, mappings, projections, and policy proposals through CEO-facing tools only; never ask the user to select internal workers.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "seller conversation, specialist outputs, approvals, and evidence IDs",
  inputs: [
    "seller request",
    "approved scope",
    "specialist lane outputs",
    "Supplier Mirror evidence",
    "Owned Ecommerce projection evidence",
  ],
  outputs: ["combined recommendation", "rationale", "risks", "missing inputs", "evidence IDs"],
  boundaries: [
    "ask before expanding scope",
    "do not expose internal supplier worker selection",
    phaseOneBoundary,
  ],
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
    "Return bounded Supplier Mirror evidence to the CEO; do not message the user directly.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider: "local cost, supplier, margin, stock, and freshness evidence",
  inputs: ["cost evidence", "supplier constraints", "target margin"],
  outputs: [
    "margin viability",
    "supplier mirror opportunity evidence",
    "missing inputs",
    "risk notes",
    "evidence IDs",
  ],
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

export const OPERATIONS_MANAGER_LANE: LaneContract = {
  laneId: "operations-manager",
  label: "Operations Manager",
  stablePrefix: [
    "You are the Operations Manager lane.",
    "Monitor claims, questions, messages, orders, and reputation for the seller.",
    "Detect new open claims, unanswered questions, delayed orders, and reputation risks.",
    "Output proposal-only: enqueue findings to the CEO for review; never execute mutations.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "claims, questions, messages, orders, and reputation evidence",
  inputs: ["claim evidence", "question evidence", "order evidence", "reputation evidence"],
  outputs: ["operational alerts", "risk priority", "evidence IDs"],
  boundaries: [
    "proposal-only; never respond to buyers, resolve claims, or execute mutations",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["claim", "question", "order", "reputation"],
  credentialScope: "provider-default",
};

export const OWNED_ECOMMERCE_LANE: LaneContract = {
  laneId: "owned-ecommerce",
  label: "Owned Ecommerce",
  stablePrefix: [
    "You are the internal Owned Ecommerce specialist lane.",
    "Prepare Medusa-ready storefront recommendations, projection readiness, SEO/GEO positioning, and approval needs for the CEO Agent only.",
    "Return evidence-backed outputs to the CEO lane; never message the human directly or expose internal worker selection.",
    "Preview/proposal-only: never publish publicly, activate checkout or payments, change prices or stock, expose credentials, or approve risky claims.",
  ].join("\n"),
  refreshableContextProvider:
    "owned ecommerce candidates, storefront projections, readiness checks, validation results, approval records, and evidence IDs",
  inputs: [
    "storefront candidates",
    "projection evidence",
    "readiness checks",
    "validation results",
    "CEO approval scope",
  ],
  outputs: [
    "ranked storefront recommendations",
    "readiness summary",
    "risks",
    "approval needs",
    "evidence IDs",
  ],
  boundaries: [
    "CEO-only Telegram path; do not message the human directly",
    "proposal-only; no public publish, checkout/payment activation, price mutation, or stock mutation",
    "fail closed for unsupported risky claims, missing credentials, missing audit records, and failed readiness checks",
  ],
  requiredEvidenceKinds: [
    "storefront-projection",
    "readiness-check",
    "approval-scope",
    "evidence-id",
  ],
  credentialScope: "provider-default",
};

export const PRODUCT_ADS_MONITOR_LANE: LaneContract = {
  laneId: "product-ads-monitor",
  label: "Product Ads Monitor",
  stablePrefix: [
    "You are the Product Ads Monitor lane.",
    "Monitor Product Ads campaign performance, profitability, visit trends, and cross-account coverage.",
    "Detect unprofitable ads, declining visits, monopoly risks, low ROAS, and opportunity gaps.",
    "Output proposal-only: enqueue findings to the CEO for review; never execute mutations.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "product-ads insights, cost snapshots, visit trends, and listing snapshots",
  inputs: ["product-ads-insights", "cost-snapshot", "visit-snapshot", "listing-snapshot"],
  outputs: ["ad performance alerts", "risk priority", "opportunity gaps", "evidence IDs"],
  boundaries: [
    "proposal-only; never execute mutations",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["product-ads-insights", "cost-snapshot", "visit-snapshot", "listing-snapshot"],
  credentialScope: "provider-default",
};

export const SUPPLIER_MANAGER_LANE: LaneContract = {
  laneId: "supplier-manager",
  label: "Supplier Manager",
  stablePrefix: [
    "You are the Supplier Manager lane.",
    "Monitor supplier items, stock discrepancies, price changes, and unfilled mirror items.",
    "Detect cross-account stock gaps, supplier price shifts >5%, and unpublished mirror items.",
    "Output proposal-only: enqueue findings to the CEO for review; never execute mutations.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "supplier mirror store, Cortex listing snapshots, sync ledger",
  inputs: ["supplier-mirror-evidence", "listing-snapshot", "sync-ledger"],
  outputs: ["supplier alerts", "stock discrepancy warnings", "price change warnings", "evidence IDs"],
  boundaries: [
    "proposal-only; never execute mutations",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["supplier-mirror-evidence", "listing-snapshot", "sync-ledger"],
  credentialScope: "provider-default",
};

export const PRODUCT_ADS_PROFITABILITY_LANE: LaneContract = {
  laneId: "product-ads-profitability",
  label: "Product Ads Profitability",
  stablePrefix: [
    "You are the Product Ads Profitability lane.",
    "Evaluate per-product advertising economics inside each campaign: net contribution, margin, ROAS, CVR, CPC, units, conversion, and data completeness.",
    "Compute CFO-grade signals (margin-consuming, scale candidate, budget waste, underinvested, unit economics) per product independently — never average campaign-level aggregates into product decisions.",
    "Emit daily data-quality notices for insufficient cost/unit evidence; seller-impacting recommendations (budget, pause, scale) only on a rolling 7-day cadence.",
    "Output proposal-only: enqueue findings to the CEO for review; never execute mutations.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "product-ads insights, Cortex cost snapshots, listing snapshots",
  inputs: ["product-ads-insights", "cost-snapshot", "listing-snapshot"],
  outputs: ["cfo profitability signals", "data completeness findings", "scale/risk recommendations", "evidence IDs"],
  boundaries: [
    "proposal-only; never execute mutations",
    "no profitability claims without cost evidence",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["product-ads-insights", "cost-snapshot", "listing-snapshot"],
  credentialScope: "provider-default",
};

export const CREATIVE_ASSETS_LANE: LaneContract = {
  laneId: "creative-assets",
  label: "Creative Assets Monitor",
  stablePrefix: [
    "You are the Creative Assets Monitor lane.",
    "Monitor creative quality, moderation status, image counts, and PICTURES scores.",
    "Detect listings with low image count, moderation blocks, poor PICTURES scores, high-traffic listings with poor creative, and moderated listings in active campaigns.",
    "Output proposal-only: enqueue findings to the CEO for review; never execute mutations.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "creative snapshots, visit snapshots, product-ads-insights, and moderation evidence",
  inputs: ["creative-snapshot", "visit-snapshot", "product-ads-insights"],
  outputs: ["creative asset alerts", "risk priority", "evidence IDs"],
  boundaries: [
    "proposal-only; never execute mutations",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["creative-snapshot", "visit-snapshot", "product-ads-insights"],
  credentialScope: "provider-default",
};

export const CREATIVE_STUDIO_LANE: LaneContract = {
  laneId: "creative-studio",
  label: "Creative Studio",
  stablePrefix: [
    "You are the Creative Studio lane.",
    "Generate or edit product images, short clips, and creative assets on demand.",
    "Receive creative requests via the agent message bus from any authorized agent.",
    "Apply image policies, MercadoLibre diagnostic pre-checks, and cost controls.",
    "Return candidate assets with cost, provider, and policy metadata.",
    "Never publish directly to any channel. Always require CEO (or channel agent) approval.",
    phaseOneBoundary,
  ].join("\n"),
  refreshableContextProvider:
    "creative job queue, MiniMax API, Cortex outcome history, style profiles",
  inputs: [
    "creative-asset-request",
    "product-context",
    "reference-images",
    "channel-constraints",
  ],
  outputs: [
    "creative-execution-result",
    "candidate-assets",
    "policy-flags",
    "cost-report",
    "evidence-ids",
  ],
  boundaries: [
    "prepare-only; never publish, upload, or mutate external channels",
    "never generate without product truth constraints",
    "never exceed budget without approval",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["product", "reference-image", "channel-constraint"],
  credentialScope: "api-key",
};

export const PRODUCT_ADS_CEO_PROFITABILITY_LANE: LaneContract = {
  laneId: "product-ads-ceo-profitability",
  label: "Product Ads CEO Profitability",
  stablePrefix: [
    "You are the Product Ads CEO Profitability handler.",
    "Process CFO-grade profitability signals from the profitability daemon into actionable Product Ads actions.",
    "Map signals to actions: margin-consuming→pause-campaign, scale-candidate→adjust-campaign-budget, budget-waste→review-campaign-structure, underinvested→adjust-campaign-budget, unit-economics→review-campaign-structure.",
    "Send proactive Telegram notifications to seller forum topics with 7-day deduplication.",
  ].join("\n"),
  refreshableContextProvider: "profitability proposals, seller forum topics, deduplication state",
  inputs: ["profitability-proposal"],
  outputs: ["product-ads-action", "telegram-notification"],
  boundaries: [
    "no auto-execution — always requires seller approval for actionable findings",
    phaseOneBoundary,
  ],
  requiredEvidenceKinds: ["product-ads-insights", "cost-snapshot"],
  credentialScope: "provider-default",
};

export const LANE_CONTRACTS: readonly LaneContract[] = [
  CEO_LANE,
  COST_SUPPLIER_LANE,
  MARKET_CATALOG_LANE,
  CREATIVE_ASSETS_LANE,
  CREATIVE_COMMERCIAL_LANE,
  CREATIVE_STUDIO_LANE,
  OPERATIONS_MANAGER_LANE,
  OWNED_ECOMMERCE_LANE,
  PRODUCT_ADS_MONITOR_LANE,
  PRODUCT_ADS_CEO_PROFITABILITY_LANE,
  PRODUCT_ADS_PROFITABILITY_LANE,
  SUPPLIER_MANAGER_LANE,
];

export function getLaneContract(laneId: LaneId): LaneContract {
  const contract = LANE_CONTRACTS.find((lane) => lane.laneId === laneId);
  if (!contract) throw new Error(`Unknown lane: ${laneId}`);
  return contract;
}
