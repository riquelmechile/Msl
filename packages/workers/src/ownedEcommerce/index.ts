import type {
  CandidateSourceKind,
  EvidenceClaim,
  EvidenceCompleteness,
  EvidenceFreshness,
  GuardrailCode,
  GuardrailResult,
  OptimizedMedia,
  StockAuthority,
  StorefrontCandidate,
  StorefrontProjection,
} from "@msl/domain";
import { DEFAULT_DEEPSEEK_MODEL, resolveDeepSeekCredentialRef } from "@msl/agent";
import { guardrailsForCandidateEvidence, summarizeProjectionReadiness } from "@msl/domain";
import type { OwnedEcommerceStore } from "@msl/memory";

export const OWNED_ECOMMERCE_DEEPSEEK_PROVIDER = "deepseek";
export const OWNED_ECOMMERCE_DEEPSEEK_V4_FLASH = DEFAULT_DEEPSEEK_MODEL;
export const OWNED_ECOMMERCE_DEEPSEEK_V4_PRO = "deepseek-v4-pro";
export const OWNED_ECOMMERCE_DEEPSEEK_CANDIDATE_LIMIT = 25;
export const OWNED_ECOMMERCE_PROJECTION_CATALOG_LIMIT = 50;
export const DEFAULT_OWNED_ECOMMERCE_DEEPSEEK_TIMEOUT_MS = 15_000;

const DEFAULT_MEDIA_WIDTH = 1_200;
const DEFAULT_MEDIA_HEIGHT = 1_200;
const DEFAULT_MEDIA_SIZES = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw";
const STATIC_PREVIEW_MEDIA_PLACEHOLDER_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 1200'%3E%3Crect width='1200' height='1200' fill='%23f4f1ea'/%3E%3Ctext x='600' y='610' text-anchor='middle' font-family='Arial, sans-serif' font-size='56' fill='%23352a22'%3EPreview media%3C/text%3E%3C/svg%3E";
const MAX_LEDGER_TOKEN_COUNT = 10_000_000;
const MAX_LEDGER_ESTIMATED_MICROS = 100_000_000_000;

export type OwnedEcommerceDeepSeekModel =
  typeof OWNED_ECOMMERCE_DEEPSEEK_V4_FLASH | typeof OWNED_ECOMMERCE_DEEPSEEK_V4_PRO;

export type OwnedEcommerceDeepSeekOperation =
  "storefront-ranking" | "seo-geo-copy" | "policy-conflict" | "publish-checkout-prep";

export type OwnedEcommerceDeepSeekPricing = {
  model: OwnedEcommerceDeepSeekModel;
  inputCacheHitMicrosPerMillionTokens: number;
  inputCacheMissMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  source: "deepseek-official-pricing-2026-07";
};

export const OWNED_ECOMMERCE_DEEPSEEK_PRICING: Readonly<
  Record<OwnedEcommerceDeepSeekModel, OwnedEcommerceDeepSeekPricing>
> = Object.freeze({
  [OWNED_ECOMMERCE_DEEPSEEK_V4_FLASH]: Object.freeze({
    model: OWNED_ECOMMERCE_DEEPSEEK_V4_FLASH,
    inputCacheHitMicrosPerMillionTokens: 2_800,
    inputCacheMissMicrosPerMillionTokens: 140_000,
    outputMicrosPerMillionTokens: 280_000,
    source: "deepseek-official-pricing-2026-07",
  }),
  [OWNED_ECOMMERCE_DEEPSEEK_V4_PRO]: Object.freeze({
    model: OWNED_ECOMMERCE_DEEPSEEK_V4_PRO,
    inputCacheHitMicrosPerMillionTokens: 3_625,
    inputCacheMissMicrosPerMillionTokens: 435_000,
    outputMicrosPerMillionTokens: 870_000,
    source: "deepseek-official-pricing-2026-07",
  }),
});

export type OwnedEcommerceSourceRecord = {
  id: string;
  source: CandidateSourceKind;
  sourceId: string;
  itemRef: string;
  title: string;
  accountId?: string;
  supplierId?: string;
  categoryId?: string;
  snapshotIds?: readonly string[];
  cortexNodeIds?: readonly string[];
  evidenceIds: readonly string[];
  stock: {
    status: StorefrontCandidate["stock"]["status"];
    authority: StockAuthority;
    quantity?: number;
    evidenceId?: string;
  };
  margin?: StorefrontCandidate["margin"];
  evidenceState: {
    stockFreshness: EvidenceFreshness;
    marginFreshness: EvidenceFreshness;
    supplierFreshness: EvidenceFreshness;
    completeness: EvidenceCompleteness;
  };
  media?: readonly OwnedEcommerceMediaInput[];
  riskyClaims?: readonly OwnedEcommerceClaimInput[];
  containsSecret?: boolean;
  requestedOperations?: readonly OwnedEcommerceRequestedOperation[];
};

export type OwnedEcommerceMediaInput = {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  evidenceIds: readonly string[];
};

export type OwnedEcommerceClaimInput = {
  id: string;
  text: string;
  claimType: EvidenceClaim["claimType"];
  evidenceIds?: readonly string[];
};

