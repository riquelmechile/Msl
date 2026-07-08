# Análisis de Alineación y Roadmap: Visión de Agentes MSL (2026)

> Estado actualizado: 2026-07-07 (ROADMAP COMPLETADO)  
> Repo verificado: `riquelmechile/Msl`  
> Propósito: contrastar la visión original de agentes MSL contra el estado real del código actualizado y dejar claro qué falta implementar.

## 🟢 ROADMAP COMPLETADO — 2026-07-07

Los 7 PRs del roadmap de agentes fueron implementados en una sola sesión SDD:

| PR  | Cambio                        | Estado                               | Commit    |
| --- | ----------------------------- | ------------------------------------ | --------- |
| 1   | `agent-message-bus`           | ✅ Archivado                         | `0ddeaa5` |
| 2   | `specialist-daemon-scheduler` | ✅ Archivado                         | `7be4400` |
| 3   | `deep-evidence-provider`      | ✅ Archivado                         | `0b0045b` |
| 4   | `quality-relist-integration`  | ✅ Absorbido por marketCatalogDaemon | `7be4400` |
| 5   | `agent-consensus-review`      | ✅ Archivado                         | `56e9d05` |
| 6   | `process-separation`          | ✅ Implementado                      | `637fce5` |
| 7   | `roadmap-docs`                | ✅ Este documento                    | —         |

### Lo que cambió

MSL pasó de ser un asistente CEO→tool a una **empresa interna de agentes vivos**:

```
Antes:  Usuario → CEO AgentLoop → tools síncronas / background ingestion central

Ahora:  Usuario → CEO
               → agent_message_bus (SQLite queue)
               → AgentDaemonScheduler (4 daemons autónomos)
               → deep evidence (searchSnapshots con 10 filtros)
               → consensus review (quorum multi-agente)
               → procesos separados (bot / web / worker / daemons)
               → propuesta al CEO → ejecución approval-gated con "dale"
```

### Nuevos specs creados

- `agent-message-bus` — cola de mensajes interna
- `daemon-scheduler` — scheduler de daemons autónomos
- `specialist-daemons` — 4 daemons especialistas (marketCatalog, operationsManager, costSupplier, creativeCommercial)
- `deep-evidence-query` — búsqueda profunda de snapshots operacionales
- `agent-consensus` — revisión multi-agente con quorum
- `multi-agent-orchestration` — orquestación actualizada
- `operational-lane-evidence` — evidencia estructurada por lane

### Métricas finales

- **1580 tests** pasando en 61 archivos
- **9 commits** en main
- **7 specs** creados/actualizados en OpenSpec
- **5 cambios** archivados con SDD completo
- **0 dependencias nuevas** de npm

---

## Veredicto ejecutivo (original, preservado para contexto histórico)

El informe original sigue siendo correcto como visión, pero debe actualizarse: MSL ya no está bloqueado por falta de credenciales ni por ingesta base. El repo ya contiene un núcleo operacional fuerte:

- OAuth multi-seller para Plasticov y Maustian a nivel de runtime.
- Bot Telegram CEO con `AgentLoop` persistente.
- Cortex como memoria neuronal SQLite.
- Operational Read Model con snapshots en `data_json`.
- Background ingestion multi-seller.
- Company Agents durables.
- Skill Registry.
- Workforce Cost/Cache Ledger.
- Tools reales de MercadoLibre, catálogo, precios, calidad, reclamos, imágenes, publicaciones y sincronización.

El cuello de botella real ahora es otro: falta convertir estas piezas en una empresa interna de agentes vivos. El repo todavía funciona principalmente como:

```text
Usuario → CEO AgentLoop → tools síncronas / background ingestion central
```

La visión objetivo es:

```text
Usuario → CEO
        → agent_message_bus
        → daemons especialistas
        → deep operational evidence
        → consenso/revisión
        → propuesta al CEO
        → ejecución approval-gated con "dale"
```

## Cambios del informe que ya están implementados o parcialmente implementados

