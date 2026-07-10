# ROADMAP — MSL Agent Enterprise

> **Review date:** 2026-07-10
> **Verified commit:** `413248c`
> **State definitions:**
>
> - **Implementado** — merged, tested, available at HEAD.
> - **Parcial** — foundation exists, not yet complete.
> - **Preparado** — contract/spec defined, implementation pending.
> - **Planificado** — on the roadmap, not yet started.
> - **Producción pendiente** — code exists, needs credentials/deployment to run on real data.

## Implemented at HEAD

Verified against commit `413248c`:

| Capability                               | Status                   | Notes                                                                                    |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| Agent enterprise kernel                  | Implementado             | Company agent registry, learning store, skill store, admin lifecycle tools               |
| Cortex neural graph + Darwinian learning | Implementado             | SQLite + recursive CTEs, Hebbian + pruning, constellation propagation                    |
| DeepSeek integration                     | Implementado             | Real client, cache-friendly blocks, requires `DEEPSEEK_API_KEY`                          |
| Agent Message Bus                        | Implementado             | SQLite-backed async queue, claim/resolve/fail, dedup, priority                           |
| 14 daemon handlers (15-min cycles)       | Implementado             | Dispatched through `startDaemonScheduler()` with per-cycle reader cache                  |
| 15 lane contracts                        | Implementado             | Typed `LANE_CONTRACTS` in `lanes.ts` with stable prefixes                                |
| Work Sessions                            | Implementado             | `AgentWorkSessionStore` + `AgentWorkSessionRunner`, 6 sessionized lanes                  |
| Account Assets + Account Brain           | Implementado             | `AccountAssetStore`, `AccountBrainService`, per-seller strategic tracking                |
| Evidence Response Router                 | Implementado             | 5 responders: CostSupplier, MarketCatalog, CreativeAssets, AccountBrain, SupplierManager |
| Multi-agent evidence responses           | Implementado             | Inter-agent evidence request/response protocol, `OwnedEcommerceEvidenceAggregator`       |
| Supplier Intelligence + Supplier Mirror  | Implementado             | Local-first, DeepSeek advisor, Jinpeng dry-run, disabled-by-default workers              |
| Owned ecommerce runtime                  | Implementado (env-gated) | Medusa write boundary (fail-closed), preview adapter, requires env creds                 |
| DeepSeek merchandising advisor           | Implementado             | `OwnedEcommerceMerchandisingAdvisor` for storefront recommendations                      |
| Approval gates + "dale" execution        | Implementado             | Prepare → approve → execute → audit pipeline                                             |
| Seller/account isolation                 | Implementado             | Column-scoped `seller_id` throughout operational model and Cortex                        |
| Operational Read Model                   | Implementado             | 8 entity kinds, SQLite snapshots + checkpoints, per-seller isolation                     |
| Background ingestion                     | Implementado             | 5 processors with checkpoint-based pagination                                            |
| Telegram bot runtime                     | Implementado             | grammY, CEO-only, multi-seller (single-instance dale limitation)                         |
| MCP server                               | Implementado             | ~40 tools, stdio, zod validation                                                         |
| Creative Studio (MiniMax)                | Implementado (env-gated) | Image/video generation, policy engine, cost caps                                         |
| CEO Inbox Store                          | Implementado             | Persists daemon proposals for CEO review                                                 |
| Workforce Cost Cache Ledger              | Implementado             | Dual-table rollups, per-agent budget warnings                                            |
| Agent Consensus Store                    | Implementado             | Multi-agent review with quorum for high-risk proposals                                   |

---

## P0 — Operational Truth & Production

**Propósito:** Hacer que MSL opere sobre datos reales con credenciales reales.

### Capacidades

- Credenciales reales de ML OAuth para ambas cuentas (Plasticov y Maustian)
- Ingesta real reemplazando el modo stub en todos los procesadores
- Transporte real donde hoy existe fake/mock
- Backups de las bases de datos SQLite
- Migraciones versionadas
- Observabilidad (logs estructurados, métricas, alertas)
- CI verificable con gates de seguridad
- Política de producción documentada (deploy, rollback, secretos, monitoreo)

