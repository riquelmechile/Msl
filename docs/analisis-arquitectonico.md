# Análisis Arquitectónico MSL — Diagnóstico y Plan de Acción

> **Fecha:** 2026-07-02
> **Alcance:** Análisis completo de cuellos de botella, problemas de cohesión, desconexiones de base de datos y gaps agente↔LLM.
> **Referencia:** Reemplaza y extiende `docs/observaciones.md`.

---

## Resumen Ejecutivo

MSL tiene una **arquitectura sólida en el núcleo** (dominio hexagonal puro, suite de tests amplia, patrón de caché de 3 bloques para DeepSeek) pero todavía conserva desconexiones entre capas que limitan el salto a producción. Los problemas no son de diseño — son de **cableado**: componentes que existen pero no se conectan entre sí, stubs que simulan fallas, y 5-7 conexiones SQLite independientes que fragmentan la persistencia.

**El camino a producción no requiere refactors grandes — requiere conectar lo que ya está construido.**

---

## 1. Inventario de Componentes

| Componente                             | Estado       | Rol                                                                                                                 |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `@msl/domain`                          | ✅ 100%      | Tipos puros, sin I/O. Seller, Listing, Order, Stock, Approval, Audit                                                |
| `@msl/memory` (Cortex)                 | ✅ 100%      | Grafo neural SQLite con spreading activation, Hebbian, Darwinian                                                    |
| `@msl/memory` (Operational Read Model) | ✅ 100%      | Snapshots operativos con TTLs, checkpoints, 8 entity kinds                                                          |
| `@msl/agent` (Agent Loop)              | ✅ 100%      | Bucle conversacional, 30+ herramientas, guardrails, self-verify                                                     |
| `@msl/agent` (Escribano)               | ✅ 100%      | Observador Darwiniano, feedback +0.10/−0.15, persistencia de resultados                                             |
| `@msl/agent` (Autonomy Engine)         | ⚠️ Shell     | Lógica de degradación lista, KPIs hardcodeados a placeholders                                                       |
| `@msl/agent` (Strategy Store)          | ✅ 100%      | CRUD SQLite, pero desconectado del system prompt                                                                    |
| `@msl/mercadolibre` (OAuth)            | ✅ 100%      | Multi-account con encryptión AES-256-GCM, refresh token                                                             |
| `@msl/mercadolibre` (Sync Engine)      | ✅ 100%      | Extract→diff→apply→publish, con dirección restringida                                                               |
| `@msl/mcp`                             | ⚠️ 30+ tools | `execute_sync_product` existe para ejecución aprobada; quedan stubs/readiness y cableados productivos por completar |
| `@msl/bot` (Telegram)                  | ✅ 400 LOC   | grammY real, no es stub — pero crea agente por mensaje                                                              |
| `apps/web`                             | ✅           | Consola demo Next.js 15                                                                                             |

---

## 2. Los 7 Gaps Reales (con severidad y solución)

### GAP 1 — CRÍTICO: Mutation Gap (Preparar sin Ejecutar)

**Estado actual:** `execute_sync_product` ya existe en MCP y ejecuta una propuesta aprobada contra MercadoLibre. La ejecución valida binding de aprobación, expiración, dirección/cuenta en tiempo de ejecución y re-chequea tanto el preview exacto como el snapshot aprobado del input de publicación contra datos vivos antes de publicar. También reserva estado `executed` antes del publish para reducir reintentos duplicados si persiste mal el estado después.

**Qué falta:** cerrar el flujo conversacional completo de aprobación→ejecución desde el agent loop/bot, endurecer evidencia productiva de readiness y registrar outcomes operativos después de ejecutar.

**Dónde:**

- `packages/mcp/src/index.ts` — `execute_sync_product` implementado; aún conviene extraer validaciones de dominio.
- `packages/mcp/src/runtimeDependencies.ts` — `executeWrite` existe cuando el runtime OAuth/write está disponible.
- `packages/agent/src/conversation/agentLoop.ts` / bot — queda completar la orquestación conversacional de confirmación explícita.

**Solución:**