export type OwnedEcommerceRequestedOperation =
  "checkout" | "payment" | "publish" | "price" | "stock";

export type OwnedEcommerceEvidenceInput = {
  mlAccounts?: readonly OwnedEcommerceSourceRecord[];
  supplierMirror?: readonly OwnedEcommerceSourceRecord[];
  futureSuppliers?: readonly OwnedEcommerceSourceRecord[];
  readModel?: readonly OwnedEcommerceSourceRecord[];
  cortex?: readonly OwnedEcommerceSourceRecord[];
};

export type OwnedEcommerceDeepSeekPromptPlanInput = {
  laneId?: string;
  projectionId: string;
  candidateIds: readonly string[];
  evidenceIds: readonly string[];
  supplierScope?: readonly string[];
  accountScope?: readonly string[];
  sourceSummaries?: readonly string[];
};

export type OwnedEcommerceDeepSeekPromptPlan = {
  stablePrefix: string;
  cacheableContextBlock: string;
  volatileContextBlock: string;
  metadata: Readonly<Record<string, string>>;
};

export type OwnedEcommerceDeepSeekRecommendation = {
  candidateId: string;
  rank: number;
  rationale: string;
  evidenceIds: readonly string[];
  seoTitle?: string;
  geoCopy?: string;
  claims?: readonly OwnedEcommerceClaimInput[];
};

export type OwnedEcommerceDeepSeekCandidateDto = {
  id: string;
  stock: Pick<StorefrontCandidate["stock"], "status" | "authority" | "quantity">;
  margin?: StorefrontCandidate["margin"];
  evidenceRefs: readonly string[];
  mediaCount: number;
};

export type OwnedEcommerceDeepSeekUsage = {
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  outputTokens?: number;
};

export type OwnedEcommerceDeepSeekClient = {
  recommend(input: {
    model: OwnedEcommerceDeepSeekModel;
    prompt: OwnedEcommerceDeepSeekPromptPlan;
    candidates: readonly OwnedEcommerceDeepSeekCandidateDto[];
  }): Promise<{
    recommendations: readonly OwnedEcommerceDeepSeekRecommendation[];
    usage?: OwnedEcommerceDeepSeekUsage;
  }>;
};

export type OwnedEcommerceCostCacheLedgerRecord = {
  id: string;
  provider: typeof OWNED_ECOMMERCE_DEEPSEEK_PROVIDER;
  model: OwnedEcommerceDeepSeekModel;
  laneId: string;
  credentialRef: string;
  projectionId: string;
  promptCacheHitTokens: number;
  promptCacheMissTokens: number;
  outputTokens: number;
  estimatedMicros: number | undefined;
  createdAt: string;
};

export type OwnedEcommerceProjectionWorkerOptions = {
  evidence: OwnedEcommerceEvidenceInput;
  deepSeek: OwnedEcommerceDeepSeekClient;
  store?: Pick<OwnedEcommerceStore, "upsertCandidate" | "upsertProjection" | "recordValidation">;
  now?: () => Date;
  projectionId?: string;
  collectionHandle?: string;
  laneId?: string;
  credentialRef?: string;
  deepSeekTimeoutMs?: number;
};

export type OwnedEcommerceProjectionWorkerResult = {
  candidates: readonly StorefrontCandidate[];
  eligibleCandidates: readonly StorefrontCandidate[];
  projection: StorefrontProjection;
  recommendations: readonly OwnedEcommerceDeepSeekRecommendation[];
  ledgerRecord: OwnedEcommerceCostCacheLedgerRecord;
};

export function selectOwnedEcommerceDeepSeekModel(input: {
  operation: OwnedEcommerceDeepSeekOperation;
  hardPolicyConflict?: boolean;
}): OwnedEcommerceDeepSeekModel {
  return input.operation === "policy-conflict" ||
    input.operation === "publish-checkout-prep" ||
    input.hardPolicyConflict === true
    ? OWNED_ECOMMERCE_DEEPSEEK_V4_PRO
    : OWNED_ECOMMERCE_DEEPSEEK_V4_FLASH;
}

export function estimateOwnedEcommerceDeepSeekCostMicros(input: {
  model: string;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  outputTokens?: number;
}): number | undefined {
  const pricing = OWNED_ECOMMERCE_DEEPSEEK_PRICING[input.model as OwnedEcommerceDeepSeekModel];
  if (!pricing) return undefined;
  const hitCost =
    (sanitizeLedgerNumber(input.promptCacheHitTokens) *
      pricing.inputCacheHitMicrosPerMillionTokens) /
    1_000_000;
  const missCost =
    (sanitizeLedgerNumber(input.promptCacheMissTokens) *
      pricing.inputCacheMissMicrosPerMillionTokens) /
    1_000_000;
  const outputCost =
    (sanitizeLedgerNumber(input.outputTokens) * pricing.outputMicrosPerMillionTokens) / 1_000_000;
  return sanitizeLedgerNumber(
    Math.ceil(hitCost + missCost + outputCost),
    MAX_LEDGER_ESTIMATED_MICROS,
  );
}

