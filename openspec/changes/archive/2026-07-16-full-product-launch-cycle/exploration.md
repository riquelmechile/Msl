# Exploration: Full Product Launch Cycle (P2)

## Current State

El ecosistema MSL ya tiene una base sólida de capacidades que P2 puede aprovechar. El sistema opera con un ciclo de aprobación de 4 fases (Prepare → Approve → Execute → Audit) con aislamiento por vendedor, y el Creative Studio ya está implementado con MiniMax para generación de imágenes y video. La conexión con MercadoLibre está establecida en modo read-only con OAuth real y credenciales duales (Plasticov/Maustian), pero los writes están bloqueados universalmente.

### What Already Exists That P2 Can Leverage

| Capability | Location | State |
|---|---|---|
| **Approval Gates Pipeline** | `packages/tools/src/index.ts` | ✅ Complete — prepare, approve, execute, audit con seller isolation |
| **Creative Studio (MiniMax)** | `packages/creative-studio/` | ✅ Complete — image & video generation, policy engine, cost caps |
| **ML API Client (publishItem)** | `packages/mercadolibre/src/index.ts` (line 2402) | ✅ Code exists — POST /items implementado pero bloqueado por runtime gate |
| **create_listing tool** | `packages/agent/src/conversation/tools/listingTools.ts` (line 1280) | ✅ Complete — tool facing al agente, construye NewItem y llama publishItem |
| **Category Attributes Read** | `packages/mercadolibre/src/index.ts` (`getCategoryAttributes`) | ✅ Complete — lee atributos por categoría con validación MLC |
| **Category Technical Specs** | `packages/mercadolibre/src/index.ts` (`getCategoryTechnicalSpecs`) | ✅ Complete — lee specs técnicos por dominio |
| **Listing Fees Calculator** | `packages/agent/src/conversation/tools/listingTools.ts` (`calculate_listing_fees`) | ✅ Complete — calcula comisiones de venta |
| **Economic Outcome Tracking (P1)** | `packages/agent/src/economics/` | ✅ Complete — mide profitability post-launch |
| **Finance Director Agent** | `packages/agent/src/finance/` | ✅ Complete — DeepSeek, validación anti-alucinación, 4 tools CEO |
| **Supplier Mirror** | `packages/domain/src/supplierMirror.ts` | ✅ Complete — domain model, pricing policies, target mapping |
| **Supplier Manager Daemon** | `packages/agent/src/workers/supplierManagerDaemon.ts` | ✅ Complete — evidence responder, DeepSeek advisor |
| **DeepSeek Merchandising Advisor** | `packages/agent/src/ecommerce/` | ✅ Complete — OwnedEcommerceMerchandisingAdvisor |
| **Market Catalog Daemon** | `packages/agent/src/workers/marketCatalogDaemon.ts` | ✅ Complete — detecta anomalías de precio, baja visita, relist candidates |
| **Product Ads Insights** | `packages/mercadolibre/src/index.ts` (`getProductAdsInsights`) | ✅ Complete — métricas de campañas publicitarias |
| **Price to Win** | `packages/mercadolibre/src/index.ts` (`getItemPriceToWin`) | ✅ Complete — competitive pricing data |
| **Image Diagnostic (ML API)** | `packages/mercadolibre/src/index.ts` (`diagnoseImage`) | ✅ Complete — diagnostic image quality for ML |
| **Creative Assets Daemon** | `packages/agent/src/workers/creativeAssetsDaemon.ts` | ✅ Complete — monitorea calidad de imágenes en listings |
| **Agent Consensus Store** | `packages/agent/src/conversation/agentConsensusStore.ts` | ✅ Complete — multi-agent review for high-risk proposals |
| **Workforce Cost Cache Ledger** | `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts` | ✅ Complete — per-agent budget tracking |

### What Is Missing (Gaps)

1. **ML Write Unblocking (CRÍTICO)**: `assertMercadoLibreWriteDisabled()` en `packages/agent/src/readiness/runtimeGates.ts` lanza excepción incondicionalmente. P2 requiere que `publishItem` y `updateItem` funcionen con credenciales reales.

