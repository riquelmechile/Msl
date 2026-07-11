<p align="center">
  <h1 align="center">MSL — Empresa Agente Inteligente para el Comercio</h1>
  <p align="center">Fuerza de trabajo de agentes de IA liderada por un CEO. Inteligencia operativa con memoria neuronal, agentes especialistas y ejecución con aprobación humana. Lenguaje natural. Autonomía controlada. Orientado a rentabilidad.</p>
</p>

<p align="center">
  <a href="https://github.com/riquelmechile/Msl/actions"><img src="https://github.com/riquelmechile/Msl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/typescript-5.8-blue" alt="TypeScript 5.8">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-green" alt="Node ≥22">
  <img src="https://img.shields.io/badge/llm-DeepSeek%20v4-purple" alt="DeepSeek v4">
</p>

---

## Qué es MSL

MSL es una **empresa agente**: una jerarquía de agentes de IA que investigan, colaboran, aprenden y proponen acciones de negocio. El CEO humano mantiene el control de cada decisión comercial a través de aprobaciones en Telegram ("dale").

MSL **no es** un bot de MercadoLibre. MercadoLibre es el primer canal operativo, no el límite del producto. La arquitectura está diseñada para expandirse a ecommerce propio, redes sociales, otros marketplaces y operaciones de proveedores.

**Contexto de negocio:** Plasticov y Maustian son cuentas independientes de MercadoLibre Chile operadas como canales comerciales paralelos con precios, tipos de publicación y estrategias independientes. MSL las gestiona como activos comerciales separados con memoria, aprendizaje y ejecución por cuenta.

MSL combina razonamiento (DeepSeek), memoria (Cortex, grafo neuronal en SQLite) y colaboración entre agentes (Agent Message Bus + evidencia entre pares). Cada mutación de negocio requiere aprobación explícita del CEO.

---

## Qué funciona actualmente

Verificado contra el baseline `6fd769f` (P0 PR 4/4 Real Ingestion & Economic Adapters, hardened):

| Componente                     | Estado                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| Agent Message Bus              | Cola asíncrona SQLite, claim/resolve/fail, deduplicación    |
| 16 daemon handlers             | Ciclos de 15 min, solo lectura, proponen al CEO (gated)     |
| 16 lane contracts              | Contratos tipados con prefijos estables para caché          |
| Evidence Response Router       | 5 responders que responden solicitudes de evidencia         |
| Work Sessions                  | Sesiones persistentes con cooldown para 7 lanes             |
| Account Assets + Account Brain | Tracking estratégico por cuenta, scoring, comparación       |
| Cortex                         | Grafo neuronal con aprendizaje hebbiano y poda darwiniana   |
| DeepSeek                       | Cliente real, bloques de caché, requiere `DEEPSEEK_API_KEY` |
| Operational Read Model         | Snapshots SQLite de 8 tipos de entidad                      |
| SQLite Durability              | Backups, verificación, restauración, WAL, integrity check   |
| Migration Framework            | Migraciones versionadas, transaccionales e idempotentes     |
| Observability Pipeline         | Logger JSON + correlation IDs + sanitización de secretos    |
| Operational Health             | Checks de integridad, WAL, migraciones, backup freshness    |
| Degraded Capability Policy     | Capacidades degradadas → WARN, no bloquean producción       |
| Finance Director Validation    | Detección de figuras inventadas con evidencia cruzada       |
| Supplier Mirror                | Evidencia de proveedores local-first, dry-run Jinpeng       |
| Owned Ecommerce                | Write boundary Medusa (fail-closed), env-gated              |
| Creative Studio                | MiniMax imagen/video, env-gated                             |
| Telegram Bot                   | Runtime grammY, CEO-only, multi-seller                      |
| MCP Server                     | ~40 herramientas para clientes MCP                          |
| Aprobación "dale"              | Pipeline prepare → approve → execute → audit                |
| Background Ingestion           | 5 procesadores con paginación por checkpoint                |
| Economic Ingestion Pipeline    | Pipeline real con DataFetcher ML (read-only), 93+ snapshots |
| Economic CLI                   | `npm run economic:ingest/status/coverage/reconcile/missing/inspect-evidence` |
| Economic Store                 | SQLite: cost components, snapshots, evidence refs, runs     |
| Economic Ingestion Durability  | RunIdFactory UUID, fail-closed, atomic tx, Evidence Store, run-scoped metrics |

