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

export type MlcClaimsSearchSnapshot = MlcSingleReadSnapshot<MlcClaimsSearchResult>;
export type MlcQuestionsSnapshot = MlcSingleReadSnapshot<MlcQuestionsSearchResult>;
export type MlcClaimDetailSnapshot = MlcSingleReadSnapshot<MlcClaimDetailSummary>;
export type MlcClaimMessagesSnapshot = MlcSingleReadSnapshot<MlcClaimMessagesSummary>;
export type MlcClaimResolutionsSnapshot = MlcSingleReadSnapshot<MlcClaimResolutionsSummary>;
export type MlcClaimReputationSnapshot = MlcSingleReadSnapshot<MlcClaimReputationSummary>;
export type MlcClaimStatusHistorySnapshot = MlcSingleReadSnapshot<MlcClaimStatusHistorySummary>;
export type MlcShipmentStatusSnapshot = MlcSingleReadSnapshot<MlcShipmentStatusSummary>;

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
    options?: { limit?: number; offset?: number; status?: string; sort?: string },
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
  MlOrder,
  MlQuestion,
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

export { createTokenStore } from "./oauth/tokenStore.js";

export {
  assertOAuthAccountMatchesRole,
  assertPlasticovToMaustianDirection,
  getMlAccountRoleConfig,
  type MlAccountRole,
  type MlAccountRoleConfig,
} from "./accountRoles.js";

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

function createFreshness(kind: MlcReadSnapshotKind, now: Date): MlcReadSnapshotFreshness {
  return evaluateFreshness({
    source: "mercadolibre-api",
    signalKind: kind,
    capturedAt: now,
    now,
  }) as MlcReadSnapshotFreshness;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Readonly<Record<string, unknown>>;
}