export function buildOwnedEcommerceDeepSeekPromptPlan(
  input: OwnedEcommerceDeepSeekPromptPlanInput,
): OwnedEcommerceDeepSeekPromptPlan {
  const laneId = input.laneId ?? "owned-ecommerce";
  const candidateIds = [...input.candidateIds].sort();
  const evidenceIds = [...input.evidenceIds].sort();
  const sourceSummaryCount = input.sourceSummaries?.length ?? 0;
  const stablePrefix = [
    "You are the Owned Ecommerce worker for the CEO.",
    "Keep all ecommerce-worker activity internal and return proposal-only evidence to the CEO Agent.",
    "Do not publish, activate checkout or payments, change prices or stock, expose secrets, or message the human.",
  ].join("\n");
  const cacheableContextBlock = [
    "## Owned Ecommerce Cacheable Context",
    `- laneId: ${laneId}`,
    "- target: Medusa-ready static storefront projection",
    "- autonomy: preview/proposal-only",
    "- guardrails: freshness, stock authority, margin, secrets, checkout/payment, publish, price/stock, risky claims",
    `- sourceBuckets: ${sourceSummaryCount}`,
  ].join("\n");
  const volatileContextBlock = [
    "## Owned Ecommerce Refreshable Evidence",
    `- projectionId: ${input.projectionId}`,
    `- candidateIds: ${candidateIds.join(", ") || "none"}`,
    `- evidenceIds: ${evidenceIds.join(", ") || "none"}`,
    "- Put changing products, prices, stock, media, read-model rows, and Cortex summaries here.",
  ].join("\n");

  return {
    stablePrefix,
    cacheableContextBlock,
    volatileContextBlock,
    metadata: Object.freeze({
      provider: OWNED_ECOMMERCE_DEEPSEEK_PROVIDER,
      modelDefault: OWNED_ECOMMERCE_DEEPSEEK_V4_FLASH,
      modelEscalation: OWNED_ECOMMERCE_DEEPSEEK_V4_PRO,
      cacheStrategy: "stable-prefix-plus-refreshable-evidence",
      laneId,
    }),
  };
}

export function collectOwnedEcommerceCandidates(input: {
  evidence: OwnedEcommerceEvidenceInput;
  now?: Date;
}): StorefrontCandidate[] {
  const nowIso = (input.now ?? new Date()).toISOString();
  return flattenEvidence(input.evidence).map((record) => {
    const evidenceIds = unique([
      ...record.evidenceIds,
      ...(record.stock.evidenceId === undefined ? [] : [record.stock.evidenceId]),
      ...(record.margin === undefined ? [] : [record.margin.evidenceId]),
    ]);
    const candidate: StorefrontCandidate = {
      id: record.id,
      itemRef: record.itemRef,
      title: record.title,
      provenance: {
        source: record.source,
        sourceId: record.sourceId,
        ...(record.accountId === undefined ? {} : { accountId: record.accountId }),
        ...(record.supplierId === undefined ? {} : { supplierId: record.supplierId }),
        snapshotIds: [...(record.snapshotIds ?? [])],
        ...(record.cortexNodeIds === undefined ? {} : { cortexNodeIds: [...record.cortexNodeIds] }),
        evidenceIds,
      },
      evidenceIds,
      evidenceState: { ...record.evidenceState, evidenceIds },
      stock: record.stock,
      ...(record.margin === undefined ? {} : { margin: record.margin }),
      blockedReasons: [],
      redactedReasons: [],
      createdAt: nowIso,
    };
    const guardrails = evaluateOwnedEcommerceGuardrails(record, candidate);
    return {
      ...candidate,
      blockedReasons: unique(guardrails.map((guardrail) => guardrail.code)),
      redactedReasons: unique(guardrails.map((guardrail) => guardrail.redactedMessage)),
    };
  });
}

export function evaluateOwnedEcommerceGuardrails(
  record: OwnedEcommerceSourceRecord,
  candidate?: StorefrontCandidate,
): GuardrailResult[] {
  const evidenceIds = candidate?.evidenceIds ?? [...record.evidenceIds];
  const checks: GuardrailResult[] = [
    ...guardrailsForCandidateEvidence({ ...record.evidenceState, evidenceIds }),
  ];

  if (record.stock.authority === "unknown" || record.stock.status === "unknown") {
    checks.push(block("unknown-stock-evidence", evidenceIds, "Stock authority is unavailable."));
  }
  if (record.stock.status === "out-of-stock") {
    checks.push(
      block("unknown-stock-evidence", evidenceIds, "Stock evidence reports no available stock."),
    );
  }
  if (record.margin === undefined || record.margin.value <= 0) {
    checks.push(block("unknown-margin-evidence", evidenceIds, "Margin evidence is unavailable."));
  }
  if (record.containsSecret === true) {
    checks.push(
      block("secret-detected", evidenceIds, "Sensitive credential-like content was redacted."),
    );
  }
  for (const operation of record.requestedOperations ?? []) {
    checks.push(
      approvalRequired(operationGuardrailCode(operation), evidenceIds, operationMessage(operation)),
    );
  }
  for (const claim of record.riskyClaims ?? []) {
    if ((claim.evidenceIds ?? []).length === 0) {
      checks.push(
        block(
          "unsupported-risky-claim",
          evidenceIds,
          "Unsupported risky storefront claim was removed.",
        ),
      );
    }
  }

  return dedupeGuardrails(checks);
}