### Dependencias

- OAuth apps registradas en MercadoLibre para ambas cuentas
- `MERCADOLIBRE_CLIENT_ID`/`MERCADOLIBRE_CLIENT_SECRET` configurados
- `MSL_ENCRYPTION_KEY` configurada

### Criterios de aceptación

- La ingesta corre con datos reales de ML sin errores
- El OAuth manager obtiene y refresca tokens reales
- Los backups se ejecutan automáticamente
- CI pasa con gates de seguridad activos

### Riesgos

- Rate limiting de ML API durante la ingesta inicial
- Datos inconsistentes si la ingesta falla parcialmente
- Rotación de tokens que interrumpa la operación

### Lo que la empresa aprende

- El volumen real de datos que maneja el negocio
- La latencia y confiabilidad real de ML API
- Patrones de acceso que informan la estrategia de caché

---

## P1 — Financial Truth & Economic Outcomes

**Propósito:** Probar qué acciones generan rentabilidad real.

**Estado:** **Parcial** — PR 1/3 completada (Economic Domain, Calculation & Persistence Foundation), PR 2/3 completada (Finance Director Agent)

### Capacidades

- ✅ `EconomicOutcome`: tracking de resultado económico post-ejecución (PR 1/3)
- ✅ `UnitEconomics`: margen de contribución por producto, canal y cuenta (PR 1/3)
- ✅ Money type seguro (`amountMinor` entero, CLP+USD, sin floating point) (PR 1/3)
- ✅ EconomicCostComponent con provenance (12 tipos de costo) (PR 1/3)
- ✅ SQLite EconomicOutcomeStore con seller isolation (PR 1/3)
- ✅ Herramientas CEO read-only: `inspect_unit_economics`, `inspect_economic_outcome`, `list_missing_economic_inputs` (PR 1/3)
- ✅ Finance Director Agent: DeepSeek-powered financial reasoning agent with advisor pipeline, validation, fallback, 4 CEO advisory tools, SQLite assessment store, daemon handler, work session integration (PR 2/3)
- 🔲 Landed cost: cálculo real del costo puesto (producto + flete + internación + impuestos)
- 🔲 Profit por order, por SKU, por cuenta y por canal
- 🔲 Visibilidad de flujo de caja (corto plazo)
- 🔲 Outcome attribution: qué agente/acción generó qué resultado
- ✅ Director Financiero (agente) — primera versión con razonamiento DeepSeek, 4 herramientas CEO, daemon handler, work sessions

### PRs completadas

| PR | Descripción | Estado |
|----|-------------|--------|
| 1/3 | Economic Domain, Calculation & Persistence Foundation | ✅ Merged |
| 2/3 | Finance Director Agent (DeepSeek reasoning) | ✅ Merged |
| 3/3 | Cortex Reinforcement Loop | 🔲 Planificado |

### Dependencias

- P0 completa (datos reales de venta, costo, comisiones)
- Landed cost requiere datos de proveedores e importación

### Criterios de aceptación

- Cada orden tiene costo, fee de ML, margen y profit atribuido
- Las propuestas del CEO Agent incluyen expected profit, no solo revenue
- Los outcomes negativos se detectan y se registran en Cortex

### Riesgos

- Datos de costo incompletos o desactualizados producen decisiones erróneas
- Atribución incorrecta que refuerce patrones subóptimos
- Complejidad de landed cost con tipos de cambio y tarifas variables

### Lo que la empresa aprende

- Qué productos, canales y cuentas generan profit real
- Si las decisiones del CEO Agent están mejorando o no la rentabilidad
- La diferencia entre revenue y profit en cada canal

---

## P2 — Full Product Launch Cycle

**Propósito:** Lanzar productos de punta a punta con IA.

### Capacidades

