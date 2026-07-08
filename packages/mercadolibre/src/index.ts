import {
  evaluateFreshness,
  isMlcCategoryId,
  isMlcDomainId,
  type CacheFreshness,
  type ReadSnapshot,
} from "@msl/domain";
import type { OAuthManager } from "./oauth/oauthManager.js";
import type {
  MlCategory,
  MlCategoriesSnapshot,
  MlItem,
  MlUserInfo,
  MlUserSnapshot,
  MlWriteSnapshot,
  NewItem,
} from "./types.js";

import { mockResponse } from "./mockData.js";

import {
  // Helper utilities
  asRecord,
  asArray,
  stringValue,
  numberValue,
  booleanValue,
  pushOptional,
  createFreshness,

  // Assertion functions
  assertMlcItemId,
  assertMlcCategoryId,
  assertMlcCatalogProductId,
  assertMlcDomainId,
  assertPromotionId,
  assertPromotionType,
  assertCompleteMlcItem,

  // Normalize functions used by createMlcReadMethods / createMlClient
  normalizeListings,
  normalizeOrders,
  normalizeMessages,
  normalizeReputation,
  normalizeItemVisits,
  normalizeItemVisitsTimeWindow,
  normalizeListingPerformance,
  normalizeRelist,
  normalizeImageDiagnostic,
  normalizeImageUpload,
  normalizeModerationStatus,
  normalizeNotices,
  normalizeAnswer,
  normalizeClaimsSearch,
  normalizeClaimDetail,
  normalizeClaimMessages,
  normalizeClaimExpectedResolutions,
  normalizeClaimAffectsReputation,
  normalizeClaimStatusHistory,
  normalizeShipmentStatus,
  normalizeRateLimitedShipmentStatus,
  normalizeClaimReturn,
  normalizeReturnReviews,
  normalizeClaimReturnCost,
  normalizeQuestions,
  normalizeCategoryAttributes,
  normalizeCategoryTechnicalSpecs,
  normalizeProductAdsInsights,
  normalizeListingPrices,
  normalizeItemSalePrice,
  normalizeItemPrices,
  normalizePriceToWin,
  normalizePricingAutomation,
  normalizePricingAutomationRules,
  normalizePricingAutomationPriceHistory,
  normalizeAutomatedPriceItems,
  normalizeSellerPromotions,
  normalizePromotionDetail,
  normalizePromotionItems,
  normalizeItemPromotions,
  normalizeItems,
  normalizeWriteResponse,
  normalizeCategories,
  normalizeUser,
  isRateLimitError,
  rateLimitBlockedMetadata,
  normalizeRateLimitedClaimsSearch,
  degradedReturnSnapshot,
  findProductAdsAdvertiser,
  productAdsQuery,
  listingPricesQuery,
} from "./normalization.js";

export type OAuthAccessStatus = "connected" | "revoked" | "expired";

export type MlcReadSnapshotKind = ReadSnapshot<unknown>["kind"];

export type MlcReadSnapshotCompleteness = ReadSnapshot<unknown>["completeness"];

export type MlcReadSnapshotConfidence = ReadSnapshot<unknown>["confidence"];

export type MlcReadSnapshotFreshness = CacheFreshness & {
  source: "mercadolibre-api";
  signalKind: MlcReadSnapshotKind;
  risk: "medium" | "critical";
};

export type MlcReadSnapshot<TData> = ReadSnapshot<TData> & {
  kind: MlcReadSnapshotKind;
  source: "mercadolibre-api";
  freshness: MlcReadSnapshotFreshness;
};

export type MlcListingSummary = {
  id: string;
  title?: string;
  status?: string;
  availableQuantity?: number;
  price?: number;
  currencyId?: string;
  permalink?: string;
  categoryId?: string;
  listingTypeId?: string;
};

export type MlcOrderSummary = {
  id: string;
  status?: string;
  totalAmount?: number;
  currencyId?: string;
  createdAt?: string;
  buyerId?: string;
};

export type MlcMessageSummary = {
  id: string;
  subject?: string;
  status?: string;
  createdAt?: string;
  fromUserId?: string;
};

export type MlcQuestionSummary = {
  id: string;
  text?: string;
  answerText?: string;
  status?: string;
  dateCreated?: string;
  itemId?: string;
};

export type MlcReputationSummary = {
  level?: string;
  powerSellerStatus?: string;
  completedTransactions?: number;
  canceledTransactions?: number;
  totalTransactions?: number;
  positiveRating?: number;
  neutralRating?: number;
  negativeRating?: number;
  claimsRate?: number;
  cancellationsRate?: number;
  delayedHandlingTimeRate?: number;
  metricPeriodDays?: 60 | 365;
};

export type MlcVisitsDetail = {
  company: string;
  quantity: number;
};

export type MlcVisitsSummary = {
  itemId: string;
  totalVisits: number;
  visitsDetail?: MlcVisitsDetail[];
};

export type MlcVisitsTimeWindowSummary = {
  itemId: string;
  dateFrom: string;
  dateTo: string;
  totalVisits: number;
  last: number;
  unit: string;
  results: Array<{
    date: string;
    total: number;
    visitsDetail: MlcVisitsDetail[];
  }>;
};

export type MlcPerformanceRule = {
  key: string;
  status: "COMPLETED" | "PENDING";
  progress: number;
  mode: "OPPORTUNITY" | "WARNING";
  wordings: { title: string; label: string; link: string };
};

export type MlcPerformanceVariable = {
  key: string;
  status: "COMPLETED" | "PENDING";
  score: number;
  title: string;
  rules: MlcPerformanceRule[];
};

export type MlcPerformanceBucket = {
  key: string;
  status: "COMPLETED" | "PENDING";
  score: number;
  title: string;
  variables: MlcPerformanceVariable[];
};

export type MlcPerformanceSummary = {
  entityId: string;
  entityType: string;
  score: number;
  level: string;
  levelWording: string;
  calculatedAt: string;
  buckets: MlcPerformanceBucket[];
};

export type MlcPerformanceSnapshot = MlcReadSnapshot<MlcPerformanceSummary>;

export type MlcRelistInput = {
  price?: number;
  quantity?: number;
  listingTypeId?: string;
};

export type MlcRelistResult = {
  newItemId: string;
  parentItemId: string;
  title: string;
  price: number;
  listingTypeId: string;
  status: string;
};

export type MlcRelistSnapshot = MlcReadSnapshot<MlcRelistResult>;

export type MlcImageDiagnosticInput = {
  pictureUrl: string;
  categoryId: string;
  title?: string;
  pictureType?: "thumbnail" | "variation_thumbnail" | "other";
};

export type MlcImageDetection = {
  name: string;
  wordings: Array<{ kind: string; value: string }>;
};

export type MlcImageDiagnosticResult = {
  pictureType: string;
  action: "diagnostic" | "empty";
  detections: MlcImageDetection[];
};

export type MlcImageDiagnosticSummary = {
  diagnosticId: string;
  diagnostics: MlcImageDiagnosticResult[];
  hasIssues: boolean;
};

export type MlcImageDiagnosticSnapshot = MlcReadSnapshot<MlcImageDiagnosticSummary>;

export type MlcImageUploadResult = {
  pictureId: string;
  variations: Array<{ size: string; url: string; secureUrl: string }>;
};

export type MlcImageUploadSnapshot = MlcReadSnapshot<MlcImageUploadResult>;

export type MlcImageAssociateInput = { itemId: string; pictureId: string };

export type MlcImageAssociateSummary = { itemId: string; pictureId: string; status: "associated" };

export type MlcImageAssociateSnapshot = MlcReadSnapshot<MlcImageAssociateSummary>;

export type MlcImageOrchestrationInput = {
  itemId: string;
  pictureUrl: string;
  categoryId: string;
  title?: string;
  diagnostic?: { hasIssues: boolean; details?: unknown };
};

export type MlcImageOrchestrationStep = {
  step: "diagnose" | "upload" | "associate" | "check";
  status: "pending" | "completed" | "failed";
  result?: unknown;
};

export type MlcImageOrchestrationSummary = {
  itemId: string;
  steps: ReadonlyArray<MlcImageOrchestrationStep>;
  requiresApproval: true;
  noMutationExecuted: true;
};

export type MlcModerationStatusSummary = {
  itemId: string;
  blocked: boolean;
  date?: string;
  wordings: ReadonlyArray<{ kind: string; value: string }>;
  evidence: ReadonlyArray<{ textMatched?: string; sectionName?: string }>;
};

export type MlcNoticesSummary = {
  notices: ReadonlyArray<{
    id: string;
    fromDate?: string;
    tags?: ReadonlyArray<string>;
    highlighted?: boolean;
    dismissKey?: string;
    title?: string;
    actions: ReadonlyArray<{ label?: string; url?: string }>;
  }>;
  pagination: { total?: number; limit: number; offset: number };
  category?: string;
};

export type MlcClaimPlayer = {
  id?: string;
  role?: string;
  nickname?: string;
};

export type MlcClaimPlayerAction = {
  id?: string;
  status?: string;
  type?: string;
  created?: string;
  reason?: string;
  description?: string;
};

export type MlcClaimResolution = {
  id?: string;
  status?: string;
  reason?: string;
  description?: string;
};

export type MlcClaimMessage = {
  id?: string;
  from?: string;
  to?: string;
  message?: string;
  date_created?: string;
  attachments?: ReadonlyArray<string>;
};