---

## Qué todavía no está en producción

- **Escritura productiva de ML**: las operaciones de escritura (publicar, actualizar, stock, precio) están bloqueadas por `assertMercadoLibreWriteDisabled()`. Implementadas como read-only production (P0 PR 3/4).
- **Costos completos**: product cost y landed cost requieren fuentes externas (proveedor, aduana). Los snapshots económicos son parciales por diseño — los costos faltantes se declaran como `missingInput`, no se inventan.
- **Ecommerce productivo**: el write boundary de Medusa está implementado pero no activo sin credenciales y aprobación.
- **Canales sociales**: no implementados.
- **Expansión a otros marketplaces**: no implementada.

---

## Modelo de empresa agente

```
CEO Humano
  └─ CEO Agent (DeepSeek)
      ├─ Director Financiero y Rentabilidad
      ├─ Director de Portafolio
      ├─ Director de Inventario, Compras e Importaciones
      ├─ Director de Crecimiento Social
      └─ Director de Expansión
           └─ Especialistas (pricing, ads, contenido, postventa...)
```

Los especialistas investigan y colaboran entre ellos. Los gerentes consolidan evidencia. El CEO Agent presenta solo las decisiones de negocio al CEO humano. Los workers, managers y especialistas son recursos internos de orquestación — el CEO nunca interactúa directamente con ellos.

---

## Flujo de decisión

```
Especialista detecta oportunidad
  → Solicita evidencia a otros agentes (EvidenceResponseRouter + 5 responders)
  → Gerente consolida evidencia en propuesta
  → CEO Agent presenta la decisión de negocio en Telegram
  → CEO humano aprueba ("dale"), rechaza o redirige
  → Cortex registra el outcome + feedback darwiniano
```

El CEO no es interrumpido para recolección de evidencia. Solo para decisiones con utilidad de negocio significativa.

---

## Arquitectura resumida

```
Telegram / Web Console
        │
        ▼
   @msl/agent (DeepSeek v4)
   Agent Loop · Guardrails · 16 Daemons · Evidence Router
        │
   ┌────┼────────────┬──────────────┐
   ▼    ▼            ▼              ▼
 @msl/memory    @msl/mercadolibre  @msl/creative-studio
 Cortex (SQLite) ML API (OAuth)    MiniMax (imagen/video)
 Op Read Model  Sync Engine        Policy Engine
        │            │              │
        └────────────┼──────────────┘
                     ▼
              @msl/domain (núcleo hexagonal puro — sin I/O)

 @msl/bot · @msl/mcp · @msl/workers · @msl/tools · @msl/ecommerce-medusa
```

---

## Seguridad y aprobación "dale"

Toda mutación de negocio requiere aprobación explícita del CEO:

1. El agente **prepara** una propuesta (sin ejecutar nada)
2. La propuesta pasa por **verificación automática** (6 checks)
3. Si es de alto riesgo, pasa por **consenso multi-agente**
4. El CEO ve la propuesta en Telegram y responde **"dale"** para ejecutar
5. La ejecución registra **auditoría completa**
6. Cortex recibe **feedback darwiniano** según el outcome

Nada se publica, modifica, cancela o gasta sin un "dale" explícito. Las herramientas de ML en el MCP server son read-only hasta que haya credenciales reales y aprobación.

---

## Paquetes del monorepo