```
Fase A: execute_sync_product en MCP ✅ implementado
  1. Lee proposal del approval queue
  2. Valida approved + no expired + no executed + approval binding
  3. Revalida preview vivo y snapshot de publish input contra exactChange aprobado
  4. Reserva executionStatus=executed antes del publish
  5. Llama a executeWrite.publishItem(targetSellerId, newItem)

Fase B: Conectar al approval flow (pendiente)
  1. Después de approve_sync_product_proposal, el usuario dice "dale"
  2. Agent loop detecta confirmación → ejecuta execute_sync_product
  3. Escribano registra outcome en Cortex
```

**Archivos a modificar:** `agentLoop.ts` / bot (+execution path conversacional), `runtimeDependencies.ts` (+evidencia productiva de readiness), `mcp/src/index.ts` (solo hardening/extraer validaciones si se decide)

**Esfuerzo estimado:** 4-6 horas

---

### GAP 2 — PARCIALMENTE RESUELTO: readinessEvidence productivo incompleto

**Estado actual:** `readinessEvidence` ya no es un stub que siempre devuelve `missing`: `runtimeDependencies.ts` consulta capacidades reales del runtime OAuth/write y la configuración de estrategias disponibles. La herramienta `read_sync_product_execution_readiness` ahora sirve como gate previo a `execute_sync_product`.

**Qué falta:** endurecer la evidencia productiva para cubrir rollback operativo real, scopes/write capabilities con mayor granularidad, y señales de rate limit antes de ejecutar escrituras.

**Estado anterior:** El problema original era este stub:

```typescript
// packages/mcp/src/runtimeDependencies.ts
readinessEvidence: {
  readRollbackStrategyPresent: () => false,       // ← SIEMPRE false
  readApiCapabilityEvidence: () => "missing",     // ← SIEMPRE "missing"
}
```

Ese comportamiento ya fue reemplazado. Si hoy la readiness aparece bloqueada, debe interpretarse como una señal operativa del runtime/configuración, no como un stub permanente.

**Solución:**

```
1. readRollbackStrategyPresent(): profundizar la verificación de estrategias activas que sirvan como rollback operativo
   → Revisar strategyStore.listActive() y confirmar reversibilidad de margin/category/stock strategies

2. readApiCapabilityEvidence(): verificar que el OAuth token sea válido y tenga scopes write
   → oauthManager.ensureValidToken(sellerId) + verificar scope incluye "write"

3. (Bonus) Agregar check de rate limits: consultar headers X-RateLimit-Remaining
```

**Archivos a modificar:** `runtimeDependencies.ts`, `mcp/src/index.ts`

**Esfuerzo estimado:** 1-2 horas para hardening adicional

---

### GAP 3 — RESUELTO: Cortex Query Tool Registrado

**Estado actual:** `createGetBusinessContextTool(engine)` está implementado, exportado y registrado en el `toolMap` cuando `config.engine` existe.

**Dónde:** `packages/agent/src/conversation/agentLoop.ts` — `createAgentLoop()` registra `get_business_context` condicionalmente.

**Impacto restante:** La herramienta ya está disponible; falta asegurar que los prompts y flujos productivos la usen consistentemente antes de propuestas críticas.

**Implementado:**

```typescript
// En createAgentLoop(), toolMap construction:
if (config.engine && !toolMap.has("get_business_context")) {
  toolMap.set("get_business_context", createGetBusinessContextTool(config.engine));
}
```

**Archivos:** `agentLoop.ts`, `tools.ts`, `systemPrompt.ts`

---

### GAP 4 — ALTO: Agent ↔ Strategy Store Desconectados

**Qué pasa:** Cuando el CEO inserta/actualiza/archiva una estrategia vía conversación, el `strategyStore` se actualiza correctamente, pero `activeStrategies` (la variable que alimenta el system prompt) **no se refresca**. El LLM sigue viendo estrategias viejas.

**Dónde:** `agentLoop.ts` line 408 — `activeStrategies` se inicializa de `config.strategies` (array opcional), no del store.

**Solución:**