2. **Image-to-Product Identification**: El ROADMAP menciona "Imagen a identificación de producto (foto → atributos)". No existe un flujo standalone que tome una foto de producto, la diagnostique con ML (`diagnoseImage`), y automáticamente extraiga atributos (categoría, marca, color, etc.). El `diagnoseImage` de ML devuelve detecciones pero no atributos estructurados de producto.

3. **Category Prediction Integration**: ML tiene `GET /sites/$SITE_ID/domain_discovery/search?q=TITLE` que predice categoría desde el título. Esto no está integrado como tool del agente ni como paso automático en el pipeline de launch.

4. **Competition Research Pipeline**: Los datos de competencia existen (price_to_win, product ads insights, market catalog daemon) pero no están integrados en un flujo cohesivo de "investigación de competencia" pre-launch.

5. **Launch Outcome Attribution**: P1 mide profitability, pero no hay un modelo específico de "Launch" como entidad que agrupe: producto creado → métricas post-launch → aprendizaje.

6. **Supplier Selection Automation**: Supplier Mirror tiene el modelo de datos pero la selección automática de proveedor basada en costo/disponibilidad/confiabilidad no está implementada como flujo autónomo.

7. **Account Selection Logic**: La selección de cuenta (Plasticov vs Maustian) según estrategia no está automatizada; actualmente es manual/configuración.

## Affected Areas

- `packages/agent/src/readiness/runtimeGates.ts` — **CRÍTICO**: desbloquear writes para P2 (actualmente `assertMercadoLibreWriteDisabled` tira siempre)
- `packages/mercadolibre/src/index.ts` — `publishItem`, `updateItem` ya existen pero requieren runtime gate + test suite para producción
- `packages/agent/src/conversation/tools/listingTools.ts` — `create_listing` tool ya existe; puede necesitar enriquecimiento con atributos, validación pre-publicación
- `packages/creative-studio/` — integración con el pipeline de launch (generar imágenes para el nuevo producto)
- `packages/agent/src/workers/` — nuevo daemon o extensión de `creativeStudioDaemon` para el ciclo de launch
- `packages/domain/src/` — posible nuevo tipo `ProductLaunch` con estado y outcome tracking
- `packages/agent/src/conversation/lanes.ts` — posible nueva lane para "product-launch" o extensión de lanes existentes
- `packages/mercadolibre/src/normalization.ts` — `normalizeCategoryAttributes`, `normalizeWriteResponse` ya existen
- `packages/mcp/src/tools/syncTools.ts` — `publishItem` wiring en MCP tools ya existe (line 1440)

## Approaches

### 1. **Incremental Launch Pipeline** (Recomendado)

Construir el pipeline de launch como una secuencia de steps autónomos que reutilizan al máximo lo existente, con un nuevo `ProductLaunchManager` que orquesta:

```
Photo/Reference → Category Prediction → Attribute Extraction → Supplier Selection
→ Creative Generation (MiniMax) → Pricing Strategy → Listing Construction
→ Validation → Approval Gate → Publish → Monitor → Learn
```

- **Pros**: Minimiza nuevo código (~60% reutilización), cada step es testeable independientemente, alinea con arquitectura hexagonal existente, el approval gate ya funciona
- **Cons**: Requiere coordinación entre múltiples módulos existentes, la secuencia puede ser frágil si un step falla
- **Effort**: Medium

### 2. **Monolithic Launch Agent**

Crear un agente especializado "Launch Director" que maneje todo el ciclo internamente con un solo tool call compuesto.

- **Pros**: Simple de razonar, menos puntos de fallo, una sola responsabilidad
- **Cons**: Viola el patrón de daemons especializados existente, difícil de testear, menos reutilizable, va contra la arquitectura de lanes
- **Effort**: Low (corto plazo) / High (mantenimiento)

### 3. **Multi-Agent Collaborative Launch**

Extender el Agent Message Bus para que múltiples agentes (Creative, MarketCatalog, SupplierManager, FinanceDirector) colaboren en el launch vía evidence requests/responses.

- **Pros**: Aprovecha al máximo los daemons y evidence responders existentes, escalable, alineado con la visión de "empresa agente"
- **Cons**: Mayor complejidad de coordinación, latencia (múltiples round-trips), riesgo de inconsistencia entre agentes
- **Effort**: High

## Recommendation

**Enfoque 1 (Incremental Launch Pipeline)** con `ProductLaunchManager`. 