| Package                 | Rol                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `@msl/agent`            | CEO agent loop, DeepSeek, 16 daemons, evidence router, work sessions, account brain  |
| `@msl/memory`           | Cortex neural graph, operational read model, evidence request store, supplier mirror |
| `@msl/mercadolibre`     | ML API client (OAuth), sync engine, supplier source adapters                         |
| `@msl/creative-studio`  | MiniMax image/video generation, policy engine, cost controls                         |
| `@msl/workers`          | Background ingestion, creative sync, supplier mirror scheduler                       |
| `@msl/ecommerce-medusa` | Medusa write boundary, storefront projections, preview adapter                       |
| `@msl/bot`              | Telegram bot (grammY), CEO-only, multi-seller                                        |
| `@msl/mcp`              | MCP server — ~40 tools                                                               |
| `@msl/tools`            | Approval queue, audit trail, risk gates, execution                                   |
| `@msl/domain`           | Pure TypeScript hexagonal core — no I/O, no DB                                       |
| `apps/web`              | Next.js 15 + React 19 web console                                                    |

---

## Inicio rápido

```bash
git clone https://github.com/riquelmechile/Msl.git
cd Msl
cp .env.example .env.local   # editar con tus claves
npm install
npm test
npm run dev                   # http://127.0.0.1:3000
```

> **Seguro por defecto.** El chat y el bot de Telegram usan comportamiento local/mock hasta que configures variables de entorno. Cada mutación requiere aprobación explícita del CEO.

---

## Variables de entorno

Ver [`.env.example`](.env.example) para la referencia completa. Grupos principales:

| Grupo                            | Requerido para                                 |
| -------------------------------- | ---------------------------------------------- |
| `DEEPSEEK_API_KEY`               | Respuestas reales del LLM                      |
| `BOT_TOKEN`                      | Bot de Telegram                                |
| `MINIMAX_API_KEY`                | Creative Studio (imagen/video)                 |
| MercadoLibre OAuth               | Acceso a API de ML (listings, órdenes, claims) |
| Supplier Mirror                  | Bootstrap de Jinpeng, evidencia de proveedores |
| `MSL_ENCRYPTION_KEY`             | Cifrado de tokens OAuth                        |
| `MSL_ECONOMIC_INGESTION_ENABLED` | Ingesta económica real (costos, snapshots)     |
| `MSL_ECONOMIC_INGESTION_DURABILITY` | Durabilidad de ingesta (UUID IDs, fail-closed, atomic tx, Evidence Store) |

---

## Comandos de calidad

```bash
npm run typecheck     # TypeScript strict
npm run lint          # ESLint
npm run format:check  # Prettier
npm test              # Vitest (unitarios + integración)
npm run test:e2e      # Playwright E2E
npm run build         # Build completo del workspace
npm run production:readiness  # Diagnóstico de production readiness
npm run economic:ingest      # Ejecutar ingesta económica (leer ML, calcular costos)
npm run economic:status      # Estado de la última ingesta
npm run economic:coverage    # Cobertura de datos económicos por seller
npm run economic:reconcile   # Reconciliar costos vs snapshots
npm run economic:missing     # Listar inputs económicos faltantes
npm run economic:inspect-evidence  # Inspeccionar referencias de evidencia por run/seller
```

---

## Estado de producción

| Componente                       | Estado                                                  |
| -------------------------------- | ------------------------------------------------------- |
| Agent Loop + DeepSeek            | ✅ Listo (requiere `DEEPSEEK_API_KEY`)                  |
| Agent Message Bus                | ✅ Listo (SQLite)                                       |
| 16 Daemon Handlers               | ✅ Listo (15-min cycles, economic-learning gated)       |
| Evidence Responses               | ✅ Listo (5 responders)                                 |
| Work Sessions                    | ✅ Listo                                                |
| Cortex                           | ✅ Listo (SQLite)                                       |
| Operational Read Model           | ✅ Listo (8 entity kinds)                               |
| SQLite Durability                | ✅ Listo (backups, WAL, integrity, gated)               |
| Observability Pipeline           | ✅ Listo (JSON logger + sanitization, gated)            |
| Operational Health               | ✅ Listo (DB checks, backup freshness, gated)           |
| Telegram Bot                     | ✅ Runtime listo (requiere `BOT_TOKEN`)                 |
| MCP Server                       | ✅ Runtime listo (~40 tools)                            |
| Supplier Mirror                  | ✅ Foundation listo (workers disabled by default)       |
| Owned Ecommerce                  | ✅ Runtime listo (env-gated)                            |
| Creative Studio                  | ✅ Runtime listo (env-gated)                            |
| ML OAuth                         | ✅ Listo (dual-account, read-only production)           |
| OAuth dual Plasticov/Maustian    | ✅ Listo (apps separadas, tokens independientes)        |
| Refresh automático seller-scoped | ✅ Listo (con lock, métricas, error classification)     |
| Health por cuenta ML             | ✅ Listo (4 modos: inspect, refresh, smoke, no-network) |
| Smoke tests read-only            | ✅ Listo (identity + orders + items, sin mutaciones)    |
| Environment loader común         | ✅ Listo (sin symlink, funciona desde cualquier cwd)    |
| Escrituras ML                    | ❌ Bloqueadas (`assertMercadoLibreWriteDisabled()`)     |
| Ingesta real                     | ✅ Listo (feature-gated, infra completa)                |
| Ingesta económica durable         | ✅ Listo (UUID IDs, fail-closed, atomic tx, Evidence Store) |
| Ecommerce productivo             | ❌ Requiere credenciales Medusa + aprobación            |
| Canales sociales                 | 🔲 No implementado                                      |
| Expansión multicanal             | 🔲 No implementado                                      |