export type MlcClaimSummary = {
  id: string;
  status?: string;
  type?: string;
  reasonId?: string;
  stage?: string;
  dateCreated?: string;
  lastUpdated?: string;
  resource?: string;
  resourceId?: string;
  siteId?: string;
  players?: ReadonlyArray<MlcClaimPlayer>;
  resolution?: MlcClaimResolution;
};

export type MlcClaimsSearchResult = {
  paging: { total: number; offset: number; limit: number };
  results: ReadonlyArray<MlcClaimSummary>;
};

export type MlcRateLimitBlockedMetadata = {
  reason: "rate-limited";
  httpStatus: 429;
  retryAttempted: false;
};

export type MlcQuestionsSearchResult = {
  paging: { total: number; offset: number; limit: number };
  results: ReadonlyArray<MlcQuestionSummary>;
};

export type MlcClaimDetailSummary = {
  claim: MlcClaimSummary;
  messages?: ReadonlyArray<MlcClaimMessage>;
  players?: ReadonlyArray<MlcClaimPlayer>;
  availableActions?: ReadonlyArray<MlcClaimPlayerAction>;
};

export type MlcClaimMessagesSummary = { messages: ReadonlyArray<MlcClaimMessage> };

export type MlcClaimResolutionsSummary = {
  expected_resolutions: ReadonlyArray<{
    id?: string;
    status?: string;
    reason?: string;
    description?: string;
  }>;
};

export type MlcClaimReputationSummary = {
  affects_reputation: boolean;
  reason?: string;
};

export type MlcClaimStatusHistorySummary = {
  history: ReadonlyArray<{ status?: string; date?: string }>;
};

export type MlcShipmentStatusSummary = {
  id: string;
  status?: string;
  substatus?: string;
  dateCreated?: string;
  lastUpdated?: string;
  trackingNumber?: string;
  trackingMethod?: string;
  logisticType?: string;
  senderId?: string;
  receiverId?: string;
  siteId?: string;
};

export type MlcAnswerInput = { questionId: string; text: string };

export type MlcAnswerSummary = {
  questionId: string;
  status: "pending";
  requiresApproval: true;
  noMutationExecuted: true;
  textLength: number;
};

const MLC_REPUTATION_RULES = {
  establishedSellerCompletedTransactions: 40,
  establishedSellerMetricPeriodDays: 60,
  newSellerMetricPeriodDays: 365,
} as const;

const MLC_CONFIRMED_SITE_SUPPORT = "MLC-confirmed" as const;

export type MlcCategoryAttributeSummary = {
  id: string;
  name?: string;
  valueType?: string;
  required: boolean;
  catalogRequired: boolean;
  variationAttribute: boolean;
  readOnly: boolean;
  values: ReadonlyArray<{ id?: string; name?: string }>;
  units: ReadonlyArray<string>;
};

export type MlcCategoryTechnicalSpecSummary = {
  id: string;
  name?: string;
  valueType?: string;
  required: boolean;
  catalogRequired: boolean;
  group?: string;
};

export type MlcProductAdsMetricSummary = Readonly<Record<string, number>>;

export const MLC_PRODUCT_ADS_DEFAULT_LIMIT = 50;
export const MLC_PRODUCT_ADS_DEFAULT_OFFSET = 0;
export const MLC_PRODUCT_ADS_MAX_LIMIT = 100;
export const MLC_PRODUCT_ADS_DEFAULT_METRICS =
  "clicks,prints,ctr,cost,cpc,acos,cvr,roas,sov,direct_amount,indirect_amount,total_amount,direct_units,indirect_units,total_units";

export type MlcProductAdsEntitySummary = {
  id: string;
  name?: string;
  itemId?: string;
  campaignId?: string;
  status?: string;
  metrics?: MlcProductAdsMetricSummary;
};

export type MlcProductAdsInsights = {
  advertiser: { id: string; siteId: string; productId: "PADS" };
  dateFrom?: string;
  dateTo?: string;
  campaigns: ReadonlyArray<MlcProductAdsEntitySummary>;
  ads: ReadonlyArray<MlcProductAdsEntitySummary>;
  noMutationExecuted: true;
  performanceMetric: "roas";
  transitionalMetrics: { acosTargetDeprecatedAfter: "2026-03-30" };
};

export type MlcListingPriceListingTypeId = string;

export type MlcListingPricesInput = {
  siteId: string;
  price: number;
  categoryId: string;
  currencyId?: string;
  listingTypeId?: MlcListingPriceListingTypeId;
  logisticType?: string;
  shippingMode?: string;
  billableWeight?: number;
  quantity?: number;
  tags?: string | ReadonlyArray<string>;
  logisticsAware?: boolean;
};

export type MlcSaleFeeDetails = {
  financingAddOnFee?: number;
  fixedFee?: number;
  grossAmount?: number;
  meliPercentageFee?: number;
  percentageFee?: number;
};

export type MlcListingPriceSummary = {
  currencyId?: string;
  listingTypeId?: string;
  listingTypeName?: string;
  saleFeeAmount?: number;
  saleFeeDetails: MlcSaleFeeDetails;
};

export type MlcItemSalePriceSummary = {
  itemId: string;
  amount?: number;
  currencyId?: string;
  regularAmount?: number;
  type?: string;
  metadata?: {
    campaignId?: string;
    promotionId?: string;
    promotionType?: string;
  };
};

export type MlcItemPriceConditionsSummary = {
  contextRestrictions?: ReadonlyArray<string>;
  startTime?: string;
  endTime?: string;
  eligible?: boolean;
};

export type MlcItemPricesSummary = {
  itemId: string;
  prices: ReadonlyArray<{
    id?: string;
    type?: string;
    amount?: number;
    regularAmount?: number;
    currencyId?: string;
    conditions?: MlcItemPriceConditionsSummary;
  }>;
};

export type MlcPriceToWinWinnerSummary = {
  itemId?: string;
  price?: number;
  currencyId?: string;
};

export type MlcPriceToWinBoostSummary = {
  id?: string;
  type?: string;
  status?: string;
  value?: number;
};

export type MlcPriceToWinSummary = {
  itemId: string;
  currentPrice?: number;
  priceToWin?: number;
  status?: string;
  reason?: string;
  visitShare?: string;
  catalogProductId?: string;
  winner?: MlcPriceToWinWinnerSummary;
  boosts: ReadonlyArray<MlcPriceToWinBoostSummary>;
};

export type MlcPricingAutomationSummary = {
  itemId: string;
  active: boolean;
  status?: string;
  ruleId?: string;
  minPrice?: number;
  maxPrice?: number;
};

export const MLC_PRICING_AUTOMATION_KNOWN_RULE_IDS = {
  competitive: "INT_EXT",
  internal: "INT",
} as const;

export type MlcPricingAutomationKnownRuleId =
  (typeof MLC_PRICING_AUTOMATION_KNOWN_RULE_IDS)[keyof typeof MLC_PRICING_AUTOMATION_KNOWN_RULE_IDS];

export type MlcPricingAutomationRuleId = string;

export type MlcPricingAutomationRulesSummary = {
  targetType: "item" | "product";
  targetId: string;
  rules: ReadonlyArray<{ ruleId: MlcPricingAutomationRuleId }>;
};

export type MlcPricingAutomationHistorySummary = {
  itemId: string;
  resultCode?: number;
  resultMessage?: string;
  content: ReadonlyArray<{
    dateTime?: string;
    percentChange?: number;
    usdPrice?: number;
    price?: number;
    event?: string;
    strategyType?: string;
  }>;
  pageable: { offset?: number; pageNumber: number; pageSize: number };
  totalElements?: number;
  totalPages?: number;
  size?: number;
  numberOfElements?: number;
  empty?: boolean;
};

export type MlcAutomatedPriceItemsSummary = {
  paging: { total?: number; offset: number; limit: number };
  items: ReadonlyArray<{
    itemId: string;
    status?: string;
    ruleId?: string;
    minPrice?: number;
    maxPrice?: number;
  }>;
};

export const MLC_PROMOTIONS_ITEMS_DEFAULT_LIMIT = 50;
export const MLC_PROMOTIONS_ITEMS_MAX_LIMIT = 50;

export type MlcPromotionType =
  | "DEAL"
  | "MARKETPLACE_CAMPAIGN"
  | "DOD"
  | "LIGHTNING"
  | "VOLUME"
  | "PRICE_DISCOUNT"
  | "PRE_NEGOTIATED"
  | "SELLER_CAMPAIGN"
  | "SMART"
  | "PRICE_MATCHING"
  | "PRICE_MATCHING_MELI_ALL"
  | "UNHEALTHY_STOCK"
  | "SELLER_COUPON_CAMPAIGN"
  | "BANK";

export type MlcPromotionBenefitsSummary = {
  type?: string;
  meliPercent?: number;
  sellerPercent?: number;
};

export type MlcPromotionSummary = {
  id: string;
  type: string;
  status?: string;
  startDate?: string;
  finishDate?: string;
  deadlineDate?: string;
  name?: string;
  benefits?: MlcPromotionBenefitsSummary;
  subType?: string;
  /** UNHEALTHY_STOCK pre-negotiated offers */
  offers?: ReadonlyArray<{
    id?: string;
    originalPrice?: number;
    newPrice?: number;
    status?: string;
    startDate?: string;
    endDate?: string;
    benefits?: MlcPromotionBenefitsSummary;
  }>;
  /** SELLER_CAMPAIGN */
  allowCombination?: boolean;
  /** SELLER_COUPON_CAMPAIGN */
  fixedAmount?: number;
  fixedPercentage?: number;
  minPurchaseAmount?: number;
  maxPurchaseAmount?: number;
  couponCode?: string;
  redeemsPerUser?: number;
  budget?: number;
  remainingBudget?: number;
  usedCoupons?: number;
};