export async function runOwnedEcommerceProjectionWorker(
  options: OwnedEcommerceProjectionWorkerOptions,
): Promise<OwnedEcommerceProjectionWorkerResult> {
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const projectionId =
    options.projectionId ?? stableKey("owned-ecommerce", "projection", generatedAt);
  const candidates = collectOwnedEcommerceCandidates({ evidence: options.evidence, now: now() });
  const eligibleCandidates = candidates.filter(
    (candidate) => candidate.blockedReasons.length === 0,
  );
  const model = selectOwnedEcommerceDeepSeekModel({ operation: "storefront-ranking" });
  const deepSeekCandidates = [...eligibleCandidates]
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, OWNED_ECOMMERCE_DEEPSEEK_CANDIDATE_LIMIT);
  const candidateLimitTruncated = eligibleCandidates.length > deepSeekCandidates.length;
  const deepSeekRedaction = buildDeepSeekRedaction(deepSeekCandidates);
  const prompt = buildOwnedEcommerceDeepSeekPromptPlan({
    projectionId,
    candidateIds: deepSeekRedaction.candidates.map((candidate) => candidate.id),
    evidenceIds: unique(
      deepSeekRedaction.candidates.flatMap((candidate) => candidate.evidenceRefs),
    ),
    sourceSummaries: summarizeSourcesForDeepSeek(deepSeekCandidates),
    ...(options.laneId === undefined ? {} : { laneId: options.laneId }),
  });
  let deepSeekFailed = false;
  const deepSeekTimeoutMs =
    options.deepSeekTimeoutMs ?? DEFAULT_OWNED_ECOMMERCE_DEEPSEEK_TIMEOUT_MS;
  const deepSeekResult =
    deepSeekCandidates.length === 0
      ? { recommendations: [], usage: {} }
      : await withTimeout(
          options.deepSeek.recommend({
            model,
            prompt,
            candidates: deepSeekRedaction.candidates,
          }),
          deepSeekTimeoutMs,
        ).catch(() => {
          deepSeekFailed = true;
          return { recommendations: [], usage: {} };
        });
  const usage = deepSeekResult.usage ?? {};
  const recommendations = filterValidatedRecommendations(
    deepSeekResult.recommendations,
    deepSeekCandidates,
    deepSeekRedaction,
  );
  const projection = buildOwnedEcommerceProjection({
    projectionId,
    generatedAt,
    collectionHandle: options.collectionHandle ?? "owned-ecommerce-preview",
    sourceRecords: flattenEvidence(options.evidence),
    candidates: eligibleCandidates,
    allCandidates: candidates,
    recommendations,
    extraReadinessChecks: [
      ...(candidates.length === 0
        ? [
            block(
              "incomplete-evidence",
              [],
              "No storefront candidates were available for deterministic projection.",
            ),
          ]
        : []),
      ...(deepSeekFailed
        ? [
            warning(
              "missing-readiness-check",
              unique(deepSeekCandidates.flatMap((candidate) => candidate.evidenceIds)),
              "DeepSeek was unavailable; deterministic projection fallback was generated.",
            ),
          ]
        : []),
      ...(candidateLimitTruncated
        ? [
            warning(
              "missing-readiness-check",
              unique(deepSeekCandidates.flatMap((candidate) => candidate.evidenceIds)),
              `DeepSeek candidate input was capped at ${OWNED_ECOMMERCE_DEEPSEEK_CANDIDATE_LIMIT} candidates.`,
            ),
          ]
        : []),
    ],
  });
  const ledgerRecord: OwnedEcommerceCostCacheLedgerRecord = {
    id: stableKey("owned-ecommerce", "deepseek-ledger", projectionId),
    provider: OWNED_ECOMMERCE_DEEPSEEK_PROVIDER,
    model,
    laneId: options.laneId ?? "owned-ecommerce",
    credentialRef: redactCredentialRef(
      options.credentialRef ??
        resolveDeepSeekCredentialRef({ laneId: options.laneId ?? "owned-ecommerce" }),
    ),
    projectionId,
    promptCacheHitTokens: sanitizeLedgerNumber(usage.promptCacheHitTokens),
    promptCacheMissTokens: sanitizeLedgerNumber(usage.promptCacheMissTokens),
    outputTokens: sanitizeLedgerNumber(usage.outputTokens),
    estimatedMicros: estimateOwnedEcommerceDeepSeekCostMicros({ model, ...usage }),
    createdAt: generatedAt,
  };

  for (const candidate of candidates) await options.store?.upsertCandidate(candidate);
  await options.store?.upsertProjection(projection);
  for (const [index, check] of projection.readiness.checks.entries()) {
    await options.store?.recordValidation({
      id: validationRecordId(projection.id, check, index),
      projectionId: projection.id,
      result: check,
      evidenceIds: check.evidenceIds,
      redactedMessage: check.redactedMessage,
      createdAt: generatedAt,
    });
  }

  return { candidates, eligibleCandidates, projection, recommendations, ledgerRecord };
}