---

## Roadmap resumido

| Prioridad | Fase                                | Estado             |
| --------- | ----------------------------------- | ------------------ |
| P0        | Operational Truth & Production      | Completo (4/4 PRs) |
| P1        | Financial Truth & Economic Outcomes | Fundación completa |
| P2        | Full Product Launch Cycle           | Pendiente          |
| P3        | Social Growth                       | Pendiente          |
| P4        | Portfolio, Pricing, Inventory       | Pendiente          |
| P5        | Experimentation & Org Intelligence  | Pendiente          |
| P6        | Multichannel Expansion              | Pendiente          |

Ver [`ROADMAP.md`](ROADMAP.md) para el detalle completo con capacidades, dependencias, criterios de aceptación y riesgos de cada fase.

---

## Índice documental

| Documento                                                                                                | Tipo                 | Contenido                                         |
| -------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| [`docs/agent-enterprise-vision.md`](docs/agent-enterprise-vision.md)                                     | Canónico             | Visión de producto estable                        |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                                                     | Arquitectura actual  | Arquitectura implementada en HEAD                 |
| [`ROADMAP.md`](ROADMAP.md)                                                                               | Roadmap              | Capacidades pendientes y prioridades              |
| [`docs/PHILOSOPHY.md`](docs/PHILOSOPHY.md)                                                               | Filosofía            | Principios de ingeniería                          |
| [`docs/vps-deployment.md`](docs/vps-deployment.md)                                                       | Operación            | Guía de deploy en VPS                             |
| [`docs/production-secrets-setup.md`](docs/production-secrets-setup.md)                                   | Operación            | Configuración de secretos de producción           |
| [`docs/creative-studio-minimax-integration.md`](docs/creative-studio-minimax-integration.md)             | Diseño               | Integración MiniMax                               |
| [`docs/supplier-to-owned-ecommerce-cortex-bridge.md`](docs/supplier-to-owned-ecommerce-cortex-bridge.md) | Diseño               | Puente Supplier → Ecommerce                       |
| [`docs/supplier-mirror.md`](docs/supplier-mirror.md)                                                     | Diseño               | Supplier Mirror                                   |
| [`docs/architecture/`](docs/architecture/)                                                               | Diseño especializado | Documentos de arquitectura por componente         |
| [`docs/audits/`](docs/audits/)                                                                           | Auditoría            | Auditorías de arquitectura y runtime              |
| [`docs/propuesta-ceo-socio.md`](docs/propuesta-ceo-socio.md)                                             | Histórico            | Propuesta inicial (material superado)             |
| [`openspec/specs/`](openspec/specs/)                                                                     | Contratos vigentes   | Especificaciones activas (SDD)                    |
| [`openspec/changes/archive/`](openspec/changes/archive/)                                                 | Histórico            | Cambios completados (evidencia, no estado actual) |

---

## Licencia

MIT. Construido en Chile 🇨🇱.