export type MlcPromotionParticipantSummary = {
  id: string;
  status?: string;
  statusItem?: string;
  price?: number;
  originalPrice?: number;
  startDate?: string;
  endDate?: string;
  subType?: string;
  offerId?: string;
  meliPercentage?: number;
  sellerPercentage?: number;
  currencyId?: string;
  maxDiscountedPrice?: number;
  minDiscountedPrice?: number;
  suggestedDiscountedPrice?: number;
  netProceeds?:
    | { amount?: number; currency?: string }
    | {
        suggestedDiscountedPrice?: { amount?: number; currency?: string };
        maxDiscountedPrice?: { amount?: number; currency?: string };
        minDiscountedPrice?: { amount?: number; currency?: string };
      };
  fixedAmount?: number;
  fixedPercentage?: number;
};

export type MlcItemPromotionStockSummary = { remainingStock?: number };

export type MlcItemPromotionSummary = {
  id: string;
  type?: string;
  refId?: string;
  status?: string;
  price?: number;
  originalPrice?: number;
  name?: string;
  minDiscountedPrice?: number;
  maxDiscountedPrice?: number;
  suggestedDiscountedPrice?: number;
  meliPercentage?: number;
  sellerPercentage?: number;
  startDate?: string;
  finishDate?: string;
  topPrice?: number;
  topDealPrice?: number;
  stock?: MlcItemPromotionStockSummary;
  boostedOffer?: boolean;
  discountMeliBoostedPercentage?: number;
  discountMeliBoostAmount?: number;
  totalPriceForBoostedOffer?: number;
};

export type MlcSellerPromotionsSummary = {
  paging: { offset: number; limit: number; total?: number };
  promotions: ReadonlyArray<MlcPromotionSummary>;
};

export type MlcPromotionItemsSummary = {
  promotionId: string;
  promotionType: string;
  paging: { searchAfter?: string; limit: number; total?: number };
  items: ReadonlyArray<MlcPromotionParticipantSummary>;
};

export type MlcItemPromotionsSummary = {
  itemId: string;
  promotions: ReadonlyArray<MlcItemPromotionSummary>;
};

export type MlcListingsSnapshot = MlcReadSnapshot<MlcListingSummary>;
export type MlcOrdersSnapshot = MlcReadSnapshot<MlcOrderSummary> & {
  paging?: { total: number; offset: number; limit: number };
};
export type MlcMessagesSnapshot = MlcReadSnapshot<MlcMessageSummary> & {
  paging?: { total: number; offset: number; limit: number };
};
export type MlcReputationSnapshot = MlcReadSnapshot<MlcReputationSummary>;
export type MlcCategoryAttributesSnapshot = MlcReadSnapshot<MlcCategoryAttributeSummary>;
export type MlcCategoryTechnicalSpecsSnapshot = MlcReadSnapshot<MlcCategoryTechnicalSpecSummary>;
export type MlcProductAdsInsightsSnapshot = MlcReadSnapshot<MlcProductAdsInsights>;
export type MlcListingPricesSnapshot = MlcReadSnapshot<MlcListingPriceSummary>;
export type MlcVisitsSnapshot = MlcReadSnapshot<MlcVisitsSummary>;
export type MlcVisitsTimeWindowSnapshot = MlcReadSnapshot<MlcVisitsTimeWindowSummary>;
export type MlcItemSalePriceSnapshot = MlcReadSnapshot<MlcItemSalePriceSummary>;
export type MlcItemPricesSnapshot = MlcReadSnapshot<MlcItemPricesSummary>;
export type MlcPriceToWinSnapshot = MlcReadSnapshot<MlcPriceToWinSummary>;
export type MlcPricingAutomationSnapshot = MlcReadSnapshot<MlcPricingAutomationSummary>;
export type MlcPricingAutomationRulesSnapshot = MlcReadSnapshot<MlcPricingAutomationRulesSummary>;
export type MlcPricingAutomationHistorySnapshot =
  MlcReadSnapshot<MlcPricingAutomationHistorySummary>;
export type MlcAutomatedPriceItemsSnapshot = Omit<
  MlcReadSnapshot<MlcAutomatedPriceItemsSummary>,
  "data"
> & { data: MlcAutomatedPriceItemsSummary };
export type MlcSellerPromotionsSnapshot = MlcReadSnapshot<MlcSellerPromotionsSummary>;
export type MlcPromotionDetailSnapshot = MlcReadSnapshot<MlcPromotionSummary>;
export type MlcPromotionItemsSnapshot = MlcReadSnapshot<MlcPromotionItemsSummary>;
export type MlcItemPromotionsSnapshot = MlcReadSnapshot<MlcItemPromotionsSummary>;
export type MlcSingleReadSnapshot<TData> = Omit<MlcReadSnapshot<TData>, "data"> & {
  data: TData;
};

export type MlcModerationStatusSnapshot = MlcSingleReadSnapshot<MlcModerationStatusSummary>;
export type MlcNoticesSnapshot = MlcSingleReadSnapshot<MlcNoticesSummary>;
export type MlcAnswerSnapshot = MlcSingleReadSnapshot<MlcAnswerSummary>;

export type MlcClaimsSearchSnapshot = MlcSingleReadSnapshot<MlcClaimsSearchResult> & {
  blockedMetadata?: MlcRateLimitBlockedMetadata;
  noMutationExecuted?: true;
};
export type MlcQuestionsSnapshot = MlcSingleReadSnapshot<MlcQuestionsSearchResult>;
export type MlcClaimDetailSnapshot = MlcSingleReadSnapshot<MlcClaimDetailSummary>;
export type MlcClaimMessagesSnapshot = MlcSingleReadSnapshot<MlcClaimMessagesSummary> & {
  noMutationExecuted: true;
};
export type MlcClaimResolutionsSnapshot = MlcSingleReadSnapshot<MlcClaimResolutionsSummary> & {
  noMutationExecuted: true;
};
export type MlcClaimReputationSnapshot = MlcSingleReadSnapshot<MlcClaimReputationSummary> & {
  noMutationExecuted: true;
};
export type MlcClaimStatusHistorySnapshot = MlcSingleReadSnapshot<MlcClaimStatusHistorySummary> & {
  noMutationExecuted: true;
};
export type MlcShipmentStatusSnapshot = MlcSingleReadSnapshot<MlcShipmentStatusSummary> & {
  blockedMetadata?: MlcRateLimitBlockedMetadata;
  noMutationExecuted?: true;
};

// ── Return safe-read types ──────────────────────────────────────────

export type MlcReturnSnapshotBase<TData> = Omit<
  MlcSingleReadSnapshot<TData>,
  "siteSupport" | "sellerScope"
> & {
  siteSupport: "MLC-to-confirm";
  sellerScope: { sellerId: string; site: "MLC" };
  noMutationExecuted: true;
};

export type MlcReturnSummary = {
  id: string;
  status?: string;
  reason?: string;
  dateCreated?: string;
  lastUpdated?: string;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
  resource?: string;
  resourceId?: string;
  siteId?: string;
};

export type MlcClaimReturnSummary = {
  claimId: string;
  returns: ReadonlyArray<MlcReturnSummary>;
};

export type MlcClaimReturnSnapshot = MlcReturnSnapshotBase<MlcClaimReturnSummary>;

export type MlcReturnReview = {
  id?: string;
  rating?: number;
  comment?: string;
  dateCreated?: string;
  fromRole?: string;
};

export type MlcReturnReviewsSummary = {
  returnId: string;
  reviews: ReadonlyArray<MlcReturnReview>;
};

export type MlcReturnReviewsSnapshot = MlcReturnSnapshotBase<MlcReturnReviewsSummary>;

export type MlcReturnCostCharge = {
  id?: string;
  status?: string;
  type?: string;
  amount?: number;
  currencyId?: string;
  dateCreated?: string;
  description?: string;
};

export type MlcClaimReturnCostSummary = {
  claimId: string;
  charges: ReadonlyArray<MlcReturnCostCharge>;
  totalCost?: number;
};

export type MlcClaimReturnCostSnapshot = MlcReturnSnapshotBase<MlcClaimReturnCostSummary>;

export type OAuthTokenState = {
  sellerId: string;
  site: "MLC";
  accessToken: string;
  refreshToken?: string;
  scopes: ReadonlyArray<string>;
  status: OAuthAccessStatus;
  connectedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
};

export type ReconnectRequired = {
  allowed: false;
  reason: "reconnect-required";
  status: Exclude<OAuthAccessStatus, "connected">;
  message: "MercadoLibre access is not available. Ask the seller to reconnect.";
};

export type SellerAccessMismatch = {
  allowed: false;
  reason: "seller-access-mismatch";
  sellerId: string;
  connectedSellerId: string;
  message: "Requested seller does not match the connected MercadoLibre account.";
};

export type UsableAccess = {
  allowed: true;
  sellerId: string;
  site: "MLC";
  accessToken: string;
};

export type AccessEvaluation = UsableAccess | ReconnectRequired;