Razones:
- El 60% del código ya existe (approval gates, publishItem, category attributes, MiniMax, pricing tools, economic tracking)
- La arquitectura hexagonal de `@msl/domain` permite agregar el `ProductLaunch` como tipo de dominio puro sin I/O
- El pipeline de approval existente (prepare → approve → execute → audit) es el backbone perfecto para el ciclo de launch
- Cada step del pipeline mapea naturalmente a un `PreparedWriteKind` existente o nuevo
- Los daemons existentes (creativeStudio, creativeAssets, marketCatalog) pueden actuar como "pre-flight checks" antes del launch

### Arquitectura propuesta (high-level)

```
┌─────────────────────────────────────────────────────────┐
│                  ProductLaunchManager                     │
│  (orquesta el ciclo completo con estado explícito)       │
└───────────────┬─────────────────────────────────────────┘
                │
    ┌───────────┼───────────┬──────────────┬──────────────┐
    ▼           ▼           ▼              ▼              ▼
┌───────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐
│Photo  │ │Category  │ │Creative  │ │Pricing    │ │Publish   │
│→Attrs │ │Predict   │ │Studio    │ │Strategy   │ │& Monitor │
│(NUEVO)│ │(Integrar)│ │(Existe)  │ │(Extender) │ │(Existe)  │
└───────┘ └──────────┘ └──────────┘ └───────────┘ └──────────┘
                │              │              │
                ▼              ▼              ▼
        ┌─────────────────────────────────────────┐
        │        Approval Gate Pipeline            │
        │  prepare → approve → execute → audit     │
        │         (packages/tools)                 │
        └─────────────────────────────────────────┘
```

### Lo que hay que construir (nuevo)

1. **`ProductLaunch` domain type** en `@msl/domain` — estado (draft → researching → generating → validating → pending_approval → published → monitoring → learning), steps completados, métricas post-launch
2. **`ProductLaunchManager`** en `@msl/agent` — orquestador que ejecuta el pipeline con manejo de errores y reintentos
3. **Image-to-Attributes step** — usa `diagnoseImage` de ML API + DeepSeek para extraer atributos estructurados desde una foto
4. **Category Prediction tool** — integra `GET /sites/MLC/domain_discovery/search` como tool del agente
5. **Competition Research step** — consolida `price_to_win` + `product_ads_insights` + `market_catalog` en un análisis pre-launch
6. **ML Write Unblocking** — `assertMercadoLibreWriteDisabled` debe volverse condicional (gated by P2 readiness + seller credentials)
7. **Launch Outcome Attribution** — extender `EconomicOutcome` con `launch_id` para tracking post-publicación
8. **Product Launch Daemon** — daemon autónomo que monitorea launches activos y reporta métricas al CEO

### Lo que hay que extender (existente)

1. **`create_listing` tool** — agregar validación pre-publicación usando `/categories/{id}/attributes/conditional`
2. **Creative Studio Daemon** — aceptar requests del `ProductLaunchManager`
3. **Market Catalog Daemon** — agregar señales específicas de pre-launch (categoría saturada, precio no competitivo)
4. **Supplier Manager** — automation de supplier selection basada en costo y disponibilidad

## Mercado Libre API for Product Listing — Key Endpoints

### Already implemented in the codebase:
| Endpoint | Method | Code Location | Status |
|---|---|---|---|
| `POST /items` | Create listing | `packages/mercadolibre/src/index.ts:2402` (`publishItem`) | ✅ Code exists, write-blocked |
| `PUT /items/{id}` | Update listing | `packages/mercadolibre/src/index.ts:2407` (`updateItem`) | ✅ Code exists, write-blocked |
| `GET /categories/{id}/attributes` | Category attributes | `packages/mercadolibre/src/index.ts:1526` | ✅ Read works |
| `GET /domains/{id}/technical_specs` | Technical specs | `packages/mercadolibre/src/index.ts:1531` | ✅ Read works |
| `GET /sites/{id}/listing_prices` | Sale fee calculation | `packages/mercadolibre/src/index.ts:1573` | ✅ Read works |

