# Observaciones del Estado del Proyecto, Cuellos de Botella y Desconexiones Lógicas

> **Historical / superseded:** This document is a snapshot of an earlier project review. It is preserved for context only and does not describe the current operational state. Use `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`, and `docs/supplier-mirror.md` for current guidance.

Este documento recopila el análisis histórico del proyecto **MSL (Plasticov / Maustian AI Agent)**, detallando su nivel de madurez, cuellos de botella críticos (técnicos y operativos) y desconexiones lógicas entre sus componentes arquitectónicos al momento de la revisión original.

---

## 1. Resumen del Estado Actual

- **Estabilidad del Codebase:** Excelente. Toda la suite de pruebas unitarias e integración (**1071 pruebas en 41 archivos**) pasa de manera exitosa y sin fallas mediante Vitest.
- **Modelo de Dominio (`@msl/domain`):** Completamente implementado bajo una arquitectura hexagonal libre de efectos secundarios y I/O ([packages/domain/src](file:///home/sebastian/code/Msl/packages/domain/src)).
- **Base de Datos y Memoria (`@msl/memory`):** El motor Cortex (grafo neural con SQLite y CTEs recursivas para propagación Hebbiana/Darwiniana) está 100% operativo ([packages/memory/src](file:///home/sebastian/code/Msl/packages/memory/src)).
- **Interfaz del Agente (`@msl/agent`):** Implementa correctamente el bucle conversacional con validaciones de idioma (español), guardrails de seguridad, simulación de actores sombra y el motor de ingesta en segundo plano ([packages/agent/src](file:///home/sebastian/code/Msl/packages/agent/src)).
- **Canales de Presentación:**
  - **Consola Web (`apps/web`):** Panel interactivo Next.js 15 para simulación local determinista ([apps/web](file:///home/sebastian/code/Msl/apps/web)).
  - **Bot de Telegram (`@msl/bot`):** Desarrollado e integrado usando grammY. Incluye comandos básicos (`/start`, `/help`) y soporte para alertas proactivas ([packages/bot/src](file:///home/sebastian/code/Msl/packages/bot/src)).
- **Trabajo en Progreso (Pendiente):**
  - **Ingesta de Competencia de Catálogo:** Se encuentra planificada, diseñada y documentada bajo [operational-catalog-competition-ingestion](file:///home/sebastian/code/Msl/openspec/changes/operational-catalog-competition-ingestion/tasks.md) pero aún no está aplicada ni integrada en el flujo diario.
  - **Credenciales de Red:** Las comunicaciones reales con la API de MercadoLibre y la API de Telegram están en modo _stub_ (simulado). Para activarlas en producción, se requiere configurar las claves correspondientes en [.env.local](file:///home/sebastian/code/Msl/.env.local).

---

## 2. Cuellos de Botella Identificados

1.  **Límites de la API de MercadoLibre (Rate Limits):**
    - _Riesgo:_ Ingestas periódicas de detalles individuales por ítem (tales como `price_to_win` y `product-ads-insights`) para catálogos masivos pueden consumir la cuota de llamadas API rápidamente.
    - _Mitigación:_ Se implementa una rotación determinista de batches en base a la configuración `pricingMaxItemsPerCycle`, controlando el consumo de cuota por ciclo.
2.  **Costo de Tokens y Latencia del LLM (DeepSeek):**
    - _Riesgo:_ Alimentar al modelo con cientos de miles de tokens del catálogo en cada consulta hace que el sistema sea inviable en costos y tiempos de respuesta.
    - _Mitigación:_ Estructura de caché en 3 bloques (Fijo, Agregados diarios y subgrafo dinámico Cortex de 0.3-2K tokens) que reduce los costos de token y optimiza el KVCache.
3.  **Bloqueos del Event Loop de Node.js por I/O Síncrono:**
    - _Riesgo:_ El conector SQLite (`better-sqlite3`) es síncrono. Ingestas masivas periódicas de 5 entidades principales podrían bloquear el hilo de ejecución de Node.js, provocando latencia de respuesta en el Bot de Telegram.
4.  **Auto-Degradación del Nivel de Autonomía:**
    - _Riesgo:_ El motor de autonomía reduce automáticamente sus permisos de ejecución tras 3 desviaciones de KPI consecutivas. Esto congela la ejecución automatizada de sincronizaciones o precios hasta que el CEO intervenga manualmente para restaurar los permisos.

---

## 3. Desconexiones y Gaps Lógicos en la Arquitectura

1.  **Ejecución real parcial y todavía no orquestada extremo a extremo (The Mutation Gap):**
    - _Estado actual:_ `sync_product`, `prepare_mercadolibre_write`, `prepare_answer` y `prepare_image_orchestration` siguen siendo prepare-only por defecto. Sin embargo, `execute_sync_product` ya existe para ejecutar una propuesta `sync_product` aprobada mediante `publishItem`, con validación de aprobación, expiración, seller scope, drift guard sobre preview y snapshot del input de publicación, y reserva previa de `executionStatus=executed`.
    - _Pendiente:_ falta conectar ese execution path al flujo conversacional del agent loop/bot y persistir outcomes operativos después de publicar. Las demás capacidades mutadoras siguen sin ejecución física directa.
2.  **Stubs de Evidencias en MCP (`readinessEvidence`):**
    - _Problema:_ En el archivo de arranque [packages/mcp/src/runtimeDependencies.ts](file:///home/sebastian/code/Msl/packages/mcp/src/runtimeDependencies.ts), los métodos para validar la preparación de sincronizaciones están hardcodeados para retornar fallas de capacidades:
      ```typescript
      readinessEvidence: {
        readRollbackStrategyPresent: () => false,
        readApiCapabilityEvidence: () => "missing",
      }
      ```
      Esto provoca que `read_sync_product_execution_readiness` bloquee por falta de evidencia productiva aunque existan credenciales correctas. La herramienta ya no es una evidencia hardcodeada “sin ejecución posible”: ahora sirve como gate previo para `execute_sync_product`, pero sus providers productivos siguen pendientes.
3.  **Incongruencia entre Documentación y Código del Bot:**
    - _Problema:_ [ROADMAP.md](file:///home/sebastian/code/Msl/ROADMAP.md) documenta al bot de Telegram (`packages/bot/src/index.ts`) como un stub inútil de 28 líneas. Sin embargo, en el código real existe una suite grammY funcional de casi 400 líneas con almacenamiento SQLite e ingesta acoplada.
4.  **Dirección Única Restrictiva de Sincronización:**
    - _Problema:_ La sincronización de productos (`sync_product`) solo se permite desde el seller origen (Plasticov) hacia el seller destino (Maustian). Cualquier flujo inverso es bloqueado estáticamente por un error de dirección insegura (`unsafe-direction`), rompiendo la simetría comercial original de las cuentas paralelas.
5.  **Pérdida de Aprendizaje Darwiniano sin Persistencia Física:**
    - _Problema:_ El observador `escribano` calcula y propaga retroalimentación de decisiones (Darwinian feedback) al grafo Cortex. Si el entorno corre en memoria local (sin base de datos física SQLite configurada), este aprendizaje se evapora al detener el proceso, impidiendo que el agente retenga el aprendizaje acumulado ante las correcciones del CEO.