export type MercadoLibreApiRequest = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  accessToken: string;
  query?: Readonly<Record<string, string>>;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
  retryOnRateLimit?: boolean;
};

export type MercadoLibreApiTransport = {
  request(request: MercadoLibreApiRequest): Promise<unknown>;
};

export type OAuthSellerAuthorizationFailure = {
  allowed: false;
  reason: "seller-not-configured";
  sellerId: string;
  message: "Requested seller is not configured as an allowed MercadoLibre account role for MSL.";
};

export type MlcCategoryIdentifierFailure = {
  allowed: false;
  reason: "unsupported-category-id" | "unsupported-domain-id";
  identifier: string;
  message: string;
  siteSupport: "unknown";
};

export type MlcApiClient = {
  getListings(
    sellerId: string,
    options?: { status?: "active" | "paused" | "closed"; listingTypeId?: string },
  ): Promise<MlcListingsSnapshot>;
  getItem(sellerId: string, itemId: string): Promise<MlItem>;
  getOrders(
    sellerId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<MlcOrdersSnapshot>;
  getMessages(
    sellerId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<MlcMessagesSnapshot>;
  getReputation(sellerId: string): Promise<MlcReputationSnapshot>;
  getQuestions?(
    sellerId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<MlcQuestionsSnapshot>;
  getCategoryAttributes(
    sellerId: string,
    categoryId: string,
  ): Promise<MlcCategoryAttributesSnapshot>;
  getCategoryTechnicalSpecs(
    sellerId: string,
    domainId: string,
  ): Promise<MlcCategoryTechnicalSpecsSnapshot>;
  getProductAdsInsights?(
    sellerId: string,
    options?: MlcProductAdsInsightsOptions,
  ): Promise<MlcProductAdsInsightsSnapshot>;
  getListingPrices?(
    sellerId: string,
    input: MlcListingPricesInput,
  ): Promise<MlcListingPricesSnapshot>;
  getItemSalePrice?(
    sellerId: string,
    itemId: string,
    options?: { context?: string },
  ): Promise<MlcItemSalePriceSnapshot>;
  getItemPrices?(sellerId: string, itemId: string): Promise<MlcItemPricesSnapshot>;
  getItemPriceToWin?(sellerId: string, itemId: string): Promise<MlcPriceToWinSnapshot>;
  getPricingAutomation?(sellerId: string, itemId: string): Promise<MlcPricingAutomationSnapshot>;
  getPricingAutomationItemRules?(
    sellerId: string,
    itemId: string,
  ): Promise<MlcPricingAutomationRulesSnapshot>;
  getPricingAutomationProductRules?(
    sellerId: string,
    catalogProductId: string,
  ): Promise<MlcPricingAutomationRulesSnapshot>;
  getPricingAutomationPriceHistory?(
    sellerId: string,
    itemId: string,
    options?: { days?: number; page?: number; size?: number },
  ): Promise<MlcPricingAutomationHistorySnapshot>;
  getPricingAutomationItems?(
    sellerId: string,
    options?: { offset?: number; limit?: number },
  ): Promise<MlcAutomatedPriceItemsSnapshot>;
  getSellerPromotions?(sellerId: string): Promise<MlcSellerPromotionsSnapshot>;
  getPromotionDetail?(
    sellerId: string,
    promotionId: string,
    promotionType: string,
  ): Promise<MlcPromotionDetailSnapshot>;
  getPromotionItems?(
    sellerId: string,
    promotionId: string,
    promotionType: string,
    options?: {
      itemId?: string;
      status?: "started" | "pending" | "candidate";
      statusItem?: "active" | "paused";
      limit?: number;
      searchAfter?: string;
    },
  ): Promise<MlcPromotionItemsSnapshot>;
  getItemPromotions?(sellerId: string, itemId: string): Promise<MlcItemPromotionsSnapshot>;
  getItemVisits?(sellerId: string, itemId: string): Promise<MlcVisitsSnapshot>;
  getItemVisitsTimeWindow?(
    sellerId: string,
    itemId: string,
    options: { last: number; unit: "day"; ending?: string },
  ): Promise<MlcVisitsTimeWindowSnapshot>;
  getItemPerformance?(sellerId: string, itemId: string): Promise<MlcPerformanceSnapshot>;
  relistItem?(sellerId: string, itemId: string, input: MlcRelistInput): Promise<MlcRelistSnapshot>;
  diagnoseImage?(
    sellerId: string,
    input: MlcImageDiagnosticInput,
  ): Promise<MlcImageDiagnosticSnapshot>;
  uploadImage?(
    sellerId: string,
    imageBuffer: Buffer,
    filename: string,
  ): Promise<MlcImageUploadSnapshot>;
  getModerationStatus?(sellerId: string, itemId: string): Promise<MlcModerationStatusSnapshot>;
  getNotices?(
    sellerId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<MlcNoticesSnapshot>;
  prepareAnswer?(sellerId: string, input: MlcAnswerInput): Promise<MlcAnswerSnapshot>;
  searchClaims?(
    sellerId: string,
    options?: { limit?: number; offset?: number; status?: string; sort?: string; type?: string },
  ): Promise<MlcClaimsSearchSnapshot>;
  getClaimDetail?(sellerId: string, claimId: string): Promise<MlcClaimDetailSnapshot>;
  getClaimMessages?(sellerId: string, claimId: string): Promise<MlcClaimMessagesSnapshot>;
  getClaimExpectedResolutions?(
    sellerId: string,
    claimId: string,
  ): Promise<MlcClaimResolutionsSnapshot>;
  getClaimAffectsReputation?(
    sellerId: string,
    claimId: string,
  ): Promise<MlcClaimReputationSnapshot>;
  getClaimStatusHistory?(sellerId: string, claimId: string): Promise<MlcClaimStatusHistorySnapshot>;
  associateImageToItem?(
    sellerId: string,
    input: MlcImageAssociateInput,
  ): Promise<MlcImageAssociateSnapshot>;
  getShipmentStatus?(sellerId: string, shipmentId: string): Promise<MlcShipmentStatusSnapshot>;
  getClaimReturn?(sellerId: string, claimId: string): Promise<MlcClaimReturnSnapshot>;
  getReturnReviews?(sellerId: string, returnId: string): Promise<MlcReturnReviewsSnapshot>;
  getClaimReturnCost?(sellerId: string, claimId: string): Promise<MlcClaimReturnCostSnapshot>;
};

export type MlcProductAdsInsightsOptions = {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  itemId?: string;
  campaignId?: string;
  status?: string;
};

type MlcReadRequestOptions = {
  method?: "POST" | "PUT";
  body?: unknown;
  retryOnRateLimit?: boolean;
};

type MlcReadRequest = (
  sellerId: string,
  path: string,
  query?: Readonly<Record<string, string>>,
  headers?: Readonly<Record<string, string>>,
  reqOptions?: MlcReadRequestOptions,
) => Promise<unknown>;

type MlcReadEndpoint<TSnapshot> = {
  path(sellerId: string): string;
  query(sellerId: string): Readonly<Record<string, string>>;
  normalize(input: { sellerId: string; payload: unknown; now: Date }): TSnapshot;
};

// --- Re-exports from types.ts ---
export type {
  MlCategory,
  MlCategoriesSnapshot,
  MlItem,
  MlItemVariation,
  MlOrder,
  MlQuestion,
  MlSaleTerm,
  MlShipping,
  MlUserInfo,
  MlUserSnapshot,
  MlWriteSnapshot,
  NewItem,
  OAuthTokens,
  StoredToken,
} from "./types.js";

export type { OAuthManager, OAuthManagerConfig } from "./oauth/oauthManager.js";

export type { TokenStore } from "./oauth/tokenStore.js";

export { createOAuthManager } from "./oauth/oauthManager.js";

export { createMultiAppOAuthManager } from "./oauth/multiAppOAuthManager.js";

export { resolveOAuthConfigs } from "./oauth/oauthConfig.js";

export { generateState, validateState } from "./oauth/oauthState.js";

export type { OAuthStatePayload } from "./oauth/oauthState.js";

export { createTokenStore } from "./oauth/tokenStore.js";

export {
  createMercadoLibreSupplierSourceAdapter,
  createUnsupportedSupplierSourceAdapter,
  summarizeListingAsSupplierItem,
  type MercadoLibreSupplierSourceAdapterOptions,
  type SupplierEvidence,
  type SupplierSourceAdapter,
  type SupplierSourceCollectInput,
  type SupplierSourceCollectResult,
} from "./supplierSource.js";

export {
  createMercadoLibreScraperFallbackAdapter,
  parseMercadoLibreFallbackHtml,
  type ScraperFallbackFetcher,
  type ScraperFallbackInput,
  type ScraperFallbackParseResult,
} from "./scraperFallback.js";

export {
  createXkpEnrichmentAdapter,
  type XkpEnrichmentClient,
  type XkpEnrichmentRecord,
} from "./xkpEnrichment.js";

export {
  assertOAuthAccountMatchesRole,
  assertPlasticovToMaustianDirection,
  getMlAccountRoleConfig,
  type MlAccountRole,
  type MlAccountRoleConfig,
} from "./accountRoles.js";

// ---------------------------------------------------------------------------
// Re-exports from normalization.ts
// ---------------------------------------------------------------------------

export {
  normalizeMlcItemId,
  assertCompleteMlcItem,
  normalizeImageOrchestration,
} from "./normalization.js";

export { buildNewItemFromMlItem } from "./syncPreview.js";

// ---------------------------------------------------------------------------
// Sync engine exports
// ---------------------------------------------------------------------------

export {
  createProductSyncEngine,
  type ProductSyncEngine,
  type SyncResult,
  type SyncReport,
  type SyncOptions,
  type ConcurrentSyncOptions,
  type SyncJob,
} from "./sync/syncEngine.js";

export {
  applyStrategies,
  previewStrategyChanges,
  type Strategy,
  type MarginStrategy,
  type CategoryFilterStrategy,
  type StockStrategy,
  type PricingRuleStrategy,
  type StrategyApplicationResult,
  type StrategyPreviewResult,
} from "./sync/strategyApplier.js";

export {
  diffListings,
  isOutOfSync as isListingOutOfSync,
  type DiffResult,
} from "./sync/diffEngine.js";

export {
  createSyncStore,
  type SyncStore,
  type SyncState,
  type SyncStatus,
  type MarkSyncedInput,
  type SyncEntry,
} from "./sync/syncStore.js";

export const PRICING_AUTOMATION_ITEMS_DEFAULT_LIMIT = 50;
export const PRICING_AUTOMATION_ITEMS_MAX_LIMIT = 100;
export const PRICING_AUTOMATION_HISTORY_DEFAULT_DAYS = 30;
export const PRICING_AUTOMATION_HISTORY_DEFAULT_PAGE = 0;
export const PRICING_AUTOMATION_HISTORY_DEFAULT_SIZE = 10;
export const PRICING_AUTOMATION_HISTORY_MAX_SIZE = 50;

function normalizePaginationNumber(
  value: number | undefined,
  fallback: number,
  min: number,
  max?: number,
): number {
  const candidate =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  const bounded = Math.max(min, candidate);
  return max === undefined ? bounded : Math.min(max, bounded);
}

const MLC_READ_ENDPOINTS = {
  listings: {
    path: (sellerId: string) => `/users/${sellerId}/items/search`,
    query: () => ({ site: "MLC" }),
    normalize: normalizeListings,
  },
  orders: {
    path: () => "/orders/search",
    query: (sellerId: string) => ({ seller: sellerId, site: "MLC" }),
    normalize: normalizeOrders,
  },
  messages: {
    path: () => "/messages/search",
    query: (sellerId: string) => ({ seller: sellerId, site: "MLC" }),
    normalize: normalizeMessages,
  },
  reputation: {
    path: (sellerId: string) => `/users/${sellerId}`,
    query: () => ({ site: "MLC" }),
    normalize: normalizeReputation,
  },
} satisfies Record<string, MlcReadEndpoint<unknown>>;

async function readMlcSnapshot<TSnapshot>(input: {
  sellerId: string;
  endpoint: MlcReadEndpoint<TSnapshot>;
  request: MlcReadRequest;
  now: Date;
}): Promise<TSnapshot> {
  const payload = await input.request(
    input.sellerId,
    input.endpoint.path(input.sellerId),
    input.endpoint.query(input.sellerId),
  );

  return input.endpoint.normalize({ sellerId: input.sellerId, payload, now: input.now });
}

function createMlcReadMethods(input: { request: MlcReadRequest; now(): Date }): MlcApiClient {
  return {
    getListings: async (sellerId, options) => {
      const baseQuery: Record<string, string> = { site: "MLC" };
      if (options?.status) baseQuery.status = options.status;
      if (options?.listingTypeId) baseQuery.listing_type_id = options.listingTypeId;

      const path = `/users/${sellerId}/items/search`;
      const firstPayload = await input.request(sellerId, path, { ...baseQuery });
      const firstRoot = asRecord(firstPayload);
      const paging = asRecord(firstRoot?.paging);
      const total = numberValue(paging?.total) ?? 0;
      const pageLimit = numberValue(paging?.limit) ?? 50;

      let allResults = asArray(firstRoot?.results ?? firstRoot?.items);

      if (total > 1000) {
        // Use scan + scroll_id for more than 1000 items (ML API limit)
        const scanQuery = { ...baseQuery, search_type: "scan" };
        const scanPayload = await input.request(sellerId, path, scanQuery);
        const scanRoot = asRecord(scanPayload);
        let scrollId = stringValue(scanRoot?.scroll_id) ?? "";
        const scanResults = asArray(scanRoot?.results);
        allResults = allResults.concat(scanResults);

        while (scrollId) {
          // Respect rate limits — small delay between pages
          await new Promise((r) => setTimeout(r, 500));
          const nextQuery: Record<string, string> = {
            ...baseQuery,
            search_type: "scan",
            scroll_id: scrollId,
          };
          const nextPayload = await input.request(sellerId, path, nextQuery);
          const nextRoot = asRecord(nextPayload);
          const nextResults = asArray(nextRoot?.results ?? nextRoot?.items);
          if (nextResults.length === 0) break;
          allResults = allResults.concat(nextResults);
          scrollId = stringValue(nextRoot?.scroll_id) ?? "";
        }
      } else if (total > allResults.length) {
        // Regular offset pagination for ≤1000 items
        let offset = allResults.length;
        while (offset < total) {
          await new Promise((r) => setTimeout(r, 300));
          const pageQuery = {
            ...baseQuery,
            offset: String(offset),
            limit: String(pageLimit),
          };
          const pagePayload = await input.request(sellerId, path, pageQuery);
          const pageRoot = asRecord(pagePayload);
          const pageResults = asArray(pageRoot?.results ?? pageRoot?.items);
          if (pageResults.length === 0) break;
          allResults = allResults.concat(pageResults);
          offset += pageResults.length;
        }
      }

      const mergedPayload = { ...firstRoot, results: allResults };
      const filters: { status?: "active" | "paused" | "closed"; listingTypeId?: string } = {};
      pushOptional(filters, "status", options?.status);
      pushOptional(filters, "listingTypeId", options?.listingTypeId);
      const hasFilters = filters.status !== undefined || filters.listingTypeId !== undefined;
      return normalizeListings({
        sellerId,
        payload: mergedPayload,
        now: input.now(),
        ...(hasFilters ? { filters } : {}),
      });
    },
    getItem: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/items/${safeItemId}`);
      return assertCompleteMlcItem(payload);
    },
    getOrders: async (sellerId, options) => {
      const baseQuery: Record<string, string> = { seller: sellerId, site: "MLC" };
      if (options?.limit !== undefined) baseQuery.limit = String(options.limit);
      if (options?.offset !== undefined) baseQuery.offset = String(options.offset);

      const path = "/orders/search";
      const firstPayload = await input.request(sellerId, path, { ...baseQuery });
      const firstRoot = asRecord(firstPayload);
      const paging = asRecord(firstRoot?.paging);
      const total = numberValue(paging?.total) ?? 0;
      const pageLimit = numberValue(paging?.limit) ?? 50;

      let allResults = asArray(firstRoot?.results ?? firstRoot?.orders);

      if (total > 1000) {
        // Use scan + scroll_id for more than 1000 orders
        const scanQuery: Record<string, string> = { ...baseQuery, search_type: "scan" };
        delete scanQuery.offset;
        delete scanQuery.limit;
        const scanPayload = await input.request(sellerId, path, scanQuery);
        const scanRoot = asRecord(scanPayload);
        let scrollId = stringValue(scanRoot?.scroll_id) ?? "";
        const scanResults = asArray(scanRoot?.results ?? scanRoot?.orders);
        allResults = allResults.concat(scanResults);

        while (scrollId) {
          await new Promise((r) => setTimeout(r, 500));
          const nextQuery: Record<string, string> = {
            ...baseQuery,
            search_type: "scan",
            scroll_id: scrollId,
          };
          const nextPayload = await input.request(sellerId, path, nextQuery);
          const nextRoot = asRecord(nextPayload);
          const nextResults = asArray(nextRoot?.results ?? nextRoot?.orders);
          if (nextResults.length === 0) break;
          allResults = allResults.concat(nextResults);
          scrollId = stringValue(nextRoot?.scroll_id) ?? "";
        }
      } else if (total > allResults.length) {
        let offset = (options?.offset ?? 0) + allResults.length;
        while (offset < total) {
          await new Promise((r) => setTimeout(r, 300));
          const pageQuery = {
            ...baseQuery,
            offset: String(offset),
            limit: String(pageLimit),
          };
          const pagePayload = await input.request(sellerId, path, pageQuery);
          const pageRoot = asRecord(pagePayload);
          const pageResults = asArray(pageRoot?.results ?? pageRoot?.orders);
          if (pageResults.length === 0) break;
          allResults = allResults.concat(pageResults);
          offset += pageResults.length;
        }
      }

      const mergedPayload = { ...firstRoot, results: allResults };
      return normalizeOrders({ sellerId, payload: mergedPayload, now: input.now() });
    },
    getMessages: async (sellerId, options) => {
      // ML API: /questions/search is the seller question/message endpoint.
      // /messages/search does NOT exist (404). Post-sale messages are per-order
      // via /messages/orders/{order_id}, accessed separately through getOrderMessages.
      const query: Record<string, string> = { seller: sellerId, site: "MLC" };
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      const payload = await input.request(sellerId, "/questions/search", query);
      return normalizeMessages({ sellerId, payload, now: input.now() });
    },
    getReputation: (sellerId) =>
      readMlcSnapshot({
        sellerId,
        endpoint: MLC_READ_ENDPOINTS.reputation,
        request: input.request,
        now: input.now(),
      }),
    getQuestions: async (sellerId, options) => {
      const query: Record<string, string> = { seller: sellerId, site: "MLC" };
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      const payload = await input.request(sellerId, "/questions/search", query);
      return normalizeQuestions({ sellerId, payload, now: input.now() });
    },
    getCategoryAttributes: async (sellerId, categoryId) => {
      assertMlcCategoryId(categoryId);
      const payload = await input.request(sellerId, `/categories/${categoryId}/attributes`);
      return normalizeCategoryAttributes({ sellerId, payload, now: input.now() });
    },
    getCategoryTechnicalSpecs: async (sellerId, domainId) => {
      assertMlcDomainId(domainId);
      const payload = await input.request(sellerId, `/domains/${domainId}/technical_specs`);
      return normalizeCategoryTechnicalSpecs({ sellerId, payload, now: input.now() });
    },
    getProductAdsInsights: async (sellerId, options = {}) => {
      const advertiserPayload = await input.request(
        sellerId,
        "/advertising/advertisers",
        { product_id: "PADS" },
        { "Content-Type": "application/json", "Api-Version": "1" },
      );
      const advertiser = findProductAdsAdvertiser(advertiserPayload);
      const basePath = `/advertising/${advertiser.siteId}/advertisers/${advertiser.id}/product_ads`;
      const query = productAdsQuery(options);
      const headers = { "api-version": "2" };
      const [campaignsPayload, adsPayload] = await Promise.all([
        input.request(sellerId, `${basePath}/campaigns/search`, query, headers),
        input.request(sellerId, `${basePath}/ads/search`, query, headers),
      ]);

      return normalizeProductAdsInsights({
        sellerId,
        advertiser,
        campaignsPayload,
        adsPayload,
        options,
        now: input.now(),
      });
    },
    getListingPrices: async (sellerId, listingPricesInput) => {
      const payload = await input.request(
        sellerId,
        `/sites/${listingPricesInput.siteId}/listing_prices`,
        listingPricesQuery(listingPricesInput),
      );
      return normalizeListingPrices({ sellerId, payload, now: input.now() });
    },
    getItemSalePrice: async (sellerId, itemId, options) => {
      const safeItemId = assertMlcItemId(itemId);
      const query: Record<string, string> = {};
      pushOptional(query, "context", options?.context);
      const payload = await input.request(
        sellerId,
        `/items/${safeItemId}/sale_price`,
        Object.keys(query).length > 0 ? query : undefined,
      );
      return normalizeItemSalePrice({ sellerId, itemId: safeItemId, payload, now: input.now() });
    },
    getItemPrices: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/items/${safeItemId}/prices`);
      return normalizeItemPrices({ sellerId, itemId: safeItemId, payload, now: input.now() });
    },
    getItemPriceToWin: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/items/${safeItemId}/price_to_win`, {
        version: "v2",
      });
      return normalizePriceToWin({ sellerId, itemId: safeItemId, payload, now: input.now() });
    },
    getPricingAutomation: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(
        sellerId,
        `/pricing-automation/items/${safeItemId}/automation`,
      );
      return normalizePricingAutomation({
        sellerId,
        itemId: safeItemId,
        payload,
        now: input.now(),
      });
    },
    getPricingAutomationItemRules: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(
        sellerId,
        `/pricing-automation/items/${safeItemId}/rules`,
      );
      return normalizePricingAutomationRules({
        sellerId,
        targetType: "item",
        targetId: safeItemId,
        payload,
        now: input.now(),
      });
    },
    getPricingAutomationProductRules: async (sellerId, catalogProductId) => {
      const safeProductId = assertMlcCatalogProductId(catalogProductId);
      const payload = await input.request(
        sellerId,
        `/pricing-automation/products/${safeProductId}/rules`,
      );
      return normalizePricingAutomationRules({
        sellerId,
        targetType: "product",
        targetId: safeProductId,
        payload,
        now: input.now(),
      });
    },
    getPricingAutomationPriceHistory: async (sellerId, itemId, options = {}) => {
      const safeItemId = assertMlcItemId(itemId);
      const normalized = {
        days: normalizePaginationNumber(options.days, PRICING_AUTOMATION_HISTORY_DEFAULT_DAYS, 1),
        page: normalizePaginationNumber(options.page, PRICING_AUTOMATION_HISTORY_DEFAULT_PAGE, 0),
        size: normalizePaginationNumber(
          options.size,
          PRICING_AUTOMATION_HISTORY_DEFAULT_SIZE,
          1,
          PRICING_AUTOMATION_HISTORY_MAX_SIZE,
        ),
      };
      const payload = await input.request(
        sellerId,
        `/pricing-automation/items/${safeItemId}/price/history`,
        {
          days: String(normalized.days),
          page: String(normalized.page),
          size: String(normalized.size),
        },
      );
      return normalizePricingAutomationPriceHistory({
        sellerId,
        itemId: safeItemId,
        payload,
        now: input.now(),
        options: normalized,
      });
    },
    getPricingAutomationItems: async (sellerId, options = {}) => {
      const normalized = {
        offset: normalizePaginationNumber(options.offset, 0, 0),
        limit: normalizePaginationNumber(
          options.limit,
          PRICING_AUTOMATION_ITEMS_DEFAULT_LIMIT,
          1,
          PRICING_AUTOMATION_ITEMS_MAX_LIMIT,
        ),
      };
      const payload = await input.request(sellerId, `/pricing-automation/users/${sellerId}/items`, {
        offset: String(normalized.offset),
        limit: String(normalized.limit),
      });
      return normalizeAutomatedPriceItems({
        sellerId,
        payload,
        now: input.now(),
        options: normalized,
      });
    },
    getSellerPromotions: async (sellerId) => {
      const payload = await input.request(sellerId, `/seller-promotions/users/${sellerId}`, {
        app_version: "v2",
      });
      return normalizeSellerPromotions({
        sellerId,
        payload,
        now: input.now(),
      });
    },
    getPromotionDetail: async (sellerId, promotionId, promotionType) => {
      const safePromotionId = assertPromotionId(promotionId);
      const safePromotionType = assertPromotionType(promotionType);
      const payload = await input.request(
        sellerId,
        `/seller-promotions/promotions/${safePromotionId}`,
        { promotion_type: safePromotionType, app_version: "v2" },
      );
      return normalizePromotionDetail({ sellerId, payload, now: input.now() });
    },
    getPromotionItems: async (sellerId, promotionId, promotionType, options = {}) => {
      const safePromotionId = assertPromotionId(promotionId);
      const safePromotionType = assertPromotionType(promotionType);
      const normalized = {
        limit: normalizePaginationNumber(
          options.limit,
          MLC_PROMOTIONS_ITEMS_DEFAULT_LIMIT,
          1,
          MLC_PROMOTIONS_ITEMS_MAX_LIMIT,
        ),
      };
      const query: Record<string, string> = {
        promotion_type: safePromotionType,
        app_version: "v2",
        limit: String(normalized.limit),
      };
      if (options.itemId !== undefined) query.item_id = assertMlcItemId(options.itemId);
      if (options.status !== undefined) query.status = options.status;
      if (options.statusItem !== undefined) query.status_item = options.statusItem;
      pushOptional(query, "search_after", options.searchAfter);
      const payload = await input.request(
        sellerId,
        `/seller-promotions/promotions/${safePromotionId}/items`,
        query,
      );
      return normalizePromotionItems({
        sellerId,
        promotionId: safePromotionId,
        promotionType: safePromotionType,
        payload,
        now: input.now(),
        options: normalized,
      });
    },
    getItemPromotions: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/seller-promotions/items/${safeItemId}`, {
        app_version: "v2",
      });
      return normalizeItemPromotions({ sellerId, itemId: safeItemId, payload, now: input.now() });
    },
    getItemVisits: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, "/visits/items", { ids: safeItemId });
      return normalizeItemVisits({ sellerId, payload, now: input.now() });
    },
    getItemVisitsTimeWindow: async (sellerId, itemId, options) => {
      const safeItemId = assertMlcItemId(itemId);
      const query: Record<string, string> = {
        last: String(options.last),
        unit: options.unit,
      };
      if (options.ending) {
        query.ending = options.ending;
      }
      const payload = await input.request(
        sellerId,
        `/items/${safeItemId}/visits/time_window`,
        query,
      );
      return normalizeItemVisitsTimeWindow({
        sellerId,
        payload,
        now: input.now(),
        options,
      });
    },
    getItemPerformance: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/items/${safeItemId}/performance`);
      return normalizeListingPerformance({ sellerId, payload, now: input.now() });
    },
    relistItem: async (sellerId, itemId, relistInput) => {
      const safeItemId = assertMlcItemId(itemId);
      const body: Record<string, unknown> = {};
      if (relistInput.price !== undefined) body.price = relistInput.price;
      if (relistInput.quantity !== undefined) body.quantity = relistInput.quantity;
      if (relistInput.listingTypeId) body.listing_type_id = relistInput.listingTypeId;
      const payload = await input.request(
        sellerId,
        `/items/${safeItemId}/relist`,
        undefined,
        undefined,
        { method: "POST", body: JSON.stringify(body) },
      );
      return normalizeRelist({ sellerId, payload, now: input.now(), itemId: safeItemId });
    },
    diagnoseImage: async (sellerId, diagnosticInput) => {
      const context: Record<string, unknown> = {
        category_id: diagnosticInput.categoryId,
      };
      if (diagnosticInput.title !== undefined) {
        context.title = diagnosticInput.title;
      }
      if (diagnosticInput.pictureType !== undefined) {
        context.picture_type = diagnosticInput.pictureType;
      }
      const body = { picture_url: diagnosticInput.pictureUrl, context };
      const payload = await input.request(
        sellerId,
        "/moderations/pictures/diagnostic",
        undefined,
        undefined,
        { method: "POST", body: JSON.stringify(body) },
      );
      return normalizeImageDiagnostic({ sellerId, payload, now: input.now() });
    },
    uploadImage: async (sellerId, imageBuffer, filename) => {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(imageBuffer)], { type: "image/jpeg" });
      formData.append("file", blob, filename);
      const payload = await input.request(
        sellerId,
        "/pictures/items/upload",
        undefined,
        undefined,
        { method: "POST", body: formData },
      );
      return normalizeImageUpload({ sellerId, payload, now: input.now() });
    },
    getModerationStatus: async (sellerId, itemId) => {
      const safeItemId = assertMlcItemId(itemId);
      const payload = await input.request(sellerId, `/moderations/last_moderation/${safeItemId}`);
      return normalizeModerationStatus({ sellerId, payload, now: input.now() });
    },
    getNotices: async (sellerId, options) => {
      const query: Record<string, string> = {};
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      const payload = await input.request(
        sellerId,
        "/communications/notices",
        Object.keys(query).length > 0 ? query : undefined,
      );
      return normalizeNotices({ sellerId, payload, now: input.now() });
    },
    prepareAnswer: (sellerId, answerInput) => {
      const questionId = answerInput.questionId.trim();
      const text = answerInput.text.trim();
      if (!questionId || !text) {
        return Promise.resolve(
          normalizeAnswer({
            sellerId,
            questionId: "",
            text: "",
            now: input.now(),
          }),
        );
      }
      return Promise.resolve(normalizeAnswer({ sellerId, questionId, text, now: input.now() }));
    },
    searchClaims: async (sellerId, options) => {
      // ML API requires at least one "search" filter in addition to
      // players scoping. If no explicit filter is set, default to all statuses
      // by adding a broad filter. The caller can override with specific filters.
      const query: Record<string, string> = {
        "players.user_id": sellerId,
        "players.role": "respondent",
        // Default filter: get claims of any mediation type (covers most cases).
        // The caller can override by passing options.type.
        type: options?.type ?? "mediations",
      };
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      if (options?.status !== undefined) query.status = options.status;
      if (options?.sort !== undefined) query.sort = options.sort;
      try {
        const payload = await input.request(
          sellerId,
          "/post-purchase/v1/claims/search",
          query,
          undefined,
          { retryOnRateLimit: false },
        );
        return normalizeClaimsSearch({ sellerId, payload, now: input.now() });
      } catch (error) {
        if (isRateLimitError(error)) {
          return normalizeRateLimitedClaimsSearch({ sellerId, now: input.now() });
        }
        throw error;
      }
    },
    getClaimDetail: async (sellerId, claimId) => {
      const payload = await input.request(sellerId, `/post-purchase/v1/claims/${claimId}`);
      return normalizeClaimDetail({ sellerId, payload, now: input.now() });
    },
    getShipmentStatus: async (sellerId, shipmentId) => {
      try {
        const payload = await input.request(
          sellerId,
          `/marketplace/shipments/${shipmentId}`,
          undefined,
          { "x-format-new": "true" },
          { retryOnRateLimit: false },
        );
        return normalizeShipmentStatus({ sellerId, payload, now: input.now() });
      } catch (error) {
        if (isRateLimitError(error)) {
          return normalizeRateLimitedShipmentStatus({ sellerId, now: input.now() });
        }
        throw error;
      }
    },
    getClaimReturn: async (sellerId, claimId) => {
      try {
        const payload = await input.request(
          sellerId,
          `/post-purchase/v2/claims/${claimId}/returns`,
          undefined,
          undefined,
          { retryOnRateLimit: false },
        );
        return normalizeClaimReturn({ sellerId, claimId, payload, now: input.now() });
      } catch {
        return degradedReturnSnapshot<MlcClaimReturnSummary, MlcClaimReturnSnapshot>({
          sellerId,
          now: input.now(),
          kind: "business-signal",
          data: { claimId, returns: [] },
          completeness: "partial",
        });
      }
    },
    getReturnReviews: async (sellerId, returnId) => {
      try {
        const payload = await input.request(
          sellerId,
          `/post-purchase/v1/returns/${returnId}/reviews`,
          undefined,
          undefined,
          { retryOnRateLimit: false },
        );
        return normalizeReturnReviews({ sellerId, returnId, payload, now: input.now() });
      } catch {
        return degradedReturnSnapshot<MlcReturnReviewsSummary, MlcReturnReviewsSnapshot>({
          sellerId,
          now: input.now(),
          kind: "business-signal",
          data: { returnId, reviews: [] },
          completeness: "partial",
        });
      }
    },
    getClaimReturnCost: async (sellerId, claimId) => {
      try {
        const payload = await input.request(
          sellerId,
          `/post-purchase/v1/claims/${claimId}/charges/return-cost`,
          undefined,
          undefined,
          { retryOnRateLimit: false },
        );
        return normalizeClaimReturnCost({ sellerId, claimId, payload, now: input.now() });
      } catch {
        return degradedReturnSnapshot<MlcClaimReturnCostSummary, MlcClaimReturnCostSnapshot>({
          sellerId,
          now: input.now(),
          kind: "business-signal",
          data: { claimId, charges: [] },
          completeness: "partial",
        });
      }
    },
    getClaimMessages: async (sellerId, claimId) => {
      const payload = await input.request(sellerId, `/post-purchase/v1/claims/${claimId}/messages`);
      return normalizeClaimMessages({ sellerId, payload, now: input.now() });
    },
    getClaimExpectedResolutions: async (sellerId, claimId) => {
      const payload = await input.request(
        sellerId,
        `/post-purchase/v1/claims/${claimId}/expected_resolutions`,
      );
      return normalizeClaimExpectedResolutions({ sellerId, payload, now: input.now() });
    },
    getClaimAffectsReputation: async (sellerId, claimId) => {
      const payload = await input.request(
        sellerId,
        `/post-purchase/v1/claims/${claimId}/affects-reputation`,
      );
      return normalizeClaimAffectsReputation({ sellerId, payload, now: input.now() });
    },
    getClaimStatusHistory: async (sellerId, claimId) => {
      const payload = await input.request(
        sellerId,
        `/post-purchase/v1/claims/${claimId}/status_history`,
      );
      return normalizeClaimStatusHistory({ sellerId, payload, now: input.now() });
    },
    associateImageToItem: async (sellerId, imageAssociateInput) => {
      const safeItemId = assertMlcItemId(imageAssociateInput.itemId);
      await input.request(sellerId, `/items/${safeItemId}`);
      const data: MlcImageAssociateSummary = {
        itemId: safeItemId,
        pictureId: imageAssociateInput.pictureId,
        status: "associated",
      };
      return {
        sellerId,
        kind: "listing",
        source: "mercadolibre-api",
        data,
        completeness: "complete",
        freshness: createFreshness("listing", input.now()),
        confidence: "medium",
      };
    },
  };
}

export function evaluateOAuthAccess(state: OAuthTokenState, now: Date): AccessEvaluation {
  if (state.status === "revoked" || state.status === "expired" || state.expiresAt <= now) {
    return {
      allowed: false,
      reason: "reconnect-required",
      status: state.status === "connected" ? "expired" : state.status,
      message: "MercadoLibre access is not available. Ask the seller to reconnect.",
    };
  }

  return {
    allowed: true,
    sellerId: state.sellerId,
    site: state.site,
    accessToken: state.accessToken,
  };
}

export function createMlcApiClient(input: {
  tokenState: OAuthTokenState;
  transport: MercadoLibreApiTransport;
  now: Date;
}): MlcApiClient {
  const request = async (
    sellerId: string,
    path: string,
    query?: Readonly<Record<string, string>>,
    headers?: Readonly<Record<string, string>>,
    reqOptions?: MlcReadRequestOptions,
  ) => {
    const access = evaluateOAuthAccess(input.tokenState, input.now);

    if (!access.allowed) {
      throw Object.assign(new Error(access.message), access);
    }

    if (sellerId !== access.sellerId) {
      const mismatch: SellerAccessMismatch = {
        allowed: false,
        reason: "seller-access-mismatch",
        sellerId,
        connectedSellerId: access.sellerId,
        message: "Requested seller does not match the connected MercadoLibre account.",
      };
      throw Object.assign(new Error(mismatch.message), mismatch);
    }

    const apiRequest: MercadoLibreApiRequest = {
      method: reqOptions?.method ?? "GET",
      path,
      accessToken: access.accessToken,
    };

    if (query !== undefined) {
      apiRequest.query = query;
    }
    if (headers !== undefined) {
      apiRequest.headers = headers;
    }
    if (reqOptions?.body !== undefined) {
      apiRequest.body = reqOptions.body;
    }
    if (reqOptions?.retryOnRateLimit !== undefined) {
      apiRequest.retryOnRateLimit = reqOptions.retryOnRateLimit;
    }

    return input.transport.request(apiRequest);
  };

  return createMlcReadMethods({ request, now: () => input.now });
}

export function createOAuthMlcApiClient(input: {
  oauthManager: OAuthManager;
  transport: MercadoLibreApiTransport;
  now(): Date;
  allowedSellerIds: ReadonlyArray<string>;
}): MlcApiClient {
  const allowedSellerIds = new Set(
    input.allowedSellerIds.map((sellerId) => sellerId.trim()).filter(Boolean),
  );

  if (allowedSellerIds.size === 0) {
    const failure: OAuthSellerAuthorizationFailure = {
      allowed: false,
      reason: "seller-not-configured",
      sellerId: "",
      message:
        "Requested seller is not configured as an allowed MercadoLibre account role for MSL.",
    };
    throw Object.assign(new Error(failure.message), failure);
  }

  const request = async (
    sellerId: string,
    path: string,
    query?: Readonly<Record<string, string>>,
    headers?: Readonly<Record<string, string>>,
    reqOptions?: MlcReadRequestOptions,
  ) => {
    if (!allowedSellerIds.has(sellerId)) {
      const failure: OAuthSellerAuthorizationFailure = {
        allowed: false,
        reason: "seller-not-configured",
        sellerId,
        message:
          "Requested seller is not configured as an allowed MercadoLibre account role for MSL.",
      };
      throw Object.assign(new Error(failure.message), failure);
    }

    const accessToken = await input.oauthManager.ensureValidToken(sellerId);
    const apiRequest: MercadoLibreApiRequest = {
      method: reqOptions?.method ?? "GET",
      path,
      accessToken,
    };

    if (query !== undefined) {
      apiRequest.query = query;
    }
    if (headers !== undefined) {
      apiRequest.headers = headers;
    }
    if (reqOptions?.body !== undefined) {
      apiRequest.body = reqOptions.body;
    }
    if (reqOptions?.retryOnRateLimit !== undefined) {
      apiRequest.retryOnRateLimit = reqOptions.retryOnRateLimit;
    }

    return input.transport.request(apiRequest);
  };

  return createMlcReadMethods({ request, now: () => input.now() });
}

// ---------------------------------------------------------------------------
// Real fetch-based HTTP transport with exponential backoff
// ---------------------------------------------------------------------------

const ML_API_BASE = "https://api.mercadolibre.com";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 30_000;

function shouldRetry(status: number, options?: { retryOnRateLimit?: boolean }): boolean {
  if (status === 429) return options?.retryOnRateLimit !== false;
  return status >= 500;
}

/**
 * Fetch with exponential backoff + jitter for ML API rate limiting.
 *
 * Retries on HTTP 429 (rate-limited) and 5xx (server errors), with
 * capped exponential delay plus uniform random jitter to avoid
 * thundering-herd retry storms.  Network errors (connection refused,
 * DNS failure) are also retried.
 */
async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  options?: { retryOnRateLimit?: boolean },
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 100, 200, 400, 800 ms capped at 30 s
      // plus uniform jitter of ±50 % to prevent synchronised retries.
      const base = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      const jitter = base * 0.5 * Math.random(); // ±50 %
      const delay = Math.round(base + jitter);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const response = await fetch(url, init);

      if (!shouldRetry(response.status, options) || attempt === MAX_RETRIES) {
        return response;
      }

      // Will retry on 429 unless disabled by the caller, and on 5xx.
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) throw err;
    }
  }

  throw lastError;
}

export function createMercadoLibreApiFetchTransport(): MercadoLibreApiTransport {
  return {
    async request(request) {
      let url = `${ML_API_BASE}${request.path}`;
      if (request.query && Object.keys(request.query).length > 0) {
        url = `${url}?${new URLSearchParams(request.query).toString()}`;
      }

      const init: RequestInit & { headers: Record<string, string> } = {
        method: request.method,
        headers: { Authorization: `Bearer ${request.accessToken}`, ...request.headers },
      };

      if (request.body !== undefined && request.method !== "GET") {
        if (request.body instanceof FormData || request.body instanceof Blob) {
          init.body = request.body;
          // Let fetch set the Content-Type with boundary for multipart.
        } else if (typeof request.body === "string") {
          init.headers["Content-Type"] = "application/json";
          init.body = request.body;
        } else {
          init.headers["Content-Type"] = "application/json";
          init.body = JSON.stringify(request.body);
        }
      }

      const response = await fetchWithBackoff(
        url,
        init,
        request.retryOnRateLimit === undefined
          ? undefined
          : { retryOnRateLimit: request.retryOnRateLimit },
      );

      if (!response.ok) {
        throw new Error(
          `ML API ${request.method} ${request.path} failed: ${response.status} ${response.statusText}`,
        );
      }

      return response.json();
    },
  };
}

// ── Mock data payloads moved to mockData.ts ──

// ---------------------------------------------------------------------------
// New MlClient type with write operations
// ---------------------------------------------------------------------------

export type MlRelistInput = {
  price?: number;
  quantity?: number;
  listing_type_id?: string;
  variations?: Array<{
    id: number;
    price?: number;
    quantity?: number;
  }>;
};

export type MlCatalogListingInput = {
  item_id: string;
  catalog_product_id: string;
  variation_id?: number;
};

export type MlClient = {
  // Read operations
  getItems(sellerId: string): Promise<MlcListingsSnapshot>;
  getItem(sellerId: string, itemId: string): Promise<MlItem>;
  getOrders(sellerId: string): Promise<MlcOrdersSnapshot>;
  getQuestions(sellerId: string): Promise<MlcQuestionsSnapshot>;
  // Write operations
  publishItem(sellerId: string, item: NewItem): Promise<MlWriteSnapshot>;
  updateItem(sellerId: string, itemId: string, updates: Partial<NewItem>): Promise<MlWriteSnapshot>;
  relistItem(sellerId: string, itemId: string, input: MlRelistInput): Promise<MlWriteSnapshot>;
  createCatalogListing(sellerId: string, input: MlCatalogListingInput): Promise<MlWriteSnapshot>;
  // Metadata operations
  getCategories(sellerId: string, categoryId?: string): Promise<MlCategoriesSnapshot>;
  getUserInfo(sellerId: string): Promise<MlUserSnapshot>;
};

// ---------------------------------------------------------------------------
// Factory: createMlClient — multi-account OAuth-aware ML API client
// ---------------------------------------------------------------------------

export function createMlClient(input: { oauthManager: OAuthManager; now: Date }): MlClient {
  const { oauthManager, now } = input;
  const stub = oauthManager.isStubMode();

  async function apiRequest(
    sellerId: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const accessToken = await oauthManager.ensureValidToken(sellerId);

    let url = `${ML_API_BASE}${path}`;
    if (query && Object.keys(query).length > 0) {
      const qs = new URLSearchParams(query).toString();
      url = `${url}?${qs}`;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };

    const init: RequestInit = { method, headers };

    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const response = await fetchWithBackoff(url, init);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `ML API ${method} ${path} failed: ${response.status} ${response.statusText}${errorText ? ` — ${errorText}` : ""}`,
      );
    }

    return response;
  }

  async function apiRequestJson(
    sellerId: string,
    method: "GET" | "POST" | "PUT",
    path: string,
    query?: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    // Validate token exists even in stub mode
    const stored = oauthManager.getStoredToken(sellerId);
    if (!stored) {
      throw new Error(`No stored token for seller ${sellerId}`);
    }

    if (stub) {
      return mockResponse(path, method, body);
    }

    const response = await apiRequest(sellerId, method, path, query, body);
    return response.json();
  }

  return {
    getItems: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", `/users/${sellerId}/items/search`, {
        site: "MLC",
      });
      return normalizeItems({ sellerId, payload, now });
    },

    getItem: async (sellerId, itemId) => {
      const payload = await apiRequestJson(sellerId, "GET", `/items/${itemId}`);
      return assertCompleteMlcItem(payload);
    },

    getOrders: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", "/orders/search", {
        seller: sellerId,
        site: "MLC",
      });
      return normalizeOrders({ sellerId, payload, now });
    },

    getQuestions: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", "/questions/search", {
        seller: sellerId,
        site: "MLC",
      });
      return normalizeQuestions({ sellerId, payload, now });
    },

    publishItem: async (sellerId, item) => {
      const payload = await apiRequestJson(sellerId, "POST", "/items", undefined, item);
      return normalizeWriteResponse({ sellerId, payload, now });
    },

    updateItem: async (sellerId, itemId, updates) => {
      const payload = await apiRequestJson(sellerId, "PUT", `/items/${itemId}`, undefined, updates);
      return normalizeWriteResponse({ sellerId, payload, now });
    },

    relistItem: async (sellerId, itemId, input) => {
      const payload = await apiRequestJson(
        sellerId,
        "POST",
        `/items/${itemId}/relist`,
        undefined,
        input,
      );
      return normalizeWriteResponse({ sellerId, payload, now });
    },

    createCatalogListing: async (sellerId, input) => {
      const payload = await apiRequestJson(
        sellerId,
        "POST",
        "/items/catalog_listings",
        undefined,
        input,
      );
      return normalizeWriteResponse({ sellerId, payload, now });
    },

    getCategories: async (sellerId, categoryId) => {
      const path = categoryId ? `/categories/${categoryId}` : "/categories";
      const payload = await apiRequestJson(sellerId, "GET", path, { site: "MLC" });
      return normalizeCategories({ sellerId, payload, now });
    },

    getUserInfo: async (sellerId) => {
      const payload = await apiRequestJson(sellerId, "GET", "/users/me");
      return normalizeUser({ sellerId, payload, now });
    },
  };
}
