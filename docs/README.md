# Documentación de MSL

Índice de la documentación del proyecto MSL — Empresa Agente Inteligente para el Comercio.

---

## Clasificación de documentos

### Canónico

Documentos que establecen la visión de producto estable y no deben divergir del estado actual del código sin una decisión explícita de cambio de dirección.

| Documento                                                    | Propósito                                    |
| ------------------------------------------------------------ | -------------------------------------------- |
| [`agent-enterprise-vision.md`](./agent-enterprise-vision.md) | Visión canónica estable de la empresa agente |

`agent-enterprise-vision.md` describe **lo que MSL debe ser** como producto: la organización objetivo, el modelo operativo, los principios de arquitectura, el ciclo de decisión y la economía de caché. Es el documento de referencia para evaluar si una decisión de diseño o implementación acerca o aleja a MSL de su visión de producto.

**Regla:** `agent-enterprise-vision.md` solo debe modificarse cuando cambia la visión de producto, no cuando cambia el código. El estado actual del código se documenta en `ARCHITECTURE.md`.

---

### Arquitectura actual

| Documento                                  | Propósito                                               |
| ------------------------------------------ | ------------------------------------------------------- |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | Arquitectura implementada en el commit actual de `main` |

`ARCHITECTURE.md` describe exclusivamente lo que está implementado en HEAD: paquetes, dependencias, daemon handlers, lane contracts, flujo de datos, decisiones de diseño verificables y límites de producción. Es un documento **derivado del código**, no de la visión. Debe regenerarse cuando la arquitectura cambia.

---

### Roadmap

| Documento                        | Propósito                                   |
| -------------------------------- | ------------------------------------------- |
| [`../ROADMAP.md`](../ROADMAP.md) | Capacidades pendientes, fases y prioridades |

`ROADMAP.md` describe lo que falta construir y en qué orden. Las fases están ordenadas por prioridad declarada: verdad operacional (P0), verdad financiera (P1), y así sucesivamente. Cada fase incluye propósito de negocio, dependencias, criterios de aceptación y riesgos.

---

### Introducción

| Documento                      | Propósito                                               |
| ------------------------------ | ------------------------------------------------------- |
| [`../README.md`](../README.md) | Introducción al proyecto, inicio rápido y estado actual |

`README.md` es la puerta de entrada para alguien que llega al repositorio por primera vez. Explica qué es MSL, qué funciona, qué no, cómo empezar y dónde encontrar más información.

---

### Operación

| Documento                                                                                                                          | Propósito                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`vps-deployment.md`](./vps-deployment.md)                                                                                         | Guía de deploy en VPS con PM2                                |
| [`production-secrets-setup.md`](./production-secrets-setup.md)                                                                     | Configuración de secretos para producción                    |
| [`operations/production-readiness-control-plane.md`](./operations/production-readiness-control-plane.md)                           | Production Readiness Control Plane (P0, PR 1/4)              |
| [`operations/mercadolibre-dual-account-production-connection.md`](./operations/mercadolibre-dual-account-production-connection.md) | MercadoLibre Dual-Account Production Connection (P0, PR 3/4) |
| [`operations/real-ingestion-economic-adapters.md`](./operations/real-ingestion-economic-adapters.md)                               | Real Ingestion & Economic Adapters (P0, PR 4/4) + Durability Hardening           |

Documentos orientados a la operación del sistema en producción: deploy, configuración, secretos y monitoreo.

---

### Diseño especializado

Documentos que detallan componentes específicos de la arquitectura, integraciones o flujos de diseño.