- Imagen a identificación de producto (foto → atributos)
- Investigación de competencia (precio, exposición, reputación)
- Selección de proveedor (costo, disponibilidad, confiabilidad)
- Generación de imágenes (Creative Studio)
- Título, atributos, descripción (generación + validación)
- Estrategia de pricing (margen, competencia, posicionamiento)
- Selección de cuenta (Plasticov vs. Maustian según estrategia)
- Ciclo: Aprobación → Publicación → Monitoreo → Aprendizaje

### Dependencias

- P1 (para medir profit del launch)
- Creative Studio con credenciales MiniMax
- ML API con credenciales reales para publicación

### Criterios de aceptación

- Un producto nuevo puede lanzarse con intervención humana solo en la aprobación final
- El agente mide el resultado del launch (ventas, margen, retorno) contra lo proyectado
- El aprendizaje del ciclo informa el siguiente launch

### Riesgos

- Publicar con atributos incorrectos que generen reclamos
- Errores de pricing que erosionen margen
- Dependencia de calidad de imagen generada por MiniMax

### Lo que la empresa aprende

- Tasa de éxito de launches asistidos por IA vs. manuales
- Qué señales predicen un launch exitoso
- Tiempo real desde detección de oportunidad hasta publicación

---

## P3 — Social Growth

**Propósito:** Construir presencia de marca y revenue por canales sociales.

### Capacidades

- Cuentas sociales con identidad de marca por cuenta ML
- Detección de tendencias (productos, categorías, formatos)
- Calendario de contenido y campañas
- Generación creativa (MiniMax: imágenes, video clips)
- Publicación con aprobación del CEO
- Engagement con la comunidad (comentarios, preguntas)
- UTM y atribución de venta desde canales sociales
- Experimentos controlados y aprendizaje

### Dependencias

- Creative Studio activo
- APIs de redes sociales (Meta, TikTok, etc.)
- Sistema de atribución (P1)

### Criterios de aceptación

- Una campaña social puede diseñarse, aprobarse y publicarse
- Las ventas atribuibles a canales sociales se miden
- Los experimentos comparan formatos, horarios y mensajes

### Riesgos

- Contenido generado que no cumpla políticas de plataforma
- Bajo engagement inicial sin audiencia construida
- Atribución cruzada entre canales que distorsione resultados

### Lo que la empresa aprende

- Qué tipo de contenido convierte en qué canal
- El CAC real por canal social
- Si el revenue social justifica el costo operativo y creativo

---

## P4 — Portfolio, Pricing, Inventory & Purchasing

**Propósito:** Optimizar el mix de productos, márgenes y asignación de capital.

### Capacidades

- Detección de oportunidades de producto
- Gestión de portafolio (push, maintain, fix, abandon)
- Pricing inteligente (margen, demanda, competencia, elasticidad)
- Promociones con medición de profit incremental
- Demand forecasting
- Reposición automatizada
- Importaciones (landed cost, lead time, riesgo)
- Riesgo de proveedor (concentración, confiabilidad, precio)

### Dependencias

- P1 (financial truth para medir profit del portafolio)
- P2 (launch cycle para incorporar productos nuevos)
- Supplier Mirror activo con datos reales

### Criterios de aceptación

- El portafolio tiene una clasificación viva de productos por rentabilidad
- Las decisiones de pricing se basan en datos, no en intuición
- Las promociones miden profit incremental, no solo volumen

### Riesgos

- Sobre-optimización de pricing que aleje compradores
- Forecast erróneo que genere sobrestock o quiebre
- Dependencia de proveedores únicos sin alternativas

### Lo que la empresa aprende

- Elasticidad real de precio por producto y categoría
- El costo real del capital inmovilizado en inventario
- Qué proveedores son confiables y cuáles no

---

## P5 — Experimentation & Organizational Intelligence

**Propósito:** Hacer que la empresa misma aprenda y mejore.

### Capacidades

- `BusinessObjective` + `WorkOrder`: modelo de objetivos y trabajo colaborativo
- Campaign y Experiment models
- Agent Scorecard: calidad de predicción, costo, contribución económica
- Agente Crítico / Abogado del Diablo
- Evaluación económica de cada agente
- Scheduling de agentes por expected utility