function buildOwnedEcommerceProjection(input: {
  projectionId: string;
  generatedAt: string;
  collectionHandle: string;
  sourceRecords: readonly OwnedEcommerceSourceRecord[];
  candidates: readonly StorefrontCandidate[];
  allCandidates: readonly StorefrontCandidate[];
  recommendations: readonly OwnedEcommerceDeepSeekRecommendation[];
  extraReadinessChecks?: readonly GuardrailResult[];
}): StorefrontProjection {
  const recommendationByCandidate = new Map(
    input.recommendations.map((recommendation) => [recommendation.candidateId, recommendation]),
  );
  const rankedCandidates = [...input.candidates].sort((left, right) => {
    const leftRank = recommendationByCandidate.get(left.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = recommendationByCandidate.get(right.id)?.rank ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.id.localeCompare(right.id);
  });
  const projectedCandidates = rankedCandidates.slice(0, OWNED_ECOMMERCE_PROJECTION_CATALOG_LIMIT);
  const projectionCatalogTruncated = rankedCandidates.length > projectedCandidates.length;
  const sourceByCandidate = new Map(input.sourceRecords.map((record) => [record.id, record]));
  const claims = projectedCandidates.flatMap((candidate) =>
    validatedClaims(
      candidate,
      recommendationByCandidate.get(candidate.id),
      sourceByCandidate.get(candidate.id),
    ),
  );
  const primaryRecommendation = recommendationByCandidate.get(projectedCandidates[0]?.id ?? "");
  const seoTitle = validateLlmStorefrontCopy({
    copy: primaryRecommendation?.seoTitle,
    fallback: deterministicSeoTitle(projectedCandidates[0]),
    candidate: projectedCandidates[0],
    field: "seoTitle",
  });
  const geoCopy = validateLlmStorefrontCopy({
    copy: primaryRecommendation?.geoCopy,
    fallback: deterministicGeoCopy(projectedCandidates[0]),
    candidate: projectedCandidates[0],
    field: "geoCopy",
  });
  const readinessChecks = [
    ...candidateReadinessChecks({
      allCandidates: input.allCandidates,
      projectedCandidateIds: new Set(projectedCandidates.map((candidate) => candidate.id)),
      hasProjectedCandidates: projectedCandidates.length > 0,
    }),
    ...claims
      .filter((claim) => claim.status === "blocked")
      .map((claim) =>
        block(
          "unsupported-risky-claim",
          claim.evidenceIds,
          claim.redactedReason ?? "Unsupported risky storefront claim was removed.",
        ),
      ),
    ...projectedCandidates.flatMap((candidate) =>
      mediaReadiness(candidate, sourceByCandidate.get(candidate.id)),
    ),
    ...seoTitle.checks,
    ...geoCopy.checks,
    ...(projectionCatalogTruncated
      ? [
          warning(
            "missing-readiness-check",
            unique(projectedCandidates.flatMap((candidate) => candidate.evidenceIds)),
            `Projection catalog was capped at ${OWNED_ECOMMERCE_PROJECTION_CATALOG_LIMIT} products.`,
          ),
        ]
      : []),
    ...(input.extraReadinessChecks ?? []),
  ];

  return {
    id: input.projectionId,
    projectionVersion: `${input.projectionId}:${input.generatedAt}`,
    candidateIds: projectedCandidates.map((candidate) => candidate.id),
    status: "preview",
    catalog: {
      collectionHandle: input.collectionHandle,
      products: projectedCandidates.map((candidate) => ({
        handle: slugify(candidate.itemRef),
        title: candidate.title,
        description:
          validateLlmStorefrontCopy({
            copy: recommendationByCandidate.get(candidate.id)?.geoCopy,
            fallback: `${candidate.title} prepared as an evidence-backed Medusa preview.`,
            candidate,
            field: "geoCopy",
          }).copy ?? `${candidate.title} prepared as an evidence-backed Medusa preview.`,
        ...(sourceByCandidate.get(candidate.id)?.categoryId === undefined
          ? {}
          : { categoryId: sourceByCandidate.get(candidate.id)!.categoryId }),
        variants: [
          {
            sku: candidate.itemRef,
            title: candidate.title,
            price: candidate.margin?.value ?? 0,
            currency: candidate.margin?.currency ?? "CLP",
            ...(candidate.stock.quantity === undefined
              ? {}
              : { inventoryQuantity: candidate.stock.quantity }),
            evidenceIds: candidate.evidenceIds,
          },
        ],
        evidenceIds: candidate.evidenceIds,
      })),
    },
    content: {
      seoTitle: seoTitle.copy,
      geoCopy: geoCopy.copy,
      claims,
      schemaMetadata: {
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: projectedCandidates.map((candidate, index) => ({
          "@type": "Product",
          position: index + 1,
          name: candidate.title,
          sku: candidate.itemRef,
          evidenceIds: candidate.evidenceIds,
        })),
      },
    },
    media: projectedCandidates.flatMap((candidate, index) =>
      optimizedMedia(candidate, sourceByCandidate.get(candidate.id), index === 0),
    ),
    readiness: {
      status: summarizeProjectionReadiness(readinessChecks),
      checks: dedupeGuardrails(readinessChecks),
      generatedAt: input.generatedAt,
    },
    evidenceIds: unique([
      ...projectedCandidates.flatMap((candidate) => candidate.evidenceIds),
      ...claims.flatMap((claim) => claim.evidenceIds),
    ]),
    generatedAt: input.generatedAt,
  };
}

function validatedClaims(
  candidate: StorefrontCandidate,
  recommendation: OwnedEcommerceDeepSeekRecommendation | undefined,
  source: OwnedEcommerceSourceRecord | undefined,
): EvidenceClaim[] {
  const inputClaims = [...(source?.riskyClaims ?? []), ...(recommendation?.claims ?? [])];
  if (inputClaims.length === 0) {
    return [
      {
        id: stableKey(candidate.id, "availability"),
        text: `${candidate.title} availability is backed by current stock evidence.`,
        claimType: "availability",
        evidenceIds: candidate.evidenceIds,
        status: "allowed",
      },
    ];
  }

  return inputClaims.map((claim) => {
    const evidenceIds = unique([...(claim.evidenceIds ?? [])]);
    const hasSupportedEvidence =
      evidenceIds.length > 0 &&
      evidenceIds.every((evidenceId) => candidate.evidenceIds.includes(evidenceId));
    if (!hasSupportedEvidence) {
      return {
        id: claim.id,
        text: "Unsupported claim removed from preview copy.",
        claimType: claim.claimType,
        evidenceIds: candidate.evidenceIds,
        status: "blocked",
        redactedReason: "Unsupported risky storefront claim was removed.",
      } satisfies EvidenceClaim;
    }
    return { ...claim, evidenceIds, status: "allowed" } satisfies EvidenceClaim;
  });
}

function filterValidatedRecommendations(
  recommendations: readonly OwnedEcommerceDeepSeekRecommendation[],
  candidates: readonly StorefrontCandidate[],
  redaction?: DeepSeekRedaction,
): OwnedEcommerceDeepSeekRecommendation[] {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return recommendations.flatMap((recommendation) => {
    const candidateId =
      redaction?.candidateIdByOpaqueId.get(recommendation.candidateId) ??
      recommendation.candidateId;
    const candidate = candidateById.get(recommendation.candidateId);
    const mappedCandidate = candidate ?? candidateById.get(candidateId);
    if (redaction !== undefined && candidate !== undefined) return [];
    if (mappedCandidate === undefined) return [];
    const evidenceIds = recommendation.evidenceIds.map(
      (evidenceId) => redaction?.evidenceIdByOpaqueRef.get(evidenceId) ?? evidenceId,
    );
    if (evidenceIds.length === 0) return [];
    if (!evidenceIds.every((evidenceId) => mappedCandidate.evidenceIds.includes(evidenceId)))
      return [];
    const claims = recommendation.claims?.map((claim) => {
      const claimEvidenceIds = claim.evidenceIds?.map(
        (evidenceId) => redaction?.evidenceIdByOpaqueRef.get(evidenceId) ?? evidenceId,
      );
      return {
        ...claim,
        ...(claimEvidenceIds === undefined ? {} : { evidenceIds: claimEvidenceIds }),
      } satisfies OwnedEcommerceClaimInput;
    });
    return [
      {
        ...recommendation,
        candidateId: mappedCandidate.id,
        evidenceIds,
        ...(claims === undefined ? {} : { claims }),
      },
    ];
  });
}

type DeepSeekRedaction = {
  candidates: OwnedEcommerceDeepSeekCandidateDto[];
  candidateIdByOpaqueId: Map<string, string>;
  evidenceIdByOpaqueRef: Map<string, string>;
};

function buildDeepSeekRedaction(candidates: readonly StorefrontCandidate[]): DeepSeekRedaction {
  const candidateIdByOpaqueId = new Map<string, string>();
  const evidenceIdByOpaqueRef = new Map<string, string>();
  const sanitizedCandidates = candidates.map((candidate, candidateIndex) => {
    const opaqueCandidateId = `candidate-${String(candidateIndex + 1).padStart(3, "0")}`;
    candidateIdByOpaqueId.set(opaqueCandidateId, candidate.id);
    const evidenceRefs = candidate.evidenceIds.map((evidenceId, evidenceIndex) => {
      const opaqueEvidenceRef = `${opaqueCandidateId}-evidence-${String(evidenceIndex + 1).padStart(3, "0")}`;
      evidenceIdByOpaqueRef.set(opaqueEvidenceRef, evidenceId);
      return opaqueEvidenceRef;
    });
    return {
      id: opaqueCandidateId,
      stock: {
        status: candidate.stock.status,
        authority: candidate.stock.authority,
        ...(candidate.stock.quantity === undefined ? {} : { quantity: candidate.stock.quantity }),
      },
      ...(candidate.margin === undefined
        ? {}
        : {
            margin: {
              value: candidate.margin.value,
              currency: candidate.margin.currency,
              evidenceId: "redacted",
            },
          }),
      evidenceRefs,
      mediaCount: candidate.evidenceIds.length,
    } satisfies OwnedEcommerceDeepSeekCandidateDto;
  });
  return { candidates: sanitizedCandidates, candidateIdByOpaqueId, evidenceIdByOpaqueRef };
}

function summarizeSourcesForDeepSeek(candidates: readonly StorefrontCandidate[]): string[] {
  const counts = new Map<CandidateSourceKind, number>();
  for (const candidate of candidates) {
    counts.set(candidate.provenance.source, (counts.get(candidate.provenance.source) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, count], index) => `source-${String(index + 1).padStart(3, "0")}:${count}`);
}

function optimizedMedia(
  candidate: StorefrontCandidate,
  source: OwnedEcommerceSourceRecord | undefined,
  priority: boolean,
): OptimizedMedia[] {
  return (source?.media ?? []).map((media) => ({
    src: isSafeStaticPreviewMediaSrc(media.src) ? media.src : STATIC_PREVIEW_MEDIA_PLACEHOLDER_SRC,
    alt: media.alt?.trim() || candidate.title,
    width: media.width ?? DEFAULT_MEDIA_WIDTH,
    height: media.height ?? DEFAULT_MEDIA_HEIGHT,
    sizes: DEFAULT_MEDIA_SIZES,
    hash: stableKey("media", media.src),
    priority,
    evidenceIds: unique([...media.evidenceIds, ...candidate.evidenceIds]),
  }));
}

function mediaReadiness(
  candidate: StorefrontCandidate,
  source: OwnedEcommerceSourceRecord | undefined,
): GuardrailResult[] {
  const media = source?.media ?? [];
  if (media.length === 0) {
    return [
      warning("missing-readiness-check", candidate.evidenceIds, "Media evidence is missing."),
    ];
  }
  return media.flatMap((item) => {
    const checks: GuardrailResult[] = [];
    if ((item.alt ?? "").trim().length === 0) {
      checks.push(
        warning("missing-readiness-check", item.evidenceIds, "Media alt text was generated."),
      );
    }
    if ((item.width ?? 0) <= 0 || (item.height ?? 0) <= 0) {
      checks.push(
        warning("missing-readiness-check", item.evidenceIds, "Media dimensions were defaulted."),
      );
    }
    if (!isSafeStaticPreviewMediaSrc(item.src)) {
      checks.push(
        warning(
          "missing-readiness-check",
          item.evidenceIds,
          "External media URL was replaced for static preview rendering.",
        ),
      );
    }
    return checks;
  });
}

function candidateReadinessChecks(input: {
  allCandidates: readonly StorefrontCandidate[];
  projectedCandidateIds: ReadonlySet<string>;
  hasProjectedCandidates: boolean;
}): GuardrailResult[] {
  return input.allCandidates.flatMap((candidate) =>
    candidate.blockedReasons.map((code) => {
      const message = candidate.redactedReasons[0] ?? "Candidate was blocked.";
      if (!input.hasProjectedCandidates || input.projectedCandidateIds.has(candidate.id)) {
        return block(code, candidate.evidenceIds, message);
      }
      return warning(code, candidate.evidenceIds, `Excluded candidate warning: ${message}`);
    }),
  );
}

function isSafeStaticPreviewMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("data:image/")) return true;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  if (trimmed.startsWith("./") || trimmed.startsWith("../")) return true;
  return false;
}