| Área del informe                     | Estado actual                                                                                    | Evidencia en repo                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Ingesta operacional MercadoLibre     | Implementada y avanzada                                                                          | `packages/agent/src/conversation/backgroundIngestion.ts`    |
| Multi-seller Plasticov/Maustian      | Implementado en runtime OAuth y background ingestion                                             | `packages/bot/src/index.ts`, commits OAuth multi-seller     |
| Cortex como memoria neuronal         | Implementado                                                                                     | `packages/memory/src/cortex/engine.ts`                      |
| Spreading activation                 | Implementado                                                                                     | `GraphEngine.spreadActivation()`                            |
| Hebbian reinforcement / penalization | Implementado                                                                                     | `GraphEngine.reinforceEdge()`, `GraphEngine.penalizeEdge()` |
| Darwinian pruning                    | Implementado                                                                                     | `GraphEngine.prune()`                                       |
| Operational Read Model               | Implementado                                                                                     | `packages/memory/src/operationalReadModel.ts`               |
| Dual-write Operational DB + Cortex   | Implementado en listings, claims, questions, messages, reputation, product ads, pricing y orders | `backgroundIngestion.ts`                                    |
| Product Ads evidence-only            | Implementado                                                                                     | `processSellerProductAds()`                                 |
| Pricing competition snapshots        | Implementado con batch rotativo                                                                  | `processSellerPricing()`                                    |
| Company Agent Registry               | Implementado                                                                                     | `packages/agent/src/conversation/companyAgentStore.ts`      |
| Agent Skill Registry                 | Implementado                                                                                     | `packages/agent/src/conversation/companyAgentSkillStore.ts` |
| Agent lessons / workforce context    | Implementado parcialmente                                                                        | `agentLoop.ts`, learning store/tools                        |
| CEO-only Telegram UX                 | Implementado                                                                                     | `packages/bot/src/index.ts`, `agentLoop.ts`                 |
| Delegación a subagentes              | Parcial: existe como tool proposal-only                                                          | `createDelegateToSubagentTool()`                            |
| Herramientas reales MercadoLibre     | Implementado ampliamente                                                                         | `agentLoop.ts`, `syncTools.ts`                              |
| Quality checks                       | Existe función, falta integrarla al ciclo principal                                              | `runQualityChecks()`                                        |
| Relist opportunities                 | Existe función, falta integrarla al ciclo principal                                              | `runRelistChecks()`                                         |

## Corrección importante sobre credenciales

El informe/roadmap antiguo puede seguir diciendo que faltan credenciales MercadoLibre. Eso ya no debe tratarse como bloqueo principal.

Estado corregido:

```text
OAuth multi-seller:
✅ Código y runtime soportan credenciales reales multi-seller.
✅ Bot usa OAuth DB SQLite en vez de depender de MERCADOLIBRE_ACCESS_TOKEN legacy.
✅ Plasticov y Maustian pueden tener apps/tokens separados.
✅ MLC client y ML write client se inyectan al AgentLoop cuando el runtime está configurado.
⚠️ El repo no permite verificar secrets ni tokens vigentes. La validación final debe hacerse con logs/runtime.
```

La validación operativa debe ser:

```bash
pm2 logs msl-telegram-bot --lines 100
```

Buscar que no aparezcan errores como:

```text
stub mode
OAuth not configured
Legacy MERCADOLIBRE_ACCESS_TOKEN is set but MSL_MERCADOLIBRE_OAUTH_DB_PATH is not
```

Y probar desde Telegram:

```text
Revisa mi cuenta Plasticov y dime reputación, publicaciones activas y ventas recientes.
```

Si responde con datos reales, el estado debe marcarse como:

```text
🟢 OAuth operativo en runtime.
```

## Cambios del informe que ya fueron implementados (actualizado 2026-07-07)

> 🟢 **TODOS los ítems de esta sección fueron completados en la sesión del 2026-07-07.**  
> Ver commits `0ddeaa5` a `637fce5` en `riquelmechile/Msl`.

### 1. Agent Message Bus ✅

Estado: no implementado.

No aparece una implementación real de `agent_message_bus`, `message bus`, `AgentDaemonScheduler` o equivalente. La delegación actual ocurre como tool síncrona (`delegate_to_subagent`) y devuelve `proposal-only`; no crea trabajo persistente para otro agente.

Falta crear una tabla/cola interna:

```sql
CREATE TABLE IF NOT EXISTS agent_message_bus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL UNIQUE,
  sender_agent_id TEXT NOT NULL,
  receiver_agent_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  locked_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_message_bus_status_priority
  ON agent_message_bus(status, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_message_bus_receiver_status
  ON agent_message_bus(receiver_agent_id, status, created_at);
```

Estados sugeridos:

```text
pending → processing → resolved
pending → processing → failed
pending → cancelled
pending → expired
```

API mínima requerida:

```ts
type AgentMessageBusStore = {
  enqueue(input: EnqueueAgentMessageInput): AgentMessage;
  claimNext(receiverAgentId: string, options?: { limit?: number }): AgentMessage[];
  resolve(messageId: string, result: unknown): void;
  fail(messageId: string, error: string): void;
  cancel(messageId: string, reason: string): void;
};
```

### 2. AgentDaemonScheduler

Estado: no implementado.

El repo tiene `backgroundIngestion`, pero eso es un worker centralizado. No existen daemons por agente especialista que despierten, lean mensajes, investiguen y respondan.

Falta crear:

```text
packages/agent/src/workers/agentDaemonScheduler.ts
packages/agent/src/workers/marketCatalogDaemon.ts
packages/agent/src/workers/costSupplierDaemon.ts
packages/agent/src/workers/operationsManagerDaemon.ts
packages/agent/src/workers/creativeCommercialDaemon.ts
```

Responsabilidad del scheduler:

1. Correr cada X minutos.
2. Leer mensajes `pending` por agente.
3. Bloquear mensaje (`processing`, `locked_at`).
4. Ejecutar daemon correspondiente.
5. Guardar respuesta en el bus.
6. Escalar al CEO/Telegram si hay oportunidad accionable.
7. No ejecutar mutaciones externas sin aprobación explícita.

### 3. Daemons especialistas vivos

Estado: no implementado.

Existen lanes, company agents y tools, pero no agentes vivos. Los agentes no se despiertan solos ni trabajan sobre colas.

Daemons prioritarios:

#### `marketCatalogDaemon`

Debe detectar:

- Publicaciones activas con baja visita.
- Publicaciones con precio fuera de mercado.
- Productos con `priceToWin` disponible.
- Publicaciones pausadas/cerradas con historial.
- Diferencias Plasticov ↔ Maustian.
- Oportunidades de calidad/listing score.

#### `operationsManagerDaemon`

Debe detectar:

- Reclamos nuevos.
- Preguntas sin responder.
- Mensajes críticos.
- Órdenes con demora.
- Riesgos de reputación.
- Envíos problemáticos.

#### `costSupplierDaemon`

Debe detectar:

- Productos con margen insuficiente.
- Cambios de costo/proveedor.
- Oportunidad de reposición.
- Diferencias entre costo, comisión, envío, ads y utilidad.

#### `creativeCommercialDaemon`

Debe detectar:

- Productos buenos para contenido diario.
- Productos con stock quieto.
- Productos con visitas pero baja conversión.
- Propuestas de copy, foto, reel, publicación y campaña.

### 4. Deep Evidence Provider

Estado: parcialmente implementado.

`OperationalReadModel` ya guarda snapshots completos en `data_json`, y tiene `readSnapshot()` / `listSnapshots()`. Pero `OperationalEvidenceProvider` actualmente solo inyecta líneas compactas con `evidenceId`, `kind`, `capturedAt`, `freshness` y `completeness`. Eso sirve como referencia, pero no basta para que los agentes tomen decisiones profundas.

Falta extenderlo con consultas estructuradas:

```ts
type SearchSnapshotsFilter = {
  sellerId: string;
  kind: string;
  status?: string;
  categoryId?: string;
  itemId?: string;
  priceMin?: number;
  priceMax?: number;
  capturedAfter?: string;
  capturedBefore?: string;
  freshness?: "fresh" | "allow-stale-with-warning";
  limit?: number;
};
```

Y exponer métodos tipo:

```ts
searchSnapshots<TData>(filter: SearchSnapshotsFilter): Promise<Array<{
  itemId: string;
  data: TData;
  capturedAt: string;
  freshness: string;
  evidenceId: string;
}>>;
```

Objetivo: que el agente pueda razonar con datos reales, no solo con IDs de evidencia.

Ejemplos de preguntas que debe soportar:

```text
Dame publicaciones activas de Plasticov con baja visita.
Dame pricing snapshots donde priceToWin sea menor al precio actual.
Dame reclamos abiertos de Maustian capturados en las últimas 2 horas.
Dame preguntas sin responder por seller.
Dame publicaciones pausadas con ventas/visitas históricas.
```

### 5. Integrar Quality Checks al worker real

Estado: función existe, pero no se ejecuta en el ciclo principal.

`runQualityChecks()` existe y consulta `getItemPerformance`, persiste `quality_snapshot` y genera alertas por score bajo o caída de score. Pero está aislada y marcada para evitar unused (`void runQualityChecks`).

Falta:

- Ejecutarla como fase real dentro de `startBackgroundIngestion()`; o
- Convertirla en `marketCatalogDaemon`.

Recomendación: moverla a daemon especialista, porque calidad de publicación es trabajo de mercado/catálogo.

### 6. Integrar Relist Checks al worker real

Estado: función existe, pero no se ejecuta en el ciclo principal.

`runRelistChecks()` detecta publicaciones cerradas/pausadas con historial y oportunidades de relist, pero también está aislada (`void runRelistChecks`).

Falta:

- Ejecutarla dentro de `startBackgroundIngestion()`; o
- Convertirla en `marketCatalogDaemon`.

Recomendación: convertirla en daemon para que pueda crear mensajes internos como:

```text
market-catalog → ceo:
MLCxxxx vence en 5 días para relist. Tiene visitas/historial. Propuesta: republicar con nuevo precio.
```

### 7. Comunicación agente ↔ agente

Estado: no implementado.

El informe apunta a una arquitectura donde los agentes pueden comunicarse como una empresa. Hoy la comunicación es principalmente CEO → tool.

Falta que un agente pueda pedirle trabajo a otro:

```text
operations-manager → cost-supplier:
Necesito margen estimado para esta orden con reclamo antes de proponer compensación.
```

```text
market-catalog → creative-commercial:
Este producto tiene visitas altas y baja conversión; genera propuesta de título/fotos/copy.
```

Esto depende directamente del `agent_message_bus`.

### 8. Consenso / debate entre agentes

Estado: no implementado.

No aparece mecanismo de `consensus`, `debate`, `quorum`, `agent_vote` o revisión entre agentes.

Falta especialmente para acciones de riesgo medio/alto:

- Cambios de precio masivos.
- Publicar productos nuevos.
- Pausar/cerrar publicaciones.
- Subir presupuesto de Product Ads.
- Sincronizar Plasticov → Maustian.
- Enviar respuestas sensibles a reclamos.

Diseño sugerido:

```sql
CREATE TABLE IF NOT EXISTS agent_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL,
  reviewer_agent_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Veredictos:

```text
approve
reject
needs_more_evidence
risk_warning
```

### 9. Antibloqueo SQLite / Event Loop

Estado: no verificado como implementado.

No aparece evidencia clara de:

- `PRAGMA journal_mode=WAL`.
- `PRAGMA busy_timeout`.
- Worker thread/process separado para ingesta pesada.
- Daemons fuera del event loop principal del bot.

Falta antes de correr varios daemons:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Y separar procesos:

```text
msl-telegram-bot
msl-web
msl-worker-ingestion
msl-agent-daemons
```

### 10. Roadmap/docs actualizados

Estado: parcialmente desactualizado.

Algunos documentos históricos siguen diciendo que ciertas piezas faltan o que las credenciales no están listas. Este documento debe ser la referencia actual para el roadmap de agentes.

## Prioridad recomendada de implementación

### PR 1 — `agent-message-bus`

Objetivo: crear el sistema nervioso interno.

Checklist:

- [ ] Crear store SQLite `agentMessageBusStore.ts`.
- [ ] Crear migración de tabla `agent_message_bus`.
- [ ] Agregar tests de enqueue/claim/resolve/fail/cancel.
- [ ] Agregar locking seguro para evitar doble procesamiento.
- [ ] Agregar `dedupe_key`.
- [ ] Agregar límites de retry.
- [ ] Exportar desde `packages/agent/src/index.ts`.

Criterio de aceptación:

```text
Un agente puede dejar un mensaje persistente para otro agente, otro agente puede reclamarlo, procesarlo y guardar resultado sin perder trazabilidad.
```

### PR 2 — `specialist-daemon-scheduler`

Objetivo: agentes internos vivos.

Checklist:

- [ ] Crear `AgentDaemonScheduler`.
- [ ] Crear `marketCatalogDaemon`.
- [ ] Crear `operationsManagerDaemon`.
- [ ] Usar `agent_message_bus` como input/output.
- [ ] Mantener `noMutationExecuted: true` por defecto.
- [ ] Escalar al CEO solo cuando haya acción clara.
- [ ] Tests con mensajes pendientes y resultados.

Criterio de aceptación:

```text
El daemon market-catalog puede leer evidencia operacional, detectar una oportunidad y crear una propuesta interna para el CEO sin intervención del usuario.
```

### PR 3 — `deep-evidence-provider`

Objetivo: evidencia operacional real para decisiones.

Checklist:

- [ ] Extender `OperationalReadModelReader` con filtros profundos.
- [ ] Agregar `searchSnapshots()`.
- [ ] Agregar filtros por status, categoryId, itemId, precio, fecha y freshness.
- [ ] Hacer que `OperationalEvidenceProvider` pueda devolver evidencia estructurada.
- [ ] Integrar con lanes/agentes.
- [ ] Tests con snapshots reales en `data_json`.

Criterio de aceptación:

```text
Un agente puede pedir publicaciones activas, pricing snapshots o reclamos abiertos y recibir los datos concretos, no solo evidence IDs.
```

### PR 4 — `quality-relist-daemon-integration`

Objetivo: activar fases ya escritas.

Checklist:

- [ ] Mover o invocar `runQualityChecks()` desde flujo real.
- [ ] Mover o invocar `runRelistChecks()` desde flujo real.
- [ ] Generar mensajes al bus en vez de solo alerts locales.
- [ ] Crear proposals CEO-facing.
- [ ] Tests de baja calidad y relist venciendo.

Criterio de aceptación:

```text
MSL detecta una publicación con bajo score o una oportunidad de relist y genera una propuesta accionable al CEO.
```

### PR 5 — `agent-consensus-review`

Objetivo: evitar decisiones unilaterales peligrosas.

Checklist:

- [ ] Crear `agent_reviews`.
- [ ] Permitir revisión por 2+ agentes.
- [ ] Agregar veredictos `approve/reject/needs_more_evidence/risk_warning`.
- [ ] Integrar con propuestas de precio, ads, publicación y sync.
- [ ] Mostrar resumen de consenso al CEO.

Criterio de aceptación:

```text
Antes de una acción importante, el CEO puede ver qué agentes aprobaron, rechazaron o pidieron más evidencia, con justificación.
```

## Roadmap corregido

Antes el roadmap podía interpretarse como:

```text
1. Configurar credenciales MercadoLibre.
2. Crear ingesta.
3. Crear agentes.
```

Ahora debe ser:

```text
1. Validar runtime vivo con tokens reales.
2. Crear agent_message_bus.
3. Crear daemons especialistas.
4. Extender deep evidence.
5. Integrar quality/relist.
6. Agregar consenso entre agentes.
7. Separar procesos worker/bot para escalar sin bloquear Telegram.
```

## Dictamen final (actualizado 2026-07-07)

MSL completó la transición de "asistente con tools" a **"empresa de agentes"**. El sistema nervioso interno está implementado:

```text
✅ agent_message_bus       → SQLite message queue con claim/resolve/fail/cancel
✅ daemons especialistas    → 4 daemons autónomos (marketCatalog, operationsManager, costSupplier, creativeCommercial)
✅ deep evidence provider   → searchSnapshots() con 10 filtros SQL-level
✅ consensus review         → agent_reviews con quorum multi-agente
✅ worker runtime separado  → 4 procesos PM2 (bot, web, worker-ingestion, agent-daemons)
✅ busy_timeout = 5000      → connection pool configurado
```

**MSL ahora opera como una empresa interna de agentes vivos.** El CEO recibe propuestas revisadas por consenso multi-agente, respaldadas por evidencia operacional profunda, con aprobación explícita ("dale") antes de cualquier mutación externa.

Próximos pasos: runtime validation con tokens reales, monitoreo de daemons en producción, y expansión del catálogo de agentes especialistas.
