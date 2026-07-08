// ── Per-kind freshness TTLs ────────────────────────────────────────────

export const KIND_FRESHNESS_TTL = {
  claim: 60 * 60 * 1000, // 1h — high velocity
  order: 60 * 60 * 1000, // 1h — high velocity
  question: 2 * 60 * 60 * 1000, // 2h — medium velocity
  message: 6 * 60 * 60 * 1000, // 6h — low velocity
  reputation: 6 * 60 * 60 * 1000, // 6h — low velocity
  "product-ads-insights": 24 * 60 * 60 * 1000, // 24h — seller-level ads snapshot
  "creative-snapshot": 24 * 60 * 60 * 1000, // 24h — seller-level creative snapshot
  pricing: 6 * 60 * 60 * 1000, // 6h — catalog competition snapshot
};

/** Default max pages per entity kind. */
export const KIND_DEFAULT_MAX_PAGES = {
  claim: 100,
  order: 100,
  question: 100,
  message: 100,
  reputation: 1,
  "product-ads-insights": 1,
  "creative-snapshot": 1,
};