function validateLlmStorefrontCopy(input: {
  copy: string | undefined;
  fallback: string;
  candidate: StorefrontCandidate | undefined;
  field: "seoTitle" | "geoCopy";
}): { copy: string; checks: GuardrailResult[] } {
  if (input.copy === undefined || input.candidate === undefined)
    return { copy: input.fallback, checks: [] };
  const normalized = input.copy.trim();
  if (normalized.length === 0) return { copy: input.fallback, checks: [] };
  if (
    !containsUnsupportedStorefrontClaim(normalized, input.candidate) &&
    isStorefrontCopyTraceableToCandidate(normalized, input.candidate)
  ) {
    return { copy: normalized, checks: [] };
  }
  return {
    copy: input.fallback,
    checks: [
      block(
        "unsupported-risky-claim",
        input.candidate.evidenceIds,
        `Unsupported risky claim in LLM ${input.field} was replaced with deterministic copy.`,
      ),
    ],
  };
}

function containsUnsupportedStorefrontClaim(copy: string, candidate: StorefrontCandidate): boolean {
  if (/\b(delivery|deliver(?:ed|s|y)?|shipping|ship(?:ped|s)?|same[-\s]?day|fast)\b/i.test(copy)) {
    return true;
  }
  if (/\b(available|availability|in\s+stock|stocked)\b/i.test(copy)) {
    return !hasDeterministicAvailabilityEvidence(candidate);
  }
  return /\b(best|guaranteed|guarantee|cure|cures|miracle|certified|official|exclusive|number\s*1|#\s*1|price|priced|cheap|cheapest|discount|sale|free|origin|made\s+in|manufactured\s+in|imported\s+from)\b/i.test(
    copy,
  );
}