### Dependencias

- P1 (para medir contribución económica de cada agente)
- P2-P4 (para tener suficientes acciones que evaluar)

### Criterios de aceptación

- Cada agente tiene un scorecard visible para el CEO
- Las decisiones de scheduling se basan en expected utility, no en round-robin
- El Abogado del Diablo reduce la tasa de propuestas rechazadas por el CEO

### Riesgos

- Métricas de agente que incentiven comportamiento no deseado
- Complejidad de atribución cuando múltiples agentes contribuyen

### Lo que la empresa aprende

- Qué agentes generan más valor por token gastado
- Si la colaboración entre agentes mejora los outcomes
- La tasa de mejora de la organización en el tiempo

---

## P6 — Multichannel Expansion

**Propósito:** Expandir revenue más allá de MercadoLibre.

### Capacidades

- Ecommerce productivo (Medusa live con checkout y pagos)
- Ripley marketplace
- Amazon
- Alibaba / Global Selling
- Otros canales justificados por rentabilidad

### Dependencias

- P1 (para comparar rentabilidad entre canales)
- P2 (para lanzar productos en múltiples canales)
- Owned ecommerce con credenciales reales de Medusa

### Criterios de aceptación

- Al menos un canal adicional está generando revenue atribuible
- Las decisiones de canal se basan en profit comparado, no en intuición
- El modelo de empresa agente funciona igual en cada canal nuevo

### Riesgos

- Complejidad operativa de manejar múltiples canales con reglas distintas
- Requisitos de fulfillment que excedan la capacidad actual
- Canibalización entre canales

### Lo que la empresa aprende

- Profit real por canal y por producto en cada canal
- Si la expansión multicanal mejora o diluye la rentabilidad total
- Costo marginal de agregar un canal nuevo al modelo de agente

---

## Technology decisions

| Decision          | Choice                   | Rationale                                                                                                                                                                                                   |
| ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM               | DeepSeek v4 Flash/Pro    | 1M context window, cache discount for repeated prefixes, OpenAI-compatible API                                                                                                                              |
| Memory            | SQLite + recursive CTEs  | Zero external services, persistent, portable                                                                                                                                                                |
| Agent framework   | None (custom agentLoop)  | No LangChain, no Mastra — direct API control                                                                                                                                                                |
| Integration       | `openai` npm + `baseURL` | Zero new SDK, trivially swappable                                                                                                                                                                           |
| Hosting           | Node.js 22 in-process    | No external DB servers needed for Cortex                                                                                                                                                                    |
| Protocol          | MCP for tool exposure    | ~40 MCP tools across MercadoLibre reads, proposals, approvals, Cortex, claims, shipping, moderation, workforce, and cost ledger                                                                             |
| Testing           | Vitest + Playwright      | Unit/integration and E2E gates; exact counts should come from the latest local/CI run, not static docs                                                                                                      |
| Operational DB    | SQLite (better-sqlite3)  | 8 entity kinds (listings, claims, questions, orders, messages, reputation, product-ads-insights, pricing) with per-seller lane isolation, freshness TTLs, and ingestion checkpoints                         |
| CEO Lanes         | 15 lane contracts        | 15 typed `LANE_CONTRACTS` in `@msl/agent/conversation/lanes.ts` with stable token-0 DeepSeek prefixes, `delegate_to_subagent` tool. Telegram remains CEO-only; workers are internal orchestration resources |
| Owned Ecommerce   | `@msl/ecommerce-medusa`  | Medusa write boundary (fail-closed), preview adapter for static storefront projections, blocking check collection for readiness validation, env-gated production activation                                 |
| Daemon scheduling | Agent Message Bus        | 14 daemon handlers dispatched on 15-min cycles with per-cycle reader cache, per-seller account contexts, and work-session routing for 6 sessionized lanes                                                   |
| Evidence protocol | EvidenceResponseRouter   | 5 specialized responders answer inter-agent evidence requests. Bounded, structured, confidence-rated. Reduces CEO interruptions for routine evidence collection                                             |