function asArray(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numericStringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function pushOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function snapshotConfidence(
  completeness: MlcReadSnapshotCompleteness,
  count: number,
): MlcReadSnapshotConfidence {
  if (completeness === "partial") {
    return "low";
  }

  return count > 0 ? "high" : "medium";
}

function sellerScope(sellerId: string): { sellerId: string; site: "MLC" } {
  return { sellerId, site: "MLC" };
}

function assertIsoDate(value: string | undefined, field: string): void {
  if (value !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Product Ads ${field} must use YYYY-MM-DD format.`);
  }
}

function productAdsQuery(options: MlcProductAdsInsightsOptions = {}): Record<string, string> {
  assertIsoDate(options.dateFrom, "dateFrom");
  assertIsoDate(options.dateTo, "dateTo");
  const query: Record<string, string> = {
    limit: String(options.limit ?? MLC_PRODUCT_ADS_DEFAULT_LIMIT),
    offset: String(options.offset ?? MLC_PRODUCT_ADS_DEFAULT_OFFSET),
    metrics: MLC_PRODUCT_ADS_DEFAULT_METRICS,
    metrics_summary: "true",
  };
  pushOptional(query, "date_from", options.dateFrom);
  pushOptional(query, "date_to", options.dateTo);
  pushOptional(query, "item_id", options.itemId);
  pushOptional(query, "campaign_id", options.campaignId);
  pushOptional(query, "status", options.status);
  return query;
}

function productAdsMetrics(
  record: Readonly<Record<string, unknown>> | undefined,
): MlcProductAdsMetricSummary | undefined {
  const metrics = asRecord(record?.metrics) ?? asRecord(record?.metrics_summary) ?? record;
  if (metrics === undefined) return undefined;
  const summary = Object.fromEntries(
    Object.keys(metrics).flatMap((key) => {
      const value = numberValue(metrics[key]);
      return value === undefined ? [] : [[key, value]];
    }),
  );
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function listingPricesQuery(input: MlcListingPricesInput): Record<string, string> {
  if (!input.siteId) throw new Error("Listing prices siteId is required.");
  if (!Number.isFinite(input.price)) throw new Error("Listing prices price must be finite.");
  if (!input.categoryId) throw new Error("Listing prices categoryId is required.");
  const usesLogisticsAwareParams =
    input.logisticsAware === true ||
    input.logisticType !== undefined ||
    input.shippingMode !== undefined ||
    input.billableWeight !== undefined;
  if (input.siteId === "MLA" && usesLogisticsAwareParams && input.billableWeight === undefined) {
    throw new Error(
      "MLA listing price logistics-aware calculations require billableWeight to avoid incorrect 2026 fixed fee estimates.",
    );
  }

  const query: Record<string, string> = {
    price: String(input.price),
    category_id: input.categoryId,
  };
  pushOptional(query, "currency_id", input.currencyId);
  pushOptional(query, "listing_type_id", input.listingTypeId);
  pushOptional(query, "logistic_type", input.logisticType);
  // Official listing_prices docs use the singular `shipping_mode` parameter.
  pushOptional(query, "shipping_mode", input.shippingMode);
  if (input.billableWeight !== undefined) query.billable_weight = String(input.billableWeight);
  if (input.quantity !== undefined) query.quantity = String(input.quantity);
  if (Array.isArray(input.tags)) {
    if (input.tags.length > 0) query.tags = input.tags.join(",");
  } else if (typeof input.tags === "string") {
    pushOptional(query, "tags", input.tags);
  }
  return query;
}

function normalizeSaleFeeDetails(
  record: Readonly<Record<string, unknown>> | undefined,
): MlcSaleFeeDetails {
  const details: MlcSaleFeeDetails = {};
  pushOptional(details, "financingAddOnFee", numberValue(record?.financing_add_on_fee));
  pushOptional(details, "fixedFee", numberValue(record?.fixed_fee));
  pushOptional(details, "grossAmount", numberValue(record?.gross_amount));
  pushOptional(details, "meliPercentageFee", numberValue(record?.meli_percentage_fee));
  pushOptional(details, "percentageFee", numberValue(record?.percentage_fee));
  return details;
}

function assertMlcCategoryId(categoryId: string): void {
  if (!isMlcCategoryId(categoryId)) {
    const failure: MlcCategoryIdentifierFailure = {
      allowed: false,
      reason: "unsupported-category-id",
      identifier: categoryId,
      message: "Only MLC-confirmed category IDs are supported for category attribute reads.",
      siteSupport: "unknown",
    };
    throw Object.assign(new Error(failure.message), failure);
  }
}

export function normalizeMlcItemId(itemId: string): string | null {
  const trimmed = itemId.trim();
  return /^MLC\d+$/.test(trimmed) ? trimmed : null;
}

function assertMlcItemId(itemId: string): string {
  const normalized = normalizeMlcItemId(itemId);
  if (!normalized) {
    throw new Error("Only MLC item IDs are supported for item reads.");
  }

  return normalized;
}

function assertMlcCatalogProductId(catalogProductId: string): string {
  const trimmed = catalogProductId.trim();
  if (!/^MLC\d+$/.test(trimmed)) {
    throw new Error("Only MLC catalog product IDs are supported for pricing automation reads.");
  }

  return trimmed;
}

function assertMlcDomainId(domainId: string): void {
  if (!isMlcDomainId(domainId)) {
    const failure: MlcCategoryIdentifierFailure = {
      allowed: false,
      reason: "unsupported-domain-id",
      identifier: domainId,
      message: "Only MLC-confirmed domain IDs are supported for category technical spec reads.",
      siteSupport: "unknown",
    };
    throw Object.assign(new Error(failure.message), failure);
  }
}

function normalizeListings(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
  filters?: { status?: "active" | "paused" | "closed"; listingTypeId?: string };
}): MlcListingsSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.items);
  let complete = root !== undefined && Array.isArray(root.results ?? root.items);

  const data = results.flatMap((item): MlcListingSummary[] => {
    if (typeof item === "string") {
      complete = false;
      return [{ id: item }];
    }

    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const summary: MlcListingSummary = { id };
    pushOptional(summary, "title", stringValue(record.title));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "availableQuantity", numberValue(record.available_quantity));
    pushOptional(summary, "price", numberValue(record.price));
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "permalink", stringValue(record.permalink));
    pushOptional(summary, "categoryId", stringValue(record.category_id));
    pushOptional(summary, "listingTypeId", stringValue(record.listing_type_id));

    if (summary.title === undefined || summary.status === undefined) {
      complete = false;
    }

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeItemVisits(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcVisitsSnapshot {
  const record = asRecord(input.payload);
  let complete = record !== undefined;
  const data: MlcVisitsSummary[] = [];

  if (record) {
    for (const [itemId, rawValue] of Object.entries(record)) {
      const totalVisits = numberValue(rawValue) ?? 0;
      if (totalVisits === 0 && rawValue !== 0 && rawValue !== "0") {
        complete = false;
      }

      const summary: MlcVisitsSummary = { itemId, totalVisits };
      data.push(summary);
    }
  }

  const completeness = complete && data.length > 0 ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeItemVisitsTimeWindow(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
  options: { last: number; unit: "day"; ending?: string };
}): MlcVisitsTimeWindowSnapshot {
  const record = asRecord(input.payload);
  const itemId = stringValue(record?.item_id) ?? "";
  const results = asArray(record?.results);
  const { last, unit, ending } = input.options;

  let complete = record !== undefined && itemId.length > 0;

  const parsedResults = results.flatMap(
    (
      result,
    ): Array<{
      date: string;
      total: number;
      visitsDetail: MlcVisitsDetail[];
    }> => {
      const row = asRecord(result);
      const date = stringValue(row?.date);
      const total = numberValue(row?.total);
      if (row === undefined || date === undefined || total === undefined) {
        complete = false;
        return [];
      }

      const detail = asArray(row?.visits_detail ?? row?.visitsDetail ?? row?.visits);
      const visitsDetail: MlcVisitsDetail[] = detail.flatMap((d) => {
        const dr = asRecord(d);
        const company = stringValue(dr?.company) ?? stringValue(dr?.name) ?? "";
        const quantity = numberValue(dr?.quantity) ?? numberValue(dr?.count) ?? 0;
        return company ? [{ company, quantity }] : [];
      });

      return [{ date, total, visitsDetail }];
    },
  );

  const totalVisits = parsedResults.reduce((sum, r) => sum + r.total, 0);
  const dates = parsedResults.map((r) => r.date).sort();
  const dateFrom = dates[0] ?? "";
  const dateTo = dates[dates.length - 1] ?? "";

  const data: MlcVisitsTimeWindowSummary = {
    itemId,
    dateFrom,
    dateTo,
    totalVisits,
    last,
    unit,
    results: parsedResults,
  };

  if (ending !== undefined) {
    (data as Record<string, unknown>).ending = ending;
  }

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, parsedResults.length),
  };
}

function normalizeListingPerformance(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcPerformanceSnapshot {
  const record = asRecord(input.payload);
  const buckets = asArray(record?.buckets).map(normalizePerformanceBucket);
  const summary: MlcPerformanceSummary = {
    entityId: stringValue(record?.entity_id) ?? "",
    entityType: stringValue(record?.entity_type) ?? "",
    score: numberValue(record?.score) ?? 0,
    level: stringValue(record?.level) ?? "",
    levelWording: stringValue(record?.level_wording) ?? "",
    calculatedAt: stringValue(record?.calculated_at) ?? "",
    buckets,
  };
  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: summary,
    completeness: "complete",
    freshness: createFreshness("listing", input.now),
    confidence: "high",
  };
}

function normalizePerformanceBucket(raw: unknown): MlcPerformanceBucket {
  const record = asRecord(raw);
  const variables = asArray(record?.variables).map(normalizePerformanceVariable);
  return {
    key: stringValue(record?.key) ?? "",
    status: (stringValue(record?.status) as "COMPLETED" | "PENDING") ?? "PENDING",
    score: numberValue(record?.score) ?? 0,
    title: stringValue(record?.title) ?? "",
    variables,
  };
}

function normalizePerformanceVariable(raw: unknown): MlcPerformanceVariable {
  const record = asRecord(raw);
  const rules = asArray(record?.rules).map(normalizePerformanceRule);
  return {
    key: stringValue(record?.key) ?? "",
    status: (stringValue(record?.status) as "COMPLETED" | "PENDING") ?? "PENDING",
    score: numberValue(record?.score) ?? 0,
    title: stringValue(record?.title) ?? "",
    rules,
  };
}

function normalizePerformanceRule(raw: unknown): MlcPerformanceRule {
  const record = asRecord(raw);
  const wordings = asRecord(record?.wordings);
  return {
    key: stringValue(record?.key) ?? "",
    status: (stringValue(record?.status) as "COMPLETED" | "PENDING") ?? "PENDING",
    progress: numberValue(record?.progress) ?? 0,
    mode: (stringValue(record?.mode) as "OPPORTUNITY" | "WARNING") ?? "OPPORTUNITY",
    wordings: {
      title: stringValue(wordings?.title) ?? "",
      label: stringValue(wordings?.label) ?? "",
      link: stringValue(wordings?.link) ?? "",
    },
  };
}

function normalizeRelist(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
  itemId: string;
}): MlcRelistSnapshot {
  const record = asRecord(input.payload);
  const newItemId = stringValue(record?.id) ?? "";
  const parentItemId = stringValue(record?.parent_item_id) ?? input.itemId;
  const data: MlcRelistResult = {
    newItemId,
    parentItemId,
    title: stringValue(record?.title) ?? "",
    price: numberValue(record?.price) ?? 0,
    listingTypeId: stringValue(record?.listing_type_id) ?? "",
    status: stringValue(record?.status) ?? "",
  };
  const completeness = newItemId.length > 0 ? "complete" : "partial";
  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, newItemId.length > 0 ? 1 : 0),
  };
}

function normalizeImageDiagnostic(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcImageDiagnosticSnapshot {
  const record = asRecord(input.payload);
  const diagnosticId = stringValue(record?.id) ?? "";
  const diagList = asArray(record?.diagnostics);
  let complete = record !== undefined && diagnosticId.length > 0;

  const diagnostics: MlcImageDiagnosticResult[] = diagList.flatMap((d) => {
    const dr = asRecord(d);
    if (dr === undefined) {
      complete = false;
      return [];
    }
    const pictureType = stringValue(dr.picture_type) ?? "";
    const action = (stringValue(dr.action) as "diagnostic" | "empty") ?? "empty";
    const detections: MlcImageDetection[] = asArray(dr.detections).flatMap((det) => {
      const detRecord = asRecord(det);
      if (detRecord === undefined) return [];
      const name = stringValue(detRecord.name) ?? "";
      const wordings = asArray(detRecord.wordings).flatMap((w) => {
        const wr = asRecord(w);
        const kind = stringValue(wr?.kind) ?? "";
        const value = stringValue(wr?.value) ?? "";
        return kind ? [{ kind, value }] : [];
      });
      return name ? [{ name, wordings }] : [];
    });
    return [{ pictureType, action, detections }];
  });

  const hasIssues = diagnostics.some((d) => d.detections.length > 0);

  const data: MlcImageDiagnosticSummary = { diagnosticId, diagnostics, hasIssues };

  const completeness: MlcReadSnapshotCompleteness = complete ? "complete" : "partial";
  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, diagnostics.length),
  };
}

function normalizeImageUpload(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcImageUploadSnapshot {
  const record = asRecord(input.payload);
  const pictureId = stringValue(record?.id) ?? "";
  const variations: Array<{ size: string; url: string; secureUrl: string }> = asArray(
    record?.variations,
  ).flatMap((v) => {
    const vr = asRecord(v);
    const size = stringValue(vr?.size) ?? "";
    const url = stringValue(vr?.url) ?? "";
    const secureUrl = stringValue(vr?.secure_url) ?? "";
    return size ? [{ size, url, secureUrl }] : [];
  });
  const data: MlcImageUploadResult = { pictureId, variations };
  const completeness = pictureId.length > 0 ? "complete" : "partial";
  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, variations.length),
  };
}

function normalizeModerationStatus(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcModerationStatusSnapshot {
  const root = asRecord(input.payload);
  const moderations = asArray(root?.moderations ?? input.payload);
  const mod = asRecord(moderations[0]);

  const itemId = stringValue(mod?.id) ?? "";
  const blocked = booleanValue(mod?.blocked) ?? false;

  const wordings: MlcModerationStatusSummary["wordings"] = asArray(mod?.wordings).flatMap((w) => {
    const wr = asRecord(w);
    const kind = stringValue(wr?.kind);
    const value = stringValue(wr?.value);
    return kind !== undefined && value !== undefined ? [{ kind, value }] : [];
  });

  const evidence: MlcModerationStatusSummary["evidence"] = asArray(mod?.evidence).flatMap((e) => {
    const er = asRecord(e);
    if (er === undefined) return [];
    const item: { textMatched?: string; sectionName?: string } = {};
    pushOptional(item, "textMatched", stringValue(er.text_matched));
    pushOptional(item, "sectionName", stringValue(er.section_name));
    return Object.keys(item).length > 0 ? [item] : [];
  });

  const data: MlcModerationStatusSummary = { itemId, blocked, wordings, evidence };
  pushOptional(data, "date", stringValue(mod?.date));

  const completeness = itemId.length > 0 ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, wordings.length + evidence.length),
  };
}

function normalizeNotices(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcNoticesSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results);
  let complete = root !== undefined && Array.isArray(root.results);

  const notices: MlcNoticesSummary["notices"] = results.flatMap((item) => {
    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const actions: MlcNoticesSummary["notices"][number]["actions"] = asArray(
      record.actions,
    ).flatMap((a) => {
      const ar = asRecord(a);
      if (ar === undefined) return [];
      const action: { label?: string; url?: string } = {};
      pushOptional(action, "label", stringValue(ar.label));
      pushOptional(action, "url", stringValue(ar.url));
      return Object.keys(action).length > 0 ? [action] : [];
    });

    const notice: MlcNoticesSummary["notices"][number] = { id, actions };
    pushOptional(notice, "fromDate", stringValue(record.from_date));
    pushOptional(notice, "highlighted", booleanValue(record.highlighted));
    pushOptional(notice, "dismissKey", stringValue(record.dismiss_key));
    pushOptional(notice, "title", stringValue(record.title));

    const tags: ReadonlyArray<string> = asArray(record.tags).flatMap((t) => {
      const str = stringValue(t);
      return str !== undefined ? [str] : [];
    });
    if (tags.length > 0) notice.tags = tags;

    return [notice];
  });

  const pagingRecord = asRecord(root?.paging);
  const pagination: MlcNoticesSummary["pagination"] = {
    limit: numberValue(pagingRecord?.limit) ?? 0,
    offset: numberValue(pagingRecord?.offset) ?? 0,
  };
  pushOptional(pagination, "total", numberValue(pagingRecord?.total));

  const data: MlcNoticesSummary = { notices, pagination };
  pushOptional(data, "category", stringValue(root?.category));

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "message",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("message", input.now),
    confidence: snapshotConfidence(completeness, notices.length),
  };
}

function normalizeAnswer(input: {
  sellerId: string;
  questionId: string;
  text: string;
  now: Date;
}): MlcAnswerSnapshot {
  const textLength = input.text.length;
  const data: MlcAnswerSummary = {
    questionId: input.questionId,
    status: "pending",
    requiresApproval: true,
    noMutationExecuted: true,
    textLength,
  };

  return {
    sellerId: input.sellerId,
    kind: "message",
    source: "mercadolibre-api",
    data,
    completeness: "partial",
    freshness: createFreshness("message", input.now),
    confidence: "low",
  };
}

function normalizeClaimPlayers(players: ReadonlyArray<unknown>): ReadonlyArray<MlcClaimPlayer> {
  return players.flatMap((p) => {
    const pr = asRecord(p);
    if (pr === undefined) return [];
    const player: MlcClaimPlayer = {};
    pushOptional(player, "id", stringValue(pr.id));
    pushOptional(player, "role", stringValue(pr.role));
    pushOptional(player, "nickname", stringValue(pr.nickname));
    return Object.keys(player).length > 0 ? [player] : [];
  });
}

function normalizeSingleClaim(record: Readonly<Record<string, unknown>>): MlcClaimSummary {
  const claim: MlcClaimSummary = { id: stringValue(record.id) ?? "" };
  pushOptional(claim, "status", stringValue(record.status));
  pushOptional(claim, "type", stringValue(record.type));
  pushOptional(claim, "reasonId", stringValue(record.reason_id));
  pushOptional(claim, "stage", stringValue(record.stage));
  pushOptional(claim, "dateCreated", stringValue(record.date_created));
  pushOptional(claim, "lastUpdated", stringValue(record.last_updated));
  pushOptional(claim, "resource", stringValue(record.resource));
  pushOptional(claim, "resourceId", stringValue(record.resource_id));
  pushOptional(claim, "siteId", stringValue(record.site_id));

  const players = normalizeClaimPlayers(asArray(record.players));
  if (players.length > 0) claim.players = players;

  const resolutionRaw = asRecord(record.resolution);
  if (resolutionRaw) {
    const resolution: MlcClaimResolution = {};
    pushOptional(resolution, "id", stringValue(resolutionRaw.id));
    pushOptional(resolution, "status", stringValue(resolutionRaw.status));
    pushOptional(resolution, "reason", stringValue(resolutionRaw.reason));
    pushOptional(resolution, "description", stringValue(resolutionRaw.description));
    if (Object.keys(resolution).length > 0) claim.resolution = resolution;
  }

  return claim;
}

function normalizeClaimActions(
  actions: ReadonlyArray<unknown>,
): ReadonlyArray<MlcClaimPlayerAction> {
  return actions.flatMap((a) => {
    const ar = asRecord(a);
    if (ar === undefined) return [];
    const action: MlcClaimPlayerAction = {};
    pushOptional(action, "id", stringValue(ar.id));
    pushOptional(action, "status", stringValue(ar.status));
    pushOptional(action, "type", stringValue(ar.type));
    pushOptional(action, "created", stringValue(ar.created));
    pushOptional(action, "reason", stringValue(ar.reason));
    pushOptional(action, "description", stringValue(ar.description));
    return Object.keys(action).length > 0 ? [action] : [];
  });
}

function normalizeClaimMessageArray(
  messages: ReadonlyArray<unknown>,
): ReadonlyArray<MlcClaimMessage> {
  return messages.flatMap((m) => {
    const mr = asRecord(m);
    if (mr === undefined) return [];
    const msg: MlcClaimMessage = {};
    pushOptional(msg, "id", stringValue(mr.id));
    pushOptional(msg, "from", stringValue(mr.from));
    pushOptional(msg, "to", stringValue(mr.to));
    pushOptional(msg, "message", stringValue(mr.message));
    pushOptional(msg, "date_created", stringValue(mr.date_created));
    const atts = asArray(mr.attachments).flatMap((a) => {
      const s = stringValue(a);
      return s !== undefined ? [s] : [];
    });
    if (atts.length > 0) msg.attachments = atts;
    return Object.keys(msg).length > 0 ? [msg] : [];
  });
}

function normalizeClaimsSearch(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcClaimsSearchSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results);
  let complete = root !== undefined && Array.isArray(root.results);

  const claims = results.flatMap((item): MlcClaimSummary[] => {
    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }
    return [normalizeSingleClaim(record)];
  });

  const pagingRecord = asRecord(root?.paging);
  const paging: MlcClaimsSearchResult["paging"] = {
    total: numberValue(pagingRecord?.total) ?? 0,
    offset: numberValue(pagingRecord?.offset) ?? 0,
    limit: numberValue(pagingRecord?.limit) ?? 0,
  };

  const data: MlcClaimsSearchResult = { paging, results: claims };
  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: snapshotConfidence(completeness, claims.length),
  };
}

function normalizeClaimDetail(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcClaimDetailSnapshot {
  const root = asRecord(input.payload);
  let complete = root !== undefined;

  const claimRecord = asRecord(root?.claim);
  let claim: MlcClaimSummary;
  if (claimRecord) {
    claim = normalizeSingleClaim(claimRecord);
  } else {
    complete = false;
    claim = { id: "" };
  }

  const messages = normalizeClaimMessageArray(asArray(root?.messages));
  const players = normalizeClaimPlayers(asArray(root?.players));
  const availableActions = normalizeClaimActions(asArray(root?.available_actions));

  const data: MlcClaimDetailSummary = { claim };
  if (messages.length > 0) data.messages = messages;
  if (players.length > 0) data.players = players;
  if (availableActions.length > 0) data.availableActions = availableActions;

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: snapshotConfidence(completeness, claim.id.length > 0 ? 1 : 0),
  };
}

function normalizeClaimMessages(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcClaimMessagesSnapshot {
  const root = asRecord(input.payload);
  const messages = normalizeClaimMessageArray(
    Array.isArray(input.payload) ? input.payload : asArray(root?.messages ?? root),
  );
  const completeness = Array.isArray(input.payload) || root !== undefined ? "complete" : "partial";
  const data: MlcClaimMessagesSummary = { messages };

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: snapshotConfidence(completeness, messages.length),
  };
}

function normalizeClaimExpectedResolutions(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcClaimResolutionsSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.expected_resolutions ?? root?.results ?? root);
  let complete = root !== undefined;

  const expected_resolutions = results.flatMap((item) => {
    const record = asRecord(item);
    if (record === undefined) {
      complete = false;
      return [];
    }
    const resolution: MlcClaimResolutionsSummary["expected_resolutions"][number] = {};
    pushOptional(resolution, "id", stringValue(record.id));
    pushOptional(resolution, "status", stringValue(record.status));
    pushOptional(resolution, "reason", stringValue(record.reason));
    pushOptional(resolution, "description", stringValue(record.description));
    return [resolution];
  });

  const data: MlcClaimResolutionsSummary = { expected_resolutions };
  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: snapshotConfidence(completeness, expected_resolutions.length),
  };
}

function normalizeClaimAffectsReputation(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcClaimReputationSnapshot {
  const record = asRecord(input.payload);
  const affects_reputation =
    booleanValue(record?.affects_reputation ?? record?.affectsReputation) ?? false;
  const completeness = record !== undefined ? "complete" : "partial";

  const data: MlcClaimReputationSummary = { affects_reputation };
  pushOptional(data, "reason", stringValue(record?.reason));

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: completeness === "complete" ? "high" : "low",
  };
}

function normalizeClaimStatusHistory(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcClaimStatusHistorySnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.history ?? root);
  let complete = root !== undefined;

  const history = results.flatMap((item) => {
    const record = asRecord(item);
    if (record === undefined) {
      complete = false;
      return [];
    }
    const entry: MlcClaimStatusHistorySummary["history"][number] = {};
    pushOptional(entry, "status", stringValue(record.status));
    pushOptional(entry, "date", stringValue(record.date));
    return [entry];
  });

  const data: MlcClaimStatusHistorySummary = { history };
  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: snapshotConfidence(completeness, history.length),
  };
}

export function normalizeImageOrchestration(input: {
  sellerId: string;
  itemId: string;
  pictureUrl: string;
  categoryId: string;
  title?: string;
  now: Date;
}): MlcSingleReadSnapshot<MlcImageOrchestrationSummary> {
  const steps: ReadonlyArray<MlcImageOrchestrationStep> = [
    { step: "diagnose", status: "pending" },
    { step: "upload", status: "pending" },
    { step: "associate", status: "pending" },
    { step: "check", status: "pending" },
  ];

  const data: MlcImageOrchestrationSummary = {
    itemId: input.itemId,
    steps,
    requiresApproval: true,
    noMutationExecuted: true,
  };

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness: "complete",
    freshness: createFreshness("listing", input.now),
    confidence: "high",
  };
}

function normalizeShipmentStatus(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcShipmentStatusSnapshot {
  const record = asRecord(input.payload);
  let complete = record !== undefined;

  const id = stringValue(record?.id);
  if (record === undefined || id === undefined) {
    complete = false;
  }

  const data: MlcShipmentStatusSummary = { id: id ?? "" };
  pushOptional(data, "status", stringValue(record?.status));
  pushOptional(data, "substatus", stringValue(record?.substatus));
  pushOptional(data, "dateCreated", stringValue(record?.date_created));
  pushOptional(data, "lastUpdated", stringValue(record?.last_updated));
  pushOptional(data, "trackingNumber", stringValue(record?.tracking_number));
  pushOptional(data, "trackingMethod", stringValue(record?.tracking_method));
  pushOptional(data, "logisticType", stringValue(record?.logistic_type));
  pushOptional(data, "senderId", stringValue(record?.sender_id));
  pushOptional(data, "receiverId", stringValue(record?.receiver_id));
  pushOptional(data, "siteId", stringValue(record?.site_id));

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "business-signal",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("business-signal", input.now),
    confidence: snapshotConfidence(completeness, id !== undefined ? 1 : 0),
  };
}

export function assertCompleteMlcItem(payload: unknown): MlItem {
  const record = asRecord(payload);
  const id = normalizeMlcItemId(stringValue(record?.id) ?? "");
  const title = stringValue(record?.title);
  const price = numberValue(record?.price);
  const available_quantity = numberValue(record?.available_quantity);
  const category_id = stringValue(record?.category_id);
  const seller_id = numberValue(record?.seller_id);
  const status = stringValue(record?.status);

  if (
    !record ||
    !id ||
    !id ||
    !title ||
    price === undefined ||
    available_quantity === undefined ||
    !category_id ||
    seller_id === undefined ||
    (status !== "active" && status !== "paused" && status !== "closed")
  ) {
    throw new Error("Incomplete MercadoLibre item payload.");
  }

  return {
    id,
    title,
    price,
    available_quantity,
    category_id,
    seller_id,
    status,
    pictures: asArray(record?.pictures).flatMap((picture) => {
      const url = stringValue(asRecord(picture)?.url);
      return url === undefined ? [] : [{ url }];
    }),
    attributes: asArray(record?.attributes).flatMap((attribute) => {
      const attributeRecord = asRecord(attribute);
      const attributeId = stringValue(attributeRecord?.id);
      if (attributeId === undefined) return [];
      return [{ id: attributeId, value_name: stringValue(attributeRecord?.value_name) ?? "" }];
    }),
  };
}

function normalizeOrders(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcOrdersSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.orders);
  let complete = root !== undefined && Array.isArray(root.results ?? root.orders);

  const data = results.flatMap((item): MlcOrderSummary[] => {
    const record = asRecord(item);
    const id =
      stringValue(record?.id) ??
      (numberValue(record?.id) !== undefined ? String(record?.id) : undefined);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const buyer = asRecord(record.buyer);
    const buyerId =
      stringValue(buyer?.id) ??
      (numberValue(buyer?.id) !== undefined ? String(buyer?.id) : undefined);
    const summary: MlcOrderSummary = { id };
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "totalAmount", numberValue(record.total_amount));
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "createdAt", stringValue(record.date_created));
    pushOptional(summary, "buyerId", buyerId);

    if (summary.status === undefined || summary.totalAmount === undefined) {
      complete = false;
    }

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  const pagingRecord = asRecord(root?.paging);
  const paging: MlcOrdersSnapshot["paging"] = {
    total: numberValue(pagingRecord?.total) ?? 0,
    offset: numberValue(pagingRecord?.offset) ?? 0,
    limit: numberValue(pagingRecord?.limit) ?? 0,
  };

  return {
    sellerId: input.sellerId,
    kind: "order",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("order", input.now),
    confidence: snapshotConfidence(completeness, data.length),
    paging,
  };
}

function normalizeMessages(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcMessagesSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.messages);
  let complete = root !== undefined && Array.isArray(root.results ?? root.messages);

  const data = results.flatMap((item): MlcMessageSummary[] => {
    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const from = asRecord(record.from);
    const fromUserId =
      stringValue(from?.user_id) ??
      stringValue(from?.id) ??
      (numberValue(from?.user_id) !== undefined ? String(from?.user_id) : undefined) ??
      (numberValue(from?.id) !== undefined ? String(from?.id) : undefined);
    const summary: MlcMessageSummary = { id };
    pushOptional(summary, "subject", stringValue(record.subject) ?? stringValue(record.text));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "createdAt", stringValue(record.date_created));
    pushOptional(summary, "fromUserId", fromUserId);

    if (summary.subject === undefined && summary.status === undefined) {
      complete = false;
    }

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  const pagingRecord = asRecord(root?.paging);
  const paging: MlcMessagesSnapshot["paging"] = {
    total: numberValue(pagingRecord?.total) ?? 0,
    offset: numberValue(pagingRecord?.offset) ?? 0,
    limit: numberValue(pagingRecord?.limit) ?? 0,
  };

  return {
    sellerId: input.sellerId,
    kind: "message",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("message", input.now),
    confidence: snapshotConfidence(completeness, data.length),
    paging,
  };
}

function normalizeReputation(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcReputationSnapshot {
  const root = asRecord(input.payload);
  const reputation = asRecord(root?.seller_reputation);
  const transactions = asRecord(reputation?.transactions);
  const ratings = asRecord(transactions?.ratings);
  const data: MlcReputationSummary = {};

  pushOptional(data, "level", stringValue(reputation?.level_id));
  pushOptional(data, "powerSellerStatus", stringValue(reputation?.power_seller_status));
  pushOptional(data, "completedTransactions", numberValue(transactions?.completed));
  pushOptional(data, "canceledTransactions", numberValue(transactions?.canceled));
  pushOptional(data, "totalTransactions", numberValue(transactions?.total));
  pushOptional(data, "positiveRating", numberValue(ratings?.positive));
  pushOptional(data, "neutralRating", numberValue(ratings?.neutral));
  pushOptional(data, "negativeRating", numberValue(ratings?.negative));

  const metrics = asRecord(reputation?.metrics);
  const claims = asRecord(metrics?.claims);
  const cancellations = asRecord(metrics?.cancellations);
  const delayedHandlingTime = asRecord(metrics?.delayed_handling_time);
  pushOptional(data, "claimsRate", numberValue(claims?.rate));
  pushOptional(data, "cancellationsRate", numberValue(cancellations?.rate));
  pushOptional(data, "delayedHandlingTimeRate", numberValue(delayedHandlingTime?.rate));
  if (data.completedTransactions !== undefined) {
    data.metricPeriodDays =
      data.completedTransactions >= MLC_REPUTATION_RULES.establishedSellerCompletedTransactions
        ? MLC_REPUTATION_RULES.establishedSellerMetricPeriodDays
        : MLC_REPUTATION_RULES.newSellerMetricPeriodDays;
  }

  const completeness =
    root !== undefined &&
    reputation !== undefined &&
    transactions !== undefined &&
    data.level !== undefined
      ? "complete"
      : "partial";

  return {
    sellerId: input.sellerId,
    kind: "reputation",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("reputation", input.now),
    confidence: snapshotConfidence(completeness, Object.keys(data).length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

function attributeTags(
  record: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return asRecord(record.tags) ?? {};
}

function normalizeAttribute(
  record: Readonly<Record<string, unknown>>,
): MlcCategoryAttributeSummary | undefined {
  const id = stringValue(record.id);
  if (id === undefined) return undefined;

  const tags = attributeTags(record);
  const attribute: MlcCategoryAttributeSummary = {
    id,
    required: booleanValue(tags.required) ?? false,
    catalogRequired:
      booleanValue(tags.catalog_required) ?? booleanValue(tags.catalog_listing_required) ?? false,
    variationAttribute:
      booleanValue(tags.variation_attribute) ?? booleanValue(tags.allow_variations) ?? false,
    readOnly: booleanValue(tags.read_only) ?? false,
    values: asArray(record.values).flatMap((value) => {
      const valueRecord = asRecord(value);
      if (valueRecord === undefined) return [];
      const normalizedValue: { id?: string; name?: string } = {};
      pushOptional(normalizedValue, "id", stringValue(valueRecord.id));
      pushOptional(normalizedValue, "name", stringValue(valueRecord.name));
      return [normalizedValue];
    }),
    units: asArray(record.allowed_units ?? record.default_unit).flatMap((unit) => {
      const unitRecord = asRecord(unit);
      const name = stringValue(unitRecord?.name) ?? stringValue(unit);
      return name === undefined ? [] : [name];
    }),
  };
  pushOptional(attribute, "name", stringValue(record.name));
  pushOptional(attribute, "valueType", stringValue(record.value_type));

  return attribute;
}

function normalizeCategoryAttributes(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcCategoryAttributesSnapshot {
  const data = asArray(input.payload).flatMap((item): MlcCategoryAttributeSummary[] => {
    const record = asRecord(item);
    const attribute = record === undefined ? undefined : normalizeAttribute(record);
    return attribute === undefined ? [] : [attribute];
  });
  const completeness = Array.isArray(input.payload) ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "category-attributes",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("category-attributes", input.now),
    confidence: snapshotConfidence(completeness, data.length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

function extractTechnicalSpecAttributes(payload: unknown): {
  attributes: ReadonlyArray<unknown>;
  validShape: boolean;
} {
  const root = asRecord(payload);
  const rawGroups = root?.groups ?? asRecord(root?.input)?.groups;

  if (!Array.isArray(rawGroups)) {
    return { attributes: [], validShape: false };
  }

  const attributes = rawGroups.flatMap((group) => {
    const groupRecord = asRecord(group);
    const components = asArray(groupRecord?.components);
    return components.flatMap((component) => {
      const componentRecord = asRecord(component);
      return asArray(componentRecord?.attributes);
    });
  });

  return { attributes, validShape: true };
}

function normalizeCategoryTechnicalSpecs(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcCategoryTechnicalSpecsSnapshot {
  const extracted = extractTechnicalSpecAttributes(input.payload);
  const data = extracted.attributes.flatMap((item): MlcCategoryTechnicalSpecSummary[] => {
    const record = asRecord(item);
    if (record === undefined) return [];
    const attribute = normalizeAttribute(record);
    if (attribute === undefined) return [];
    const spec: MlcCategoryTechnicalSpecSummary = {
      id: attribute.id,
      required: attribute.required,
      catalogRequired: attribute.catalogRequired,
    };
    pushOptional(spec, "name", attribute.name);
    pushOptional(spec, "valueType", attribute.valueType);
    pushOptional(spec, "group", stringValue(record.hierarchy));
    return [spec];
  });
  const completeness = extracted.validShape ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "category-technical-specs",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("category-technical-specs", input.now),
    confidence: snapshotConfidence(completeness, data.length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

function findProductAdsAdvertiser(payload: unknown): { id: string; siteId: string } {
  const root = asRecord(payload);
  const candidates = asArray(root?.results ?? root?.advertisers ?? payload);
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const id = numericStringValue(record?.advertiser_id ?? record?.id);
    const siteId = stringValue(record?.site_id ?? record?.siteId ?? record?.advertiser_site_id);
    if (record !== undefined && id !== undefined && siteId !== undefined) {
      return { id, siteId };
    }
  }

  throw new Error("Product Ads advertiser is not available for this seller.");
}

function normalizeProductAdsEntities(
  payload: unknown,
  kind: "campaigns" | "ads",
): {
  data: MlcProductAdsEntitySummary[];
  complete: boolean;
} {
  const root = asRecord(payload);
  const results = asArray(root?.results ?? root?.[kind]);
  let complete = root !== undefined && Array.isArray(root.results ?? root[kind]);
  const data = results.flatMap((item): MlcProductAdsEntitySummary[] => {
    const record = asRecord(item);
    const id = numericStringValue(record?.id ?? record?.ad_id ?? record?.campaign_id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }
    const entity: MlcProductAdsEntitySummary = { id };
    pushOptional(entity, "name", stringValue(record.name));
    pushOptional(entity, "itemId", stringValue(record.item_id));
    pushOptional(entity, "campaignId", numericStringValue(record.campaign_id));
    pushOptional(entity, "status", stringValue(record.status));
    pushOptional(entity, "metrics", productAdsMetrics(record));
    return [entity];
  });
  return { data, complete };
}

function normalizeProductAdsInsights(input: {
  sellerId: string;
  advertiser: { id: string; siteId: string };
  campaignsPayload: unknown;
  adsPayload: unknown;
  options: MlcProductAdsInsightsOptions;
  now: Date;
}): MlcProductAdsInsightsSnapshot {
  const campaigns = normalizeProductAdsEntities(input.campaignsPayload, "campaigns");
  const ads = normalizeProductAdsEntities(input.adsPayload, "ads");
  const completeness = campaigns.complete && ads.complete ? "complete" : "partial";
  const data: MlcProductAdsInsights = {
    advertiser: { id: input.advertiser.id, siteId: input.advertiser.siteId, productId: "PADS" },
    campaigns: campaigns.data,
    ads: ads.data,
    noMutationExecuted: true,
    performanceMetric: "roas",
    transitionalMetrics: { acosTargetDeprecatedAfter: "2026-03-30" },
  };
  pushOptional(data, "dateFrom", input.options.dateFrom);
  pushOptional(data, "dateTo", input.options.dateTo);

  return {
    sellerId: input.sellerId,
    kind: "product-ads-insights",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("product-ads-insights", input.now),
    confidence: snapshotConfidence(completeness, campaigns.data.length + ads.data.length),
    siteSupport: MLC_CONFIRMED_SITE_SUPPORT,
    sellerScope: sellerScope(input.sellerId),
  };
}

function normalizeListingPrices(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcListingPricesSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.listing_prices ?? input.payload);
  let complete =
    Array.isArray(input.payload) || Array.isArray(root?.results ?? root?.listing_prices);
  const data = results.flatMap((item): MlcListingPriceSummary[] => {
    const record = asRecord(item);
    if (record === undefined) {
      complete = false;
      return [];
    }
    const saleFeeDetails = normalizeSaleFeeDetails(asRecord(record.sale_fee_details));
    const summary: MlcListingPriceSummary = { saleFeeDetails };
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "listingTypeId", stringValue(record.listing_type_id));
    pushOptional(summary, "listingTypeName", stringValue(record.listing_type_name));
    pushOptional(summary, "saleFeeAmount", numberValue(record.sale_fee_amount));
    if (summary.saleFeeAmount === undefined) complete = false;
    return [summary];
  });
  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing-prices",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing-prices", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeItemSalePrice(input: {
  sellerId: string;
  itemId: string;
  payload: unknown;
  now: Date;
}): MlcItemSalePriceSnapshot {
  const record = asRecord(input.payload);
  const metadataRecord = asRecord(record?.metadata);
  const metadata: MlcItemSalePriceSummary["metadata"] = {};
  pushOptional(metadata, "campaignId", stringValue(metadataRecord?.campaign_id));
  pushOptional(metadata, "promotionId", stringValue(metadataRecord?.promotion_id));
  pushOptional(metadata, "promotionType", stringValue(metadataRecord?.promotion_type));
  const data: MlcItemSalePriceSummary = { itemId: input.itemId };
  pushOptional(data, "amount", numberValue(record?.amount));
  pushOptional(data, "currencyId", stringValue(record?.currency_id));
  pushOptional(data, "regularAmount", numberValue(record?.regular_amount));
  pushOptional(data, "type", stringValue(record?.type));
  if (Object.keys(metadata).length > 0) data.metadata = metadata;
  const completeness = record !== undefined && data.amount !== undefined ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.amount !== undefined ? 1 : 0),
  };
}

function normalizeItemPrices(input: {
  sellerId: string;
  itemId: string;
  payload: unknown;
  now: Date;
}): MlcItemPricesSnapshot {
  const root = asRecord(input.payload);
  const prices = asArray(root?.prices ?? root?.results ?? input.payload).flatMap((raw) => {
    const record = asRecord(raw);
    if (record === undefined) return [];
    const price: MlcItemPricesSummary["prices"][number] = {};
    pushOptional(price, "id", stringValue(record.id));
    pushOptional(price, "type", stringValue(record.type));
    pushOptional(price, "amount", numberValue(record.amount));
    pushOptional(price, "regularAmount", numberValue(record.regular_amount));
    pushOptional(price, "currencyId", stringValue(record.currency_id));
    const conditionRecord = asRecord(record.conditions);
    const conditions: MlcItemPriceConditionsSummary = {};
    const contextRestrictions = asArray(conditionRecord?.context_restrictions).flatMap((entry) => {
      const value = stringValue(entry);
      return value === undefined ? [] : [value];
    });
    if (contextRestrictions.length > 0) conditions.contextRestrictions = contextRestrictions;
    pushOptional(conditions, "startTime", stringValue(conditionRecord?.start_time));
    pushOptional(conditions, "endTime", stringValue(conditionRecord?.end_time));
    pushOptional(conditions, "eligible", booleanValue(conditionRecord?.eligible));
    if (Object.keys(conditions).length > 0) price.conditions = conditions;
    return [price];
  });
  const completeness = root !== undefined && prices.length > 0 ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: { itemId: input.itemId, prices },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, prices.length),
  };
}

function normalizePriceToWin(input: {
  sellerId: string;
  itemId: string;
  payload: unknown;
  now: Date;
}): MlcPriceToWinSnapshot {
  const record = asRecord(input.payload);
  const boosts = asArray(record?.boosts).flatMap((boost) => {
    const boostRecord = asRecord(boost);
    if (boostRecord === undefined) return [];
    const summary: MlcPriceToWinBoostSummary = {};
    pushOptional(summary, "id", stringValue(boostRecord.id));
    pushOptional(summary, "type", stringValue(boostRecord.type));
    pushOptional(summary, "status", stringValue(boostRecord.status));
    pushOptional(summary, "value", numberValue(boostRecord.value));
    return Object.keys(summary).length > 0 ? [summary] : [];
  });
  const data: MlcPriceToWinSummary = { itemId: input.itemId, boosts };
  pushOptional(data, "currentPrice", numberValue(record?.current_price));
  pushOptional(data, "priceToWin", numberValue(record?.price_to_win));
  pushOptional(data, "status", stringValue(record?.status));
  pushOptional(data, "reason", stringValue(record?.reason));
  pushOptional(data, "visitShare", stringValue(record?.visit_share));
  pushOptional(data, "catalogProductId", stringValue(record?.catalog_product_id));
  const winnerRecord = asRecord(record?.winner);
  const winner: MlcPriceToWinWinnerSummary = {};
  pushOptional(winner, "itemId", stringValue(winnerRecord?.item_id));
  pushOptional(winner, "price", numberValue(winnerRecord?.price));
  pushOptional(winner, "currencyId", stringValue(winnerRecord?.currency_id));
  if (Object.keys(winner).length > 0) data.winner = winner;
  const completeness = record !== undefined && data.status !== undefined ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.status !== undefined ? 1 : 0),
  };
}

function normalizePricingAutomation(input: {
  sellerId: string;
  itemId: string;
  payload: unknown;
  now: Date;
}): MlcPricingAutomationSnapshot {
  const record = asRecord(input.payload);
  const itemRule = asRecord(record?.item_rule) ?? asRecord(record?.itemRule);
  const status = stringValue(record?.status);
  const active = booleanValue(record?.active) ?? status?.toLowerCase() === "active";
  const data: MlcPricingAutomationSummary = { itemId: input.itemId, active };
  pushOptional(data, "status", status);
  pushOptional(
    data,
    "ruleId",
    stringValue(itemRule?.rule_id) ??
      stringValue(itemRule?.ruleId) ??
      stringValue(record?.rule_id) ??
      stringValue(record?.ruleId),
  );
  pushOptional(
    data,
    "minPrice",
    numberValue(itemRule?.min_price) ??
      numberValue(itemRule?.minPrice) ??
      numberValue(record?.min_price) ??
      numberValue(record?.minPrice),
  );
  pushOptional(
    data,
    "maxPrice",
    numberValue(itemRule?.max_price) ??
      numberValue(itemRule?.maxPrice) ??
      numberValue(record?.max_price) ??
      numberValue(record?.maxPrice),
  );
  const completeness = record !== undefined ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, record !== undefined ? 1 : 0),
  };
}

function normalizePricingAutomationRules(input: {
  sellerId: string;
  targetType: "item" | "product";
  targetId: string;
  payload: unknown;
  now: Date;
}): MlcPricingAutomationRulesSnapshot {
  const record = asRecord(input.payload);
  const rules = asArray(record?.rules).flatMap((raw) => {
    const ruleRecord = asRecord(raw);
    const ruleId = stringValue(ruleRecord?.rule_id) ?? stringValue(ruleRecord?.ruleId);
    return ruleId === undefined ? [] : [{ ruleId }];
  });
  const responseTargetId =
    input.targetType === "item"
      ? (stringValue(record?.item_id) ?? stringValue(record?.itemId))
      : (stringValue(record?.product_id) ?? stringValue(record?.productId));
  const completeness = record !== undefined && rules.length > 0 ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: {
      targetType: input.targetType,
      targetId: responseTargetId ?? input.targetId,
      rules,
    },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, rules.length),
  };
}

function normalizePricingAutomationPriceHistory(input: {
  sellerId: string;
  itemId: string;
  payload: unknown;
  now: Date;
  options: { days: number; page: number; size: number };
}): MlcPricingAutomationHistorySnapshot {
  const root = asRecord(input.payload);
  const result = asRecord(root?.result);
  const pageableRecord = asRecord(result?.pageable);
  const content = asArray(result?.content).flatMap((raw) => {
    const record = asRecord(raw);
    if (record === undefined) return [];
    const entry: MlcPricingAutomationHistorySummary["content"][number] = {};
    pushOptional(entry, "dateTime", stringValue(record.date_time));
    pushOptional(entry, "percentChange", numberValue(record.percent_change));
    pushOptional(entry, "usdPrice", numberValue(record.usd_price));
    pushOptional(entry, "price", numberValue(record.price));
    pushOptional(entry, "event", stringValue(record.event));
    pushOptional(entry, "strategyType", stringValue(record.strategy_type));
    return Object.keys(entry).length > 0 ? [entry] : [];
  });
  const pageNumber = numberValue(pageableRecord?.page_number) ?? input.options.page;
  const pageSize = numberValue(pageableRecord?.page_size) ?? input.options.size;
  const pageable: MlcPricingAutomationHistorySummary["pageable"] = { pageNumber, pageSize };
  pushOptional(pageable, "offset", numberValue(pageableRecord?.offset));
  const data: MlcPricingAutomationHistorySummary = { itemId: input.itemId, content, pageable };
  pushOptional(data, "resultCode", numberValue(root?.result_code));
  pushOptional(data, "resultMessage", stringValue(root?.result_message));
  pushOptional(data, "totalElements", numberValue(result?.total_elements));
  pushOptional(data, "totalPages", numberValue(result?.total_pages));
  pushOptional(data, "size", numberValue(result?.size));
  pushOptional(data, "numberOfElements", numberValue(result?.number_of_elements));
  pushOptional(data, "empty", booleanValue(result?.empty));
  const completeness = root !== undefined && result !== undefined ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, content.length),
  };
}

function normalizeAutomatedPriceItems(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
  options: { offset: number; limit: number };
}): MlcAutomatedPriceItemsSnapshot {
  const root = asRecord(input.payload);
  const pagingRecord = asRecord(root?.paging) ?? root;
  const items = asArray(root?.results ?? root?.items).flatMap((raw) => {
    const stringItemId = stringValue(raw);
    if (stringItemId !== undefined) return [{ itemId: stringItemId }];

    const record = asRecord(raw);
    const itemId =
      stringValue(record?.item_id) ?? stringValue(record?.itemId) ?? stringValue(record?.id);
    if (record === undefined || itemId === undefined) return [];
    const summary: MlcAutomatedPriceItemsSummary["items"][number] = { itemId };
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "ruleId", stringValue(record.rule_id) ?? stringValue(record.ruleId));
    pushOptional(
      summary,
      "minPrice",
      numberValue(record.min_price) ?? numberValue(record.minPrice),
    );
    pushOptional(
      summary,
      "maxPrice",
      numberValue(record.max_price) ?? numberValue(record.maxPrice),
    );
    return [summary];
  });
  const paging: MlcAutomatedPriceItemsSummary["paging"] = {
    offset: numberValue(pagingRecord?.offset) ?? input.options.offset,
    limit: numberValue(pagingRecord?.limit) ?? input.options.limit,
  };
  pushOptional(paging, "total", numberValue(pagingRecord?.total));
  const completeness =
    root !== undefined && Array.isArray(root.results ?? root.items) ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: { paging, items },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, items.length),
  };
}

function assertPromotionId(promotionId: string): string {
  const trimmed = promotionId.trim();
  if (!/^[A-Z]+-ML[A-Z]\d+$/.test(trimmed)) {
    throw new Error(
      "Only documented MercadoLibre promotion IDs are supported for promotion reads.",
    );
  }

  return trimmed;
}

function assertPromotionType(promotionType: string): string {
  const trimmed = promotionType.trim();
  if (!/^[A-Z_]+$/.test(trimmed)) {
    throw new Error("Promotion type must use the documented uppercase MercadoLibre format.");
  }

  return trimmed;
}

function normalizePromotionBenefits(
  record: Readonly<Record<string, unknown>> | undefined,
): MlcPromotionBenefitsSummary | undefined {
  const benefits: MlcPromotionBenefitsSummary = {};
  pushOptional(benefits, "type", stringValue(record?.type));
  pushOptional(benefits, "meliPercent", numberValue(record?.meli_percent));
  pushOptional(benefits, "sellerPercent", numberValue(record?.seller_percent));
  return Object.keys(benefits).length > 0 ? benefits : undefined;
}

function normalizePromotionSummary(raw: unknown): MlcPromotionSummary | undefined {
  const record = asRecord(raw);
  const id = stringValue(record?.id);
  const type = stringValue(record?.type);
  if (record === undefined || id === undefined || type === undefined) return undefined;
  const summary: MlcPromotionSummary = { id, type };
  pushOptional(summary, "status", stringValue(record.status));
  pushOptional(summary, "startDate", stringValue(record.start_date));
  pushOptional(summary, "finishDate", stringValue(record.finish_date));
  pushOptional(summary, "deadlineDate", stringValue(record.deadline_date));
  pushOptional(summary, "name", stringValue(record.name));
  pushOptional(summary, "benefits", normalizePromotionBenefits(asRecord(record.benefits)));
  pushOptional(summary, "subType", stringValue(record.sub_type));
  pushOptional(summary, "allowCombination", booleanValue(record.allow_combination));
  pushOptional(summary, "fixedAmount", numberValue(record.fixed_amount));
  pushOptional(summary, "fixedPercentage", numberValue(record.fixed_percentage));
  pushOptional(summary, "minPurchaseAmount", numberValue(record.min_purchase_amount));
  pushOptional(summary, "maxPurchaseAmount", numberValue(record.max_purchase_amount));
  pushOptional(summary, "couponCode", stringValue(record.coupon_code));
  pushOptional(summary, "redeemsPerUser", numberValue(record.redeems_per_user));
  pushOptional(summary, "budget", numberValue(record.budget));
  pushOptional(summary, "remainingBudget", numberValue(record.remaining_budget));
  pushOptional(summary, "usedCoupons", numberValue(record.used_coupons));
  const rawOffers = asArray(record.offers);
  if (rawOffers.length > 0) {
    const offers: MlcPromotionSummary["offers"] extends ReadonlyArray<infer T> | undefined
      ? T[]
      : never = [];
    for (const o of rawOffers) {
      const offer = asRecord(o);
      if (offer === undefined) continue;
      const normalized = {} as (typeof offers)[number];
      pushOptional(normalized, "id", stringValue(offer.id) ?? "");
      pushOptional(normalized, "originalPrice", numberValue(offer.original_price));
      pushOptional(normalized, "newPrice", numberValue(offer.new_price));
      pushOptional(normalized, "status", stringValue(offer.status));
      pushOptional(normalized, "startDate", stringValue(offer.start_date));
      pushOptional(normalized, "endDate", stringValue(offer.end_date));
      pushOptional(normalized, "benefits", normalizePromotionBenefits(asRecord(offer.benefits)));
      offers.push(normalized);
    }
    if (offers.length > 0) summary.offers = offers;
  }
  return summary;
}

function normalizeSellerPromotions(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcSellerPromotionsSnapshot {
  const root = asRecord(input.payload);
  const pagingRecord = asRecord(root?.paging);
  const promotions = asArray(root?.results).flatMap((raw) => {
    const promotion = normalizePromotionSummary(raw);
    return promotion === undefined ? [] : [promotion];
  });
  const paging: MlcSellerPromotionsSummary["paging"] = {
    offset: numberValue(pagingRecord?.offset) ?? 0,
    limit: numberValue(pagingRecord?.limit) ?? MLC_PROMOTIONS_ITEMS_DEFAULT_LIMIT,
  };
  pushOptional(paging, "total", numberValue(pagingRecord?.total));
  const completeness = root !== undefined && Array.isArray(root.results) ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: { paging, promotions },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, promotions.length),
  };
}

function normalizePromotionDetail(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcPromotionDetailSnapshot {
  const promotion = normalizePromotionSummary(input.payload);
  const completeness = promotion !== undefined ? "complete" : "partial";
  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: promotion ?? { id: "unknown", type: "unknown" },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, promotion !== undefined ? 1 : 0),
  };
}

function normalizePromotionItems(input: {
  sellerId: string;
  promotionId: string;
  promotionType: string;
  payload: unknown;
  now: Date;
  options: { limit: number };
}): MlcPromotionItemsSnapshot {
  const root = asRecord(input.payload);
  const pagingRecord = asRecord(root?.paging);
  const items = asArray(root?.results).flatMap((raw) => {
    const record = asRecord(raw);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) return [];
    const item: MlcPromotionParticipantSummary = { id };
    pushOptional(item, "status", stringValue(record.status));
    pushOptional(item, "statusItem", stringValue(record.status_item));
    pushOptional(item, "price", numberValue(record.price));
    pushOptional(item, "originalPrice", numberValue(record.original_price));
    pushOptional(item, "startDate", stringValue(record.start_date));
    pushOptional(item, "endDate", stringValue(record.end_date));
    pushOptional(item, "subType", stringValue(record.sub_type));
    pushOptional(item, "offerId", stringValue(record.offer_id));
    pushOptional(item, "meliPercentage", numberValue(record.meli_percentage));
    pushOptional(item, "sellerPercentage", numberValue(record.seller_percentage));
    pushOptional(item, "currencyId", stringValue(record.currency_id));
    pushOptional(item, "maxDiscountedPrice", numberValue(record.max_discounted_price));
    pushOptional(item, "minDiscountedPrice", numberValue(record.min_discounted_price));
    pushOptional(item, "suggestedDiscountedPrice", numberValue(record.suggested_discounted_price));
    pushOptional(item, "fixedAmount", numberValue(record.fixed_amount));
    pushOptional(item, "fixedPercentage", numberValue(record.fixed_percentage));
    const netProceeds = asRecord(record.net_proceeds);
    if (netProceeds !== undefined) {
      const topAmount = numberValue(netProceeds.amount);
      const topCurrency = stringValue(netProceeds.currency);
      if (topAmount !== undefined || topCurrency !== undefined) {
        // Flat shape: { amount, currency }
        const flat: { amount?: number; currency?: string } = {};
        pushOptional(flat, "amount", topAmount);
        pushOptional(flat, "currency", topCurrency);
        item.netProceeds = flat;
      } else {
        // Nested shape: { suggested_discounted_price, max_discounted_price, min_discounted_price }
        const suggested = asRecord(netProceeds.suggested_discounted_price);
        const max = asRecord(netProceeds.max_discounted_price);
        const min = asRecord(netProceeds.min_discounted_price);
        if (suggested !== undefined || max !== undefined || min !== undefined) {
          const nested: {
            suggestedDiscountedPrice?: { amount?: number; currency?: string };
            maxDiscountedPrice?: { amount?: number; currency?: string };
            minDiscountedPrice?: { amount?: number; currency?: string };
          } = {};
          if (suggested !== undefined) {
            nested.suggestedDiscountedPrice = {};
            pushOptional(nested.suggestedDiscountedPrice, "amount", numberValue(suggested.amount));
            pushOptional(
              nested.suggestedDiscountedPrice,
              "currency",
              stringValue(suggested.currency),
            );
          }
          if (max !== undefined) {
            nested.maxDiscountedPrice = {};
            pushOptional(nested.maxDiscountedPrice, "amount", numberValue(max.amount));
            pushOptional(nested.maxDiscountedPrice, "currency", stringValue(max.currency));
          }
          if (min !== undefined) {
            nested.minDiscountedPrice = {};
            pushOptional(nested.minDiscountedPrice, "amount", numberValue(min.amount));
            pushOptional(nested.minDiscountedPrice, "currency", stringValue(min.currency));
          }
          item.netProceeds = nested;
        }
      }
    }
    return [item];
  });
  const paging: MlcPromotionItemsSummary["paging"] = {
    limit: numberValue(pagingRecord?.limit) ?? input.options.limit,
  };
  pushOptional(
    paging,
    "searchAfter",
    stringValue(pagingRecord?.search_after) ?? stringValue(pagingRecord?.searchAfter),
  );
  pushOptional(paging, "total", numberValue(pagingRecord?.total));
  const completeness = root !== undefined && Array.isArray(root.results) ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: { promotionId: input.promotionId, promotionType: input.promotionType, paging, items },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, items.length),
  };
}

function normalizeItemPromotions(input: {
  sellerId: string;
  itemId: string;
  payload: unknown;
  now: Date;
}): MlcItemPromotionsSnapshot {
  const promotions = asArray(input.payload).flatMap((raw) => {
    const record = asRecord(raw);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) return [];
    const promotion: MlcItemPromotionSummary = { id };
    pushOptional(promotion, "type", stringValue(record.type));
    pushOptional(promotion, "refId", stringValue(record.ref_id));
    pushOptional(promotion, "status", stringValue(record.status));
    pushOptional(promotion, "price", numberValue(record.price));
    pushOptional(promotion, "originalPrice", numberValue(record.original_price));
    pushOptional(promotion, "name", stringValue(record.name));
    pushOptional(promotion, "minDiscountedPrice", numberValue(record.min_discounted_price));
    pushOptional(promotion, "maxDiscountedPrice", numberValue(record.max_discounted_price));
    pushOptional(
      promotion,
      "suggestedDiscountedPrice",
      numberValue(record.suggested_discounted_price),
    );
    pushOptional(promotion, "meliPercentage", numberValue(record.meli_percentage));
    pushOptional(promotion, "sellerPercentage", numberValue(record.seller_percentage));
    pushOptional(promotion, "startDate", stringValue(record.start_date));
    pushOptional(promotion, "finishDate", stringValue(record.finish_date));
    pushOptional(promotion, "topPrice", numberValue(record.top_price));
    pushOptional(promotion, "topDealPrice", numberValue(record.top_deal_price));
    const stockRecord = asRecord(record.stock);
    const stock: MlcItemPromotionStockSummary = {};
    pushOptional(stock, "remainingStock", numberValue(stockRecord?.remaining_stock));
    if (Object.keys(stock).length > 0) promotion.stock = stock;
    pushOptional(promotion, "boostedOffer", booleanValue(record.boosted_offer));
    pushOptional(
      promotion,
      "discountMeliBoostedPercentage",
      numberValue(record.discount_meli_boosted_percentage),
    );
    pushOptional(
      promotion,
      "discountMeliBoostAmount",
      numberValue(record.discount_meli_boost_amount),
    );
    pushOptional(
      promotion,
      "totalPriceForBoostedOffer",
      numberValue(record.total_price_for_boosted_offer),
    );
    return [promotion];
  });
  const completeness = Array.isArray(input.payload) ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data: { itemId: input.itemId, promotions },
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, promotions.length),
  };
}

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
      const query: Record<string, string> = { site: "MLC" };
      if (options?.status) query.status = options.status;
      if (options?.listingTypeId) query.listing_type_id = options.listingTypeId;
      const payload = await input.request(sellerId, `/users/${sellerId}/items/search`, query);
      const filters: { status?: "active" | "paused" | "closed"; listingTypeId?: string } = {};
      pushOptional(filters, "status", options?.status);
      pushOptional(filters, "listingTypeId", options?.listingTypeId);
      const hasFilters = filters.status !== undefined || filters.listingTypeId !== undefined;
      return normalizeListings({
        sellerId,
        payload,
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
      const query: Record<string, string> = { seller: sellerId, site: "MLC" };
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      const payload = await input.request(sellerId, "/orders/search", query);
      return normalizeOrders({ sellerId, payload, now: input.now() });
    },
    getMessages: async (sellerId, options) => {
      const query: Record<string, string> = { seller: sellerId, site: "MLC" };
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      const payload = await input.request(sellerId, "/messages/search", query);
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
      const query: Record<string, string> = {};
      if (options?.limit !== undefined) query.limit = String(options.limit);
      if (options?.offset !== undefined) query.offset = String(options.offset);
      if (options?.status !== undefined) query.status = options.status;
      if (options?.sort !== undefined) query.sort = options.sort;
      const payload = await input.request(
        sellerId,
        "/post-purchase/v1/claims/search",
        Object.keys(query).length > 0 ? query : undefined,
      );
      return normalizeClaimsSearch({ sellerId, payload, now: input.now() });
    },
    getClaimDetail: async (sellerId, claimId) => {
      const payload = await input.request(sellerId, `/post-purchase/v1/claims/${claimId}`);
      return normalizeClaimDetail({ sellerId, payload, now: input.now() });
    },
    getShipmentStatus: async (sellerId, shipmentId) => {
      const payload = await input.request(
        sellerId,
        `/marketplace/shipments/${shipmentId}`,
        undefined,
        { "x-format-new": "true" },
      );
      return normalizeShipmentStatus({ sellerId, payload, now: input.now() });
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
        `/post-purchase/v1/claims/${claimId}/affects_reputation`,
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

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Fetch with exponential backoff + jitter for ML API rate limiting.
 *
 * Retries on HTTP 429 (rate-limited) and 5xx (server errors), with
 * capped exponential delay plus uniform random jitter to avoid
 * thundering-herd retry storms.  Network errors (connection refused,
 * DNS failure) are also retried.
 */
async function fetchWithBackoff(url: string, init: RequestInit): Promise<Response> {
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

      if (!shouldRetry(response.status) || attempt === MAX_RETRIES) {
        return response;
      }

      // Will retry on 429 or 5xx
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

      const response = await fetchWithBackoff(url, init);

      if (!response.ok) {
        throw new Error(
          `ML API ${request.method} ${request.path} failed: ${response.status} ${response.statusText}`,
        );
      }

      return response.json();
    },
  };
}

// ---------------------------------------------------------------------------
// New normalization functions for write operations, categories, user info
// ---------------------------------------------------------------------------

function normalizeItems(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcListingsSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.items);
  let complete = root !== undefined && Array.isArray(root?.results ?? root?.items);

  const data = results.flatMap((item): MlcListingSummary[] => {
    if (typeof item === "string") {
      complete = false;
      return [{ id: item }];
    }

    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const summary: MlcListingSummary = { id };
    pushOptional(summary, "title", stringValue(record.title));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "availableQuantity", numberValue(record.available_quantity));
    pushOptional(summary, "price", numberValue(record.price));
    pushOptional(summary, "currencyId", stringValue(record.currency_id));
    pushOptional(summary, "permalink", stringValue(record.permalink));
    pushOptional(summary, "categoryId", stringValue(record.category_id));
    pushOptional(summary, "listingTypeId", stringValue(record.listing_type_id));

    return [summary];
  });

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "listing",
    source: "mercadolibre-api",
    data,
    completeness,
    freshness: createFreshness("listing", input.now),
    confidence: snapshotConfidence(completeness, data.length),
  };
}

function normalizeWriteResponse(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlWriteSnapshot {
  const record = asRecord(input.payload);
  const id = stringValue(record?.id) ?? "unknown";
  const permalink = stringValue(record?.permalink) ?? "";
  const status = stringValue(record?.status) ?? "active";

  return {
    id,
    permalink,
    status,
    capturedAt: input.now.toISOString(),
  };
}

function normalizeCategories(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlCategoriesSnapshot {
  const data: MlCategory[] = [];

  if (Array.isArray(input.payload)) {
    for (const item of input.payload) {
      const record = asRecord(item);
      if (!record) continue;

      const id = stringValue(record.id);
      if (!id) continue;

      const category: MlCategory = {
        id,
        name: stringValue(record.name) ?? "",
      };

      const pathFromRoot = asArray(record.path_from_root);
      if (pathFromRoot.length > 0) {
        category.path_from_root = pathFromRoot.flatMap((p) => {
          const pr = asRecord(p);
          const pid = stringValue(pr?.id);
          if (!pr || !pid) return [];
          return [{ id: pid, name: stringValue(pr.name) ?? "" }];
        });
      }

      const children = asArray(record.children_categories);
      if (children.length > 0) {
        category.children_categories = children.flatMap((c) => {
          const cr = asRecord(c);
          const cid = stringValue(cr?.id);
          if (!cr || !cid) return [];
          return [{ id: cid, name: stringValue(cr.name) ?? "" }];
        });
      }

      data.push(category);
    }
  }

  return {
    sellerId: input.sellerId,
    data,
    capturedAt: input.now.toISOString(),
  };
}

function normalizeUser(input: { sellerId: string; payload: unknown; now: Date }): MlUserSnapshot {
  const record = asRecord(input.payload);
  const data: MlUserInfo = {
    id: numberValue(record?.id) ?? 0,
    nickname: stringValue(record?.nickname) ?? "",
    points: numberValue(record?.points) ?? 0,
    level: stringValue(record?.level_id) ?? stringValue(record?.seller_experience) ?? "",
    status: stringValue(asRecord(record?.status)?.site_status) ?? "",
  };

  return {
    sellerId: input.sellerId,
    data,
    capturedAt: input.now.toISOString(),
  };
}

function normalizeQuestions(input: {
  sellerId: string;
  payload: unknown;
  now: Date;
}): MlcQuestionsSnapshot {
  const root = asRecord(input.payload);
  const results = asArray(root?.results ?? root?.questions);
  let complete = root !== undefined && Array.isArray(root.results ?? root.questions);

  const questions = results.flatMap((item): MlcQuestionSummary[] => {
    const record = asRecord(item);
    const id = stringValue(record?.id);
    if (record === undefined || id === undefined) {
      complete = false;
      return [];
    }

    const answer = asRecord(record.answer);
    const summary: MlcQuestionSummary = { id };
    pushOptional(summary, "text", stringValue(record.text));
    pushOptional(summary, "answerText", stringValue(answer?.text));
    pushOptional(summary, "status", stringValue(record.status));
    pushOptional(summary, "dateCreated", stringValue(record.date_created));
    pushOptional(summary, "itemId", stringValue(record.item_id));

    return [summary];
  });

  // /questions/search returns top-level pagination fields (total, limit, offset)
  // or nested under paging — handle both shapes.
  const pagingRecord = asRecord(root?.paging);
  const paging: MlcQuestionsSearchResult["paging"] = {
    total: numberValue(root?.total) ?? numberValue(pagingRecord?.total) ?? questions.length,
    offset: numberValue(root?.offset) ?? numberValue(pagingRecord?.offset) ?? 0,
    limit: numberValue(root?.limit) ?? numberValue(pagingRecord?.limit) ?? questions.length,
  };

  const searchResult: MlcQuestionsSearchResult = { paging, results: questions };

  const completeness = complete ? "complete" : "partial";

  return {
    sellerId: input.sellerId,
    kind: "message",
    source: "mercadolibre-api",
    data: searchResult,
    completeness,
    freshness: createFreshness("message", input.now),
    confidence: snapshotConfidence(completeness, questions.length),
  };
}

// ---------------------------------------------------------------------------
// Mock data helpers for stub mode
// ---------------------------------------------------------------------------

const MOCK_LISTINGS_PAYLOAD = {
  results: [
    {
      id: "MLC1001",
      title: "Producto de prueba",
      status: "active",
      available_quantity: 10,
      price: 15000,
      currency_id: "CLP",
      permalink: "https://articulo.mercadolibre.cl/MLC1001",
    },
    {
      id: "MLC1002",
      title: "Artículo demo",
      status: "active",
      available_quantity: 5,
      price: 25000,
      currency_id: "CLP",
      permalink: "https://articulo.mercadolibre.cl/MLC1002",
    },
  ],
};

const MOCK_ORDERS_PAYLOAD = {
  results: [
    {
      id: "ORDER-1",
      status: "paid",
      total_amount: 12000,
      currency_id: "CLP",
      date_created: "2026-06-25T12:00:00Z",
      buyer: { id: 501 },
    },
  ],
};

const MOCK_QUESTIONS_PAYLOAD = {
  questions: [
    {
      id: "Q-1",
      text: "¿Tiene stock disponible?",
      status: "UNANSWERED",
      date_created: "2026-06-25T10:00:00Z",
      item_id: "MLC1001",
      from: { id: 501 },
    },
  ],
};

const MOCK_CATEGORIES_PAYLOAD = [
  { id: "MLC1000", name: "Electrónica" },
  { id: "MLC2000", name: "Ropa y Accesorios" },
];

const MOCK_USER_PAYLOAD = {
  id: 12345,
  nickname: "TESTSELLER",
  points: 100,
  seller_experience: "Novato",
  status: { site_status: "active" },
};

const MOCK_ITEM_PAYLOAD = {
  id: "MLC1001",
  title: "Producto de prueba",
  price: 15000,
  available_quantity: 10,
  category_id: "MLC1000",
  seller_id: 12345,
  status: "active",
  pictures: [{ url: "https://http2.mlstatic.com/D_IMG_1.jpg" }],
  attributes: [{ id: "BRAND", value_name: "Genérica" }],
  permalink: "https://articulo.mercadolibre.cl/MLC1001",
};

// ---------------------------------------------------------------------------
// New MlClient type with write operations
// ---------------------------------------------------------------------------

export type MlClient = {
  // Read operations
  getItems(sellerId: string): Promise<MlcListingsSnapshot>;
  getItem(sellerId: string, itemId: string): Promise<MlItem>;
  getOrders(sellerId: string): Promise<MlcOrdersSnapshot>;
  getQuestions(sellerId: string): Promise<MlcQuestionsSnapshot>;
  // Write operations
  publishItem(sellerId: string, item: NewItem): Promise<MlWriteSnapshot>;
  updateItem(sellerId: string, itemId: string, updates: Partial<NewItem>): Promise<MlWriteSnapshot>;
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

  function mockResponse(path: string, _method: "GET" | "POST" | "PUT", body?: unknown): unknown {
    // POST /items
    if (_method === "POST" && path === "/items") {
      const newItem = body as NewItem | undefined;
      return {
        id: "MLC-MOCK-9999",
        permalink: "https://articulo.mercadolibre.cl/MLC-MOCK-9999",
        status: "active",
        ...(newItem ? { title: newItem.title } : {}),
      };
    }

    // PUT /items/{id} or GET /items/{id}
    if (path.startsWith("/items/") && !path.includes("/search")) {
      if (_method === "PUT") {
        return {
          id: path.split("/").pop() ?? "MLC-MOCK-9999",
          permalink: `https://articulo.mercadolibre.cl/${path.split("/").pop() ?? "MLC-MOCK-9999"}`,
          status: "active",
        };
      }
      return MOCK_ITEM_PAYLOAD;
    }

    if (path.includes("/items/search")) return MOCK_LISTINGS_PAYLOAD;
    if (path.includes("/orders/search")) return MOCK_ORDERS_PAYLOAD;
    if (path.includes("/questions/search")) return MOCK_QUESTIONS_PAYLOAD;
    if (path.includes("/categories")) return MOCK_CATEGORIES_PAYLOAD;
    if (path.includes("/users/me")) return MOCK_USER_PAYLOAD;

    return {};
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