function hasDeterministicAvailabilityEvidence(candidate: StorefrontCandidate): boolean {
  return (
    (candidate.stock.status === "in-stock" || candidate.stock.status === "low-stock") &&
    candidate.stock.authority !== "unknown" &&
    candidate.stock.evidenceId !== undefined &&
    candidate.evidenceIds.includes(candidate.stock.evidenceId)
  );
}

function isStorefrontCopyTraceableToCandidate(
  copy: string,
  candidate: StorefrontCandidate,
): boolean {
  const allowedTokens = new Set([
    ...copyTokens(candidate.title),
    ...copyTokens(candidate.itemRef),
    ...copyTokens(deterministicSeoTitle(candidate)),
    ...copyTokens(deterministicGeoCopy(candidate)),
    "evidence",
    "backed",
    "medusa",
    "preview",
    "prepared",
    "owned",
    "ecommerce",
    "product",
    "products",
  ]);
  const assertedTokens = copyTokens(copy).filter((token) => token.length > 2);
  return assertedTokens.length > 0 && assertedTokens.every((token) => allowedTokens.has(token));
}

function copyTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function deterministicSeoTitle(candidate: StorefrontCandidate | undefined): string {
  return candidate === undefined ? "Owned ecommerce preview" : `${candidate.title} preview`;
}

