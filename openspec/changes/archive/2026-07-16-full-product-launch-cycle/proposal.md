# Proposal: Full Product Launch Cycle (P2)

## Intent

Enable MSL to launch ML products intelligently — from a simple Telegram photo to a complete, validated listing package. The CEO sends a photo (even bad quality, even with multiple products), and the AI company handles everything: product recognition, internet research, image sourcing, MiniMax generation, account-aware listing, and pricing. Publish stays blocked. Every launch feeds Cortex learning.

## The Vision

```
CEO snaps a bad photo on Telegram
        │
        ▼
🧠 ProductRecognitionAgent (DeepSeek Vision)
   "It's a Nike Air Max 270 React, color black/white. There's also a box in the background, ignore it."
        │
        ▼
🔍 ProductResearchAgent (DeepSeek + web search)
   Searches internet: specs, measurements, materials, MSRP, official images
        │
        ▼
🎨 ImagePipeline (MiniMax + web-sourced references)
   Is photo good enough? → YES: use as reference for MiniMax
                        → NO: search web for product images, download, feed to MiniMax
   MiniMax generates: product-cover-i2i, product-gallery-i2i (1200×1200, white background)
        │
        ▼
📊 CompetitionAnalyst + MerchandisingAdvisor (DeepSeek, cached)
   ML competition data → price_to_win, positioning strategy
        │
        ▼
📦 ListingComposer (account-aware: Plasticov ≠ Maustian)
   Title, description, attributes, category, price, shipping, warranty
   Adapts tone, strategy, pricing per seller account
        │
        ▼
👔 CEO Approval (Telegram)
   Full listing preview → approve / adjust / reject
        │
        ▼
📋 Ready-to-publish package (write gate BLOCKED)
   Feed outcome to Cortex → company learns from this launch
```

## Scope

### In Scope

- **Telegram photo entrypoint**: `bot.on("message:photo")` handler that downloads, saves, and triggers the pipeline. Caption text becomes initial title hint.
- **ProductRecognitionAgent**: DeepSeek Vision analyzes photos — identifies product, ignores background/noise, handles multiple products (asks CEO which one), suggests search terms for research.
- **ProductResearchAgent**: DeepSeek-powered web research for product specs, measurements, materials, official descriptions. Sources product images from internet when originals are low quality.
- **ImageQualityAnalyzer**: Rates uploaded photo quality (resolution, lighting, background, clarity). Decides whether to use as-is, use as MiniMax reference, or discard for web-sourced alternatives.
- **ImagePipeline**: Orchestrates MiniMax generation with intelligent reference images. If photo is bad → search web → download → use as subject_reference for MiniMax. If photo is good → use directly as reference. Always generates ML-compliant images (1200×1200, white background).
- **ListingComposer**: Account-aware listing assembly. Plasticov and Maustian have different strategies, pricing models, and brand voice. Composer adapts accordingly using DeepSeek with account-specific system prompts.
- **ProductLaunch domain type**: State machine covering the full intelligent pipeline.
- **ProductLaunchCoordinator**: CEO sub-agent that delegates to specialist agents via Work Sessions. Cache-optimized DeepSeek calls with shared lane prefixes.
- **Competition Research**: ML `price_to_win` + `product_ads_insights` + market catalog.
- **Supplier selection**: Via existing Supplier Mirror.
- **Launch Outcome Attribution**: Feeds P1 Economics + Cortex.

### Out of Scope

- Actual ML publish (write gate stays `blocked`)
- Multi-channel (only ML for now)
- Landed cost calculation
- Automatic account selection (CEO chooses Plasticov or Maustian)
- Bulk/batch product launches (single product per pipeline run)

## Capabilities

### New Capabilities

| Capability | Description |
|---|---|
| `product-launch-domain` | `ProductLaunch` entity, state machine, outcome tracking |
| `product-launch-coordinator` | Orchestrator agent delegating to specialists |
| `product-recognition-agent` | DeepSeek Vision → identify product from photos |
| `product-research-agent` | Web search → specs, descriptions, reference images |
| `image-quality-analyzer` | Rate photo quality, decide MiniMax strategy |
| `image-sourcing-agent` | Search + download product images from internet |
| `listing-composer` | Account-aware listing assembly (Plasticov/Maustian) |
| `competition-research-agent` | Competition Analyst for pre-launch data |

### Modified Capabilities

| Capability | Change |
|---|---|
| `telegram-bot` | Add `message:photo` handler, image download, pipeline trigger |
| `ml-api-integration` | Add `domainDiscoverySearch`, conditional attribute validation |
| `mercadolibre-account-integration` | Conditional write gate (stays blocked) |
| `lane-contracts` | Add `product-launch`, `product-recognition`, `product-research` lanes |
| `cortex-darwinian-feedback` | Launch outcome as learning signal |
| `creative-studio-minimax` | Pipeline integration (no API changes to MiniMax itself) |

## Approach

**Intelligent, agent-driven pipeline with DeepSeek at every decision point:**