```typescript
// En getSystemPrompt(), cuando config.store existe:
function getActiveStrategies(): Strategy[] {
  if (config.store) {
    return config.store.listActive();
  }
  return activeStrategies; // fallback para tests/demo
}
```

**Archivos a modificar:** `agentLoop.ts`

**Esfuerzo estimado:** 30 minutos

---

### GAP 5 — MEDIO: Escribano con Ciclo de Vida Roto en Bot

**Qué pasa:** El bot de Telegram llama a `createAgentLoop(agentConfig)` **por cada mensaje**. Como `EscribanoObserver` se crea dentro y mantiene `#turnCount` y `#conceptCache` como estado de instancia, cada mensaje empieza con contadores en cero y caché vacía.

**Impacto:**

- El pruning Darwiniano (cada 10 turns, cada 50 turns) **nunca se ejecuta** porque ninguna instancia llega a 10 turns
- `#conceptCache` (Map de conceptos→node IDs) se reconstruye desde cero en cada mensaje → queries redundantes a SQLite
- `#businessNodeIds` (Set de IDs cacheados) se pierde → más queries redundantes

**Solución:**

```
Opción A (simple): Pasar turnCount como parámetro de estado persistente
  - Guardar turnCount en ConversationState
  - Escribano lo lee de state, no de instancia

Opción B (correcta): Reutilizar la instancia de AgentLoop entre mensajes
  - Mantener un Map<sessionId, AgentLoop> en el bot
  - Solo crear nueva instancia para sesiones nuevas
  - Esto además evita recrear el cliente DeepSeek por mensaje
```

**Archivos a modificar:** `bot/src/index.ts`, `escribano.ts`

**Esfuerzo estimado:** 1-2 horas (Opción A), 3-4 horas (Opción B)

---

### GAP 6 — MEDIO: Cortex ↔ Operational Read Model Aislados

**Qué pasa:** Son dos capas de datos completamente separadas sin puente entre ellas:

```
Background Ingestion → Operational Read Model (snapshots)
                      → NADIE LO LEE (no hay consumidor cableado)

Conversación → Cortex (grafo neural)
             → Escribano escribe resultados
             → get_business_context registrado cuando hay Cortex en config
```

**Solución:**

```
1. Cablear OperationalEvidenceProvider en el agent config del bot
   → agentConfig.evidenceProvider = createOperationalEvidenceProvider(readModel)

2. En getSystemPrompt() Block C (Dynamic):
   → Primero consultar operational read model (datos frescos, bajo costo)
   → Si no hay datos, fallback a Cortex (aprendizaje histórico)
   → Si no hay nada, informar "sin datos disponibles"

3. Hacer que Escribano también escriba snapshots al operational read model
   → Cuando un sync es exitoso, guardar listing snapshot
   → Cuando el CEO corrige una estrategia, guardar strategy change como evidencia
```

**Archivos a modificar:** `bot/src/index.ts`, `agentLoop.ts`, `systemPrompt.ts`, `escribano.ts`

**Esfuerzo estimado:** 4-6 horas

---

### GAP 7 — BAJO: KPIs de Autonomía Son Placeholders

**Qué pasa:** El agent loop registra KPIs hardcodeados:

```typescript
autonomyEngine.recordKpi(sellerId, {
  marginCompliance: 1, // ← siempre 1
  successRate: 1, // ← siempre 1
  safetyViolations: 0, // ← siempre 0
  responseAccuracy: 0, // ← siempre 0
});
```