### Not yet integrated (need to add):
| Endpoint | Purpose | Priority |
|---|---|---|
| `GET /sites/MLC/domain_discovery/search?q=` | Category prediction from title | HIGH |
| `POST /categories/{id}/attributes/conditional` | Validate conditional required attributes | HIGH |
| `GET /items/{id}/description` | Read existing description | MEDIUM |
| `POST /items/{id}/description` | Create/update description | MEDIUM |
| `GET /sites/MLC/listing_types` | Available listing types for MLC | LOW |

## MiniMax Integration Approach

Creative Studio ya expone:
- `MinimaxImageProvider` — genera imágenes (product-cover-i2i, product-gallery-i2i)
- `MinimaxVideoProvider` — genera video clips (product-clip-6s/10s, ml-clip-vertical-30s)
- `PolicyEngine` — validación pre-flight (preserveProductTruth, requestId format, references required)
- `CostLedger` — tracking de costos por generación

Para P2, la integración es directa:
1. El `ProductLaunchManager` emite `CreativeAssetRequest` con `kind: "product-cover-i2i"` o `"product-gallery-i2i"`
2. El `CreativeStudioDaemon` (o el `ProductLaunchManager` directamente) ejecuta la generación vía `MinimaxImageProvider`
3. Las imágenes generadas se asocian al `NewItem.pictures` usando `uploadImage` + `associateImageToItem` de ML API
4. El costo se registra en `CostLedger` y se atribuye al `ProductLaunch`

**Sin cambios necesarios en el Creative Studio package** — solo orquestación desde el nuevo manager.

## Key Risks and Unknowns

1. **ML Write Desbloqueo**: Pasar de "write universalmente bloqueado" a "write gated por readiness" requiere:
   - Definir capability `mercadolibre-write` en `ProductionCapability`
   - Credenciales de producción con scope `write` (actualmente los tokens son `read`-only)
   - Tests de smoke para POST/PUT /items en modo test (user de prueba de ML)
   - Rollback automático si la validación falla

2. **Image-to-Product Accuracy**: `diagnoseImage` de ML API detecta problemas de calidad (blurry, watermark, etc.) pero NO extrae atributos estructurados (marca, modelo, color, categoría). Esto requeriría usar DeepSeek Vision o similar para analizar la imagen y devolver JSON estructurado. Alternativa: el usuario provee título + descripción y el sistema predice categoría + atributos con `domain_discovery`.

3. **Category Prediction Fallback**: Si `domain_discovery/search` no encuentra match, el sistema necesita un fallback (¿pedir al usuario? ¿usar DeepSeek para sugerir categoría?)

4. **Atributos obligatorios**: ML requiere atributos específicos por categoría (`required: true`, `conditional_required`). Si el sistema genera atributos incorrectos o faltantes, el POST /items devolverá 400 con validation errors. Necesitamos un paso de validación pre-flight usando `/categories/{id}/attributes/conditional`.

5. **Costo de MiniMax**: Las generaciones de imagen tienen costo. El `CostLedger` existe pero necesitamos asegurar que el budget del launch está configurado y que no exceda límites.

6. **Account Selection**: La selección Plasticov vs Maustian no está automatizada. ¿Criterio? ¿Margen esperado, tipo de producto, audiencia? El `AccountBrainService` tiene datos de capacidades por cuenta que podrían usarse.

7. **Competition Data Freshness**: `price_to_win` y `product_ads_insights` dependen de la ingesta de datos de ML que ocurre en ciclos de 15 minutos. Puede haber desfase entre el análisis de competencia y el momento de publicación.

8. **Launch Monitoring Window**: ¿Cuánto tiempo se monitorea un launch antes de considerarlo "aprendido"? ¿Días, semanas? Esto afecta el diseño del `ProductLaunch` state machine.

## Ready for Proposal

**Yes** — la exploración confirma que P2 es viable con ~60% de reutilización de código existente. El blocker principal es el desbloqueo de writes de MercadoLibre, que es un prerequisito para cualquier implementación de P2.

La próxima fase (proposal) debería:
- Definir el scope exacto del MVP de P2 (¿launch manual con aprobación CEO? ¿launch semi-autónomo? ¿launch fully autonomous?)
- Especificar el `ProductLaunch` domain model
- Definir la secuencia de steps del pipeline
- Priorizar el desbloqueo de writes como task #0
- Estimar el esfuerzo de cada step nuevo vs. extensión de existente
