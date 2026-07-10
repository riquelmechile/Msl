# Owned Ecommerce Merchandising Advisor Specification

## Purpose

DeepSeek-powered commercial reasoning on the deterministic owned-ecommerce pipeline. Scorer remains safety authority; validator blocks unsupported output.

## Requirements

### Requirement: Ranking with Reasoning and Fallback

Advisor MUST rank candidates with evidence-linked rationale. When transport absent, MUST return deterministic score-order fallback with `fallback: true`. Pipeline MUST NOT fail on absent transport.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Ranked rationale | 3 candidates, varied margin/stock | `rankCandidatesWithReasoning` | Ranked list; each rank cites evidenceIds |
| Transport absent | No `DeepSeekTransport` | Ranking | Score-order fallback with `fallback: true` |
| Tie resolved | Equal-scored candidates | Advisor reasons | Rationale cites channel strategy |

### Requirement: SEO/GEO Copy Drafting

Advisor MUST draft titles, meta descriptions, keywords, FAQ ideas per candidate. All output MUST pass `MerchandisingAdvisorValidator` before enrichment.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Copy drafted | Candidate with product evidence | `draftSeoGeoCopy` | `DeepSeekEnrichment` with title, meta, keywords, faqIdeas |
| Transport absent | No transport | Copy request | Product-name title; empty meta/keywords/faqs |
| Blocked claim | "best" without evidence | Validator runs | Claim stripped from enrichment |

### Requirement: Channel Tradeoffs and Storefront Experiments

Advisor MUST compare Plasticov, Maustian, owned-ecommerce per candidate (upsides/risks). MUST propose experiments with hypothesis, metric, stop rule, expected learning. Both MUST carry `noMutationExecuted: true` and `requiresApproval: true`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Channels compared | Candidate with AccountBrain data | `explainChannelTradeoffs` | Structured upside/risk per channel |
| Experiment proposed | New-category candidate | `proposeStorefrontExperiment` | Hypothesis, metric, stop rule, expected learning |
| No viable experiment | All known categories | Experiment request | Empty proposals with reason |

### Requirement: Evidence Gap Detection and Inter-Agent Planning

Advisor MUST detect gaps (cost, images, competition, account, Cortex data) as typed descriptors. `EcommerceEvidenceRequestPlanner` MUST convert gaps into typed, deduped inter-agent messages.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Gaps detected | Candidate missing cost, images | `identifyMissingEvidence` | Descriptors: `cost`, `images` with severity |
| Message planned | Gap `images` detected | Planner runs | Typed message with receiver, gap, evidence target |
| Duplicate suppressed | Same gap already messaged | Planner runs | Suppressed; existing message ID returned |

### Requirement: Validator Safety Gate

`MerchandisingAdvisorValidator` MUST block: superlatives without evidence, publish/checkout recommendations, claims without `evidenceIds`. MUST be pure function invoked before enrichment reaches projection.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Superlative blocked | "best" without evidence | Validator | Claim blocked, `unsupportedSuperlative` |
| Publish language | "activate checkout" | Validator | Stripped with `publishRecommendation` reason |
| Clean passes | All claims have evidenceIds | Validator | Output unchanged |

### Requirement: Cache-Friendly Prompt Architecture

Prompts MUST use stable prefix (system prompt at token 0) + variable evidence block. Stable prefix hash MUST NOT change with variable evidence.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Same candidate | Prompt built twice | Hash compared | Stable prefix hash identical |
| New candidate | Different product | Prompt built | Prefix unchanged; evidence hash differs |

### Requirement: IntelligenceService Integration

Advisor MUST wire into `OwnedEcommerceIntelligenceService` step 7. Enrichment MUST feed `buildProjection` as `DeepSeekEnrichment`. Blocked candidates MUST remain blocked. Feature flag `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` MUST gate the wiring.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Step 7 executes | Flag true, transport present | Pipeline step 7 | Enrichment in projection |
| Flag disabled | Flag not `"true"` | Pipeline runs | Step 7 skipped; no enrichment |
| Blocked stays blocked | Candidate blocked by scorer | Advisor enriches | Excluded from projection |