| Documento                                                                                                    | Componente                                      |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| [`architecture/multi-agent-evidence-responses.md`](./architecture/multi-agent-evidence-responses.md)         | Evidencia entre agentes                         |
| [`architecture/agent-work-sessions-cache.md`](./architecture/agent-work-sessions-cache.md)                   | Work Sessions y caché                           |
| [`architecture/financial-truth-foundation.md`](./architecture/financial-truth-foundation.md)                 | Financial Truth Foundation (P1, PR 1/3)         |
| [`architecture/finance-director-agent.md`](./architecture/finance-director-agent.md)                         | Finance Director Agent (P1, PR 2/3)             |
| [`architecture/cortex-economic-reinforcement-loop.md`](./architecture/cortex-economic-reinforcement-loop.md) | Cortex Economic Reinforcement Loop (P1, PR 3/3) |
| [`architecture/owned-ecommerce-deepseek-advisor.md`](./architecture/owned-ecommerce-deepseek-advisor.md)     | DeepSeek Merchandising Advisor                  |
| [`architecture/owned-ecommerce-intelligence.md`](./architecture/owned-ecommerce-intelligence.md)             | Owned Ecommerce Intelligence                    |
| [`architecture/ceo-account-brain-dashboard.md`](./architecture/ceo-account-brain-dashboard.md)               | Account Brain Dashboard                         |
| [`creative-studio-minimax-integration.md`](./creative-studio-minimax-integration.md)                         | Integración MiniMax (Creative Studio)           |
| [`supplier-to-owned-ecommerce-cortex-bridge.md`](./supplier-to-owned-ecommerce-cortex-bridge.md)             | Puente Supplier → Cortex → Ecommerce            |
| [`supplier-mirror.md`](./supplier-mirror.md)                                                                 | Supplier Mirror                                 |
| [`PHILOSOPHY.md`](./PHILOSOPHY.md)                                                                           | Filosofía de ingeniería                         |

---

### Análisis y auditoría

| Documento                                                                                                    | Tipo          | Fecha   |
| ------------------------------------------------------------------------------------------------------------ | ------------- | ------- |
| [`analisis-alineacion-roadmap-agentes-msl-2026.md`](./analisis-alineacion-roadmap-agentes-msl-2026.md)       | Análisis      | 2026    |
| [`analisis-arquitectonico.md`](./analisis-arquitectonico.md)                                                 | Análisis      | —       |
| [`auditoria-ml-api.md`](./auditoria-ml-api.md)                                                               | Auditoría     | —       |
| [`informe-ceo-supplier-mirror-deepseek-cache-2026.md`](./informe-ceo-supplier-mirror-deepseek-cache-2026.md) | Informe       | 2026    |
| [`observaciones.md`](./observaciones.md)                                                                     | Observaciones | —       |
| [`audits/account-assets-memory-addendum-2026-07.md`](./audits/account-assets-memory-addendum-2026-07.md)     | Auditoría     | 2026-07 |
| [`audits/agent-brain-runtime-audit-2026-07.md`](./audits/agent-brain-runtime-audit-2026-07.md)               | Auditoría     | 2026-07 |
| [`audits/agent-brain-runtime-checklist.json`](./audits/agent-brain-runtime-checklist.json)                   | Checklist     | 2026-07 |

---

### Histórico / archivado

Documentos que registran decisiones pasadas, propuestas iniciales o material que fue superado por la implementación actual. **No reflejan el estado actual del sistema.** Se conservan como evidencia histórica del proceso de diseño.

| Documento                                                         | Nota                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------- |
| [`propuesta-ceo-socio.md`](./propuesta-ceo-socio.md)              | Propuesta inicial del modelo CEO/Socio. Material superado. |
| [`../../openspec/changes/archive/`](../openspec/changes/archive/) | Cambios SDD completados. Evidencia histórica.              |

---

### Contratos vigentes

| Ruta                                       | Contenido                              |
| ------------------------------------------ | -------------------------------------- |
| [`../openspec/specs/`](../openspec/specs/) | Especificaciones activas del ciclo SDD |

Los contratos en `openspec/specs/` son la fuente de verdad para el comportamiento esperado del sistema. Son mantenidos por el ciclo SDD (propose → spec → design → tasks → apply → verify → archive).

---

## Cómo usar esta documentación

1. **¿Querés entender qué es MSL y hacia dónde va?** → Lee [`agent-enterprise-vision.md`](./agent-enterprise-vision.md).
2. **¿Querés entender cómo está construido hoy?** → Lee [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
3. **¿Querés saber qué falta construir?** → Lee [`../ROADMAP.md`](../ROADMAP.md).
4. **¿Querés correr el proyecto?** → Lee [`../README.md`](../README.md).
5. **¿Querés contribuir con código?** → Lee los contratos en [`../openspec/specs/`](../openspec/specs/) y los documentos de diseño en [`architecture/`](./architecture/).
6. **¿Querés ponerlo en producción?** → Lee [`vps-deployment.md`](./vps-deployment.md) y [`production-secrets-setup.md`](./production-secrets-setup.md).
7. **¿Querés entender una decisión pasada?** → Revisá los análisis, auditorías y el archivo histórico.