- **Cache-first architecture**: Every DeepSeek call uses shared lane prefixes. Repeated calls (e.g., "You are the ProductRecognitionAgent for Plasticov") hit automatic cache discount. The company operates at minimum LLM cost.
- **Agent delegation via Work Sessions**: Coordinator spawns specialist agents as workers. Independent steps (research, competition, supplier) run in parallel.
- **Graceful degradation**: If product recognition fails → ask CEO for more photos or a product link. If web search fails → fall back to ML catalog data. If no images found → use original photo as MiniMax reference. If MiniMax unavailable → use best available image. Pipeline never blocks on one step; it escalates to the CEO with specific, actionable requests.
- **Account awareness at every level**: System prompts, pricing strategies, and listing tone adapt to Plasticov vs Maustian. The company behaves differently for each account.
- **Write gate**: `mercadolibre-write` stays `blocked`. Output is a validated listing payload — never reaches ML servers.

## Telegram Integration

**Before (current):** `bot.on("message:text")` only — images are silently ignored.

**After (P2):** Full photo pipeline:

```
bot.on("message:photo")
  → ctx.getFile() download highest resolution
  → Save to .msl/product-photos/{chatId}/{timestamp}.jpg
  → Extract caption as title hint (optional)
  → Enqueue ProductLaunchCoordinator via Agent Message Bus
  → Coordinator replies progressively via sendProactiveMessage()
  → CEO gets: "📸 Producto identificado: Nike Air Max 270 React"
              "🔍 Buscando specs e imágenes..."
              "🎨 Generando imágenes profesionales con MiniMax..."
              "📊 Analizando competencia..."
              "📦 Publicación lista para revisar: [preview]"
  → CEO: "dale" → approved, outcome recorded, Cortex learns
```

## Affected Areas

| Area | Impact | Key Change |
|---|---|---|
| `packages/bot/src/index.ts` | Modified | `message:photo` handler, image download, pipeline enqueue |
| `packages/domain/` | New | `ProductLaunch` type, state machine, `ImageQuality` enum |
| `packages/agent/src/conversation/lanes.ts` | Modified | New lanes: product-launch, product-recognition, product-research |
| `packages/agent/src/conversation/agents/` | New | ProductRecognitionAgent, ProductResearchAgent, ListingComposerAgent |
| `packages/agent/src/workers/` | Modified | ProductLaunchCoordinator daemon |
| `packages/agent/src/tools/` | New | `search_product_info`, `analyze_image_quality`, `source_product_images` |
| `packages/mercadolibre/` | Modified | `domainDiscoverySearch`, attribute validation |
| `packages/agent/src/economics/` | Modified | Launch outcome attribution |

## DeepSeek Cost Model

| Agent | Calls per launch | Cache hits | Est. cost/launch |
|---|---|---|---|
| ProductRecognitionAgent | 1 (image analysis) | 0 | ~$0.01 |
| ProductResearchAgent | 2–3 (search + summarize) | 1–2 | ~$0.02 |
| CompetitionAnalyst | 2 (pricing + ads) | 2 | ~$0.01 |
| MerchandisingAdvisor | 1 (positioning) | 1 | ~$0.005 |
| ListingComposer | 1 (assembly) | 1 | ~$0.005 |
| MiniMax images | 2–4 images | N/A | $0.03–0.06 |
| **Total per launch** | | | **~$0.08–0.10** |

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| DeepSeek Vision misidentifies product | High | Ask CEO confirmation before proceeding; learn from corrections |
| Web search returns wrong product info | Med | Cross-reference ML catalog; CEO review step |
| No suitable images found on internet | Med | Use original photo as MiniMax fallback reference |
| MiniMax cost overrun | Low | Existing daily budget cap ($5); per-launch budget check |
| Category prediction wrong | Med | Top-3 predictions for CEO selection |
| Write gate regression | Med | Smoke test write paths still throw |
| Telegram large file timeout | Low | grammY handles up to 20MB; ML photos typically <5MB |

## Rollback Plan

- Remove `message:photo` handler → back to text-only bot
- Remove new lanes from `LANE_CONTRACTS` → agents become unreachable
- `mercadolibre-write` stays `blocked` → zero risk of accidental publish
- New agent code is additive → rollback = config change, no migration

## Dependencies

- P1 Economics (complete) — outcome attribution
- Creative Studio / MiniMax (complete) — image generation
- Supplier Mirror (complete) — supplier selection
- ML `domain_discovery/search` (new read-only endpoint)
- DeepSeek Vision API (same provider, new model capability)
- Internet search capability (new — tool for product research)

## Success Criteria

- [ ] CEO sends a Telegram photo (even bad quality) → bot recognizes product and starts pipeline
- [ ] ProductRecognitionAgent correctly identifies product from photo (with CEO confirmation)
- [ ] ProductResearchAgent finds specs, description, and reference images from internet
- [ ] ImageQualityAnalyzer determines if photo needs MiniMax regeneration
- [ ] MiniMax generates professional product images (cover + gallery) ML-compliant
- [ ] ListingComposer produces account-aware listing (different for Plasticov vs Maustian)
- [ ] CompetitionAnalyst provides price_to_win data
- [ ] Full listing preview sent to CEO via Telegram for approval
- [ ] Write gate active — no listing reaches ML servers
- [ ] Launch outcome feeds Cortex for company learning