La promoción de nivel requiere `responseAccuracy > 0.9` — **imposible** con el valor actual. La degradación (#2 y #3) nunca se dispara porque marginCompliance y successRate siempre son 1.

**Solución:**

```
Medir KPIs reales post-ejecución (después del GAP 1):
  - marginCompliance: ¿el precio publicado respeta el margen configurado?
  - successRate: ¿sync_product fue "published" vs "failed"?
  - responseAccuracy: ¿el CEO corrigió al agente? (detectar patrones de rechazo)
  - safetyViolations: ¿el agente propuso algo bloqueado por guardrails?

Implementar heurísticas simples:
  - Si el CEO dice "no" / "cancelar" / "así no" → responseAccuracy baja
  - Si sync_product resulta en "published" → successRate sube
  - Si el precio final difiere >5% de la estrategia → marginCompliance baja
```

**Archivos a modificar:** `agentLoop.ts`, `autonomyEngine.ts`

**Esfuerzo estimado:** 3-4 horas

---

## 3. Problemas de Cohesión (Hexagonal Architecture)

### 3.1 Fragmentación de Conexiones SQLite (5-7 conexiones independientes)

| Componente                              | Crea su propio DB? | Usa pool compartido? |
| --------------------------------------- | ------------------ | -------------------- |
| `createDatabase()` (Cortex)             | ✅ Sí              | ❌ No                |
| `createTokenStore()` (OAuth)            | ✅ Sí              | ❌ No                |
| `createSyncStore()`                     | ✅ Sí              | ❌ No                |
| `createSqliteApprovalQueueRepository()` | ✅ Sí              | ❌ No                |
| Bot: `new Database(sqlitePath)`         | ✅ Sí              | ❌ No                |
| Bot: `createGraphEngine(cortexPath)`    | ✅ Sí              | ❌ No                |
| `createStrategyStore(db)`               | ❌ Recibe          | ❌ No                |
| `createOperationalReadModel(db)`        | ❌ Recibe          | ❌ No                |

**El pool compartido existe** (`packages/memory/src/connectionPool.ts` con `getSharedDb()`) pero ningún componente de producción lo usa.

**Solución:**

```
1. Migrar todos los factories a aceptar Database | string
   → Si reciben string, usar getSharedDb(path)
   → Si reciben Database, usar ese (para tests)

2. Unificar paths de SQLite en el bot:
   → Un solo archivo .sqlite con ATTACH para cortex (o schemas separados)
   → MSL_SQLITE_PATH en vez de 3 variables separadas

3. Beneficio colateral: WAL compartido, menor overhead de locks,
   posibilidad de transacciones cross-store
```

**Esfuerzo estimado:** 3-4 horas

### 3.2 Lógica de Dominio en Capa de Infraestructura

**Qué pasa:** `packages/mcp/src/index.ts` contiene validaciones de negocio que deberían estar en `@msl/domain`:

- `isSupportedSyncProductProposal()` — validación de proposal
- `validateSellerAccountScope()` — scope de cuenta
- `buildSyncProductPreview()` — lógica de preview
- `findExactChangeMatch()` — comparación de cambios

**Solución:** Extraer a `@msl/domain/src/syncValidation.ts` y `@msl/domain/src/syncPreview.ts`

**Esfuerzo estimado:** 1-2 horas

### 3.3 Dos Paradigmas de Agente Compitiendo

**Qué pasa:** `answerBusinessQuestion()` (línea 200 de `agent/src/index.ts`) es un motor determinista que compite con `createAgentLoop()`. Comparten tipos pero usan paths de ejecución completamente diferentes.

**Solución:** Deprecar `answerBusinessQuestion()` y unificar todo bajo `createAgentLoop()` con mock client para tests.

**Esfuerzo estimado:** 1 hora

---

## 4. Cuellos de Botella Técnicos (Medibles, No Teóricos)

### 4.1 JSON_EXTRACT sin Índices en Cortex

`queryByMetadata()` construye queries con `WHERE JSON_EXTRACT(metadata, '$.type') = ?`. SQLite no indexa paths JSON sin columnas virtuales. Cada query operacional hace full table scan.

**Solución:** Agregar columnas virtuales generadas en la migración v2:

```sql
ALTER TABLE nodes ADD COLUMN node_type TEXT
  GENERATED ALWAYS AS (json_extract(metadata, '$.type')) VIRTUAL;
CREATE INDEX idx_nodes_type ON nodes(node_type);
```

**Esfuerzo estimado:** 30 minutos

### 4.2 Cliente DeepSeek Recreado por Mensaje

El bot crea `createDeepSeekClient()` → `new OpenAI()` por cada mensaje, perdiendo reutilización de conexiones HTTP.

**Solución:** Se arregla con el GAP 5 (reutilizar instancia de AgentLoop).

### 4.3 MCP Server: 3 Stubs Hardcodeados

`check_account`, `list_strategies`, `consult_cortex` en `mcp/src/index.ts` devuelven datos mock:

```typescript
// check_account → { level: "platinum", status: "active" }
// list_strategies → { strategies: [], count: 0 }
// consult_cortex → { status: "ok", tool: "consult_cortex" }
```

**Solución:** Cablear con las dependencias reales (mlClient, strategyStore, cortex engine) cuando estén disponibles en el runtime.

**Esfuerzo estimado:** 1-2 horas

---

## 5. Plan de Acción Priorizado

### 🔴 Bloqueantes (no se puede llegar a producción sin esto)

| #   | Gap                                                                                  | Esfuerzo | Depende de |
| --- | ------------------------------------------------------------------------------------ | -------- | ---------- |
| 1   | Endurecer `readinessEvidence` productivo                                             | 1-2h     | —          |
| 2   | Registrar `get_business_context` en toolMap                                          | ✅ Hecho | —          |
| 3   | Sincronizar `activeStrategies` con strategyStore                                     | 30min    | —          |
| 4   | Conectar `execute_sync_product` al flujo conversacional y seguir endureciendo guards | 4-6h     | #1         |
| 5   | Conectar credenciales ML reales (7h del roadmap)                                     | 2-3h     | —          |

### 🟡 Alta Prioridad (degrada calidad pero no bloquea)

| #   | Gap                                      | Esfuerzo | Depende de |
| --- | ---------------------------------------- | -------- | ---------- |
| 6   | Arreglar ciclo de vida Escribano en bot  | 1-2h     | —          |
| 7   | Puentear Cortex ↔ Operational Read Model | 4-6h     | #2         |
| 8   | Unificar conexiones SQLite (shared pool) | 3-4h     | —          |
| 9   | Reutilizar instancia AgentLoop en bot    | 2-3h     | #6         |

### 🟢 Baja Prioridad (mejora pero no es urgente)

| #   | Gap                                        | Esfuerzo | Depende de   |
| --- | ------------------------------------------ | -------- | ------------ |
| 10  | Implementar KPIs de autonomía reales       | 3-4h     | #4           |
| 11  | Índices JSON en Cortex (migración v2)      | 30min    | —            |
| 12  | Cablear stubs de MCP (check_account, etc.) | 1-2h     | credenciales |
| 13  | Extraer lógica de dominio del MCP          | 1-2h     | —            |
| 14  | Deprecar answerBusinessQuestion()          | 1h       | —            |

---

## 6. Comparación con observaciones.md

| Aspecto                        | observaciones.md | Este análisis                                 |
| ------------------------------ | ---------------- | --------------------------------------------- |
| Gaps identificados             | 5                | 14 (7 gaps + 7 issues de cohesión/bottleneck) |
| Causa raíz por gap             | No               | Sí — cada gap tiene root cause analysis       |
| Solución concreta              | No               | Sí — cada gap tiene plan de implementación    |
| Esfuerzo estimado              | No               | Sí — horas por tarea                          |
| Priorización                   | No               | Sí — 3 tiers con dependencias                 |
| Análisis de DB connections     | No               | Sí — inventario de 8 conexiones               |
| Análisis de cohesión hexagonal | No               | Sí — 3 violaciones identificadas              |
| Cuellos de botella             | 4 (2 teóricos)   | 3 (todos medibles y concretos)                |

---

## 7. Conclusión

MSL está **mucho más cerca de producción** de lo que parece. No es un proyecto que necesite ser reescrito — es un proyecto que necesita ser **cableado**. Las piezas existen, los tests pasan, la arquitectura es sólida. Lo que falta es conectar los componentes entre sí y reemplazar 4 stubs por implementaciones reales.

El camino recomendado: ejecutar los 5 items bloqueantes en orden (∼10-12 horas de trabajo), luego los de alta prioridad (∼10-15 horas). Con eso, el sistema publica productos reales en MercadoLibre Chile desde Telegram.