function deterministicGeoCopy(candidate: StorefrontCandidate | undefined): string {
  return candidate === undefined
    ? "Evidence-backed Medusa preview generated without request-time reasoning."
    : `${candidate.title} prepared as an evidence-backed Medusa preview.`;
}

function validationRecordId(projectionId: string, check: GuardrailResult, index: number): string {
  return stableKey(
    "owned-ecommerce",
    "validation",
    projectionId,
    check.code,
    String(index + 1),
    fingerprint([check.severity, ...check.evidenceIds, check.redactedMessage].join("|")),
  );
}

function redactCredentialRef(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "redacted:empty";
  const prefix = trimmed.includes(":") ? (trimmed.split(":", 1)[0] ?? "credential") : "credential";
  return `redacted:${slugify(prefix).slice(0, 24) || "credential"}:${fingerprint(trimmed)}`;
}

function sanitizeLedgerNumber(value: number | undefined, max = MAX_LEDGER_TOKEN_COUNT): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value ?? 0), 0), max);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const boundedTimeoutMs = Math.max(0, Math.floor(timeoutMs));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`DeepSeek recommendation timed out after ${boundedTimeoutMs}ms`)),
          boundedTimeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const OPERATION_GUARDRAILS: Readonly<
  Record<OwnedEcommerceRequestedOperation, { code: GuardrailCode; message: string }>
> = Object.freeze({
  checkout: Object.freeze({
    code: "checkout-approval-required",
    message: "Checkout or payment activation requires exact CEO approval.",
  }),
  payment: Object.freeze({
    code: "checkout-approval-required",
    message: "Checkout or payment activation requires exact CEO approval.",
  }),
  publish: Object.freeze({
    code: "publish-approval-required",
    message: "Public publishing requires exact CEO approval.",
  }),
  price: Object.freeze({
    code: "price-approval-required",
    message: "Price mutation requires exact CEO approval.",
  }),
  stock: Object.freeze({
    code: "stock-approval-required",
    message: "Stock mutation requires exact CEO approval.",
  }),
});

function operationGuardrailCode(operation: OwnedEcommerceRequestedOperation): GuardrailCode {
  return OPERATION_GUARDRAILS[operation].code;
}

function operationMessage(operation: OwnedEcommerceRequestedOperation): string {
  return OPERATION_GUARDRAILS[operation].message;
}

function flattenEvidence(input: OwnedEcommerceEvidenceInput): OwnedEcommerceSourceRecord[] {
  return [
    ...(input.mlAccounts ?? []),
    ...(input.supplierMirror ?? []),
    ...(input.futureSuppliers ?? []),
    ...(input.readModel ?? []),
    ...(input.cortex ?? []),
  ];
}

function block(
  code: GuardrailCode,
  evidenceIds: readonly string[],
  message: string,
): GuardrailResult {
  return {
    passed: false,
    severity: "block",
    code,
    evidenceIds: [...evidenceIds],
    redactedMessage: message,
  };
}

function approvalRequired(
  code: GuardrailCode,
  evidenceIds: readonly string[],
  message: string,
): GuardrailResult {
  return {
    passed: false,
    severity: "approval-required",
    code,
    evidenceIds: [...evidenceIds],
    redactedMessage: message,
  };
}

function warning(
  code: GuardrailCode,
  evidenceIds: readonly string[],
  message: string,
): GuardrailResult {
  return {
    passed: false,
    severity: "warning",
    code,
    evidenceIds: [...evidenceIds],
    redactedMessage: message,
  };
}

function dedupeGuardrails(checks: readonly GuardrailResult[]): GuardrailResult[] {
  const byKey = new Map<string, GuardrailResult>();
  for (const check of checks) {
    byKey.set(
      `${check.code}:${check.severity}:${check.evidenceIds.join(",")}:${check.redactedMessage}`,
      check,
    );
  }
  return [...byKey.values()];
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "item"
  );
}

function stableKey(...parts: readonly string[]): string {
  return parts.map((part) => part.replace(/[^a-zA-Z0-9-]/g, "-")).join(":");
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
