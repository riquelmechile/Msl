# Propuesta por Fases: Sistema Jerárquico CEO-Socio

> **Estado:** Documento histórico/propuesta. No describe completamente la capacidad actual del repositorio. El estado vigente está en `README.md`, `ARCHITECTURE.md`, `ROADMAP.md` y `docs/agent-enterprise-vision.md`.
>
> **Realidad actual:** MSL ya tiene un kernel inicial de fuerza laboral AI: registro durable de company agents, store durable de lecciones, herramientas CEO/admin autorizadas para crear/listar agentes y registrar/listar lecciones, y un bloque `## Workforce Lessons` acotado que se inyecta solo para agentes explícitos y activos. Aún no existe un ciclo de vida autónomo completo de departamentos/managers, ni ejecución productiva amplia por Telegram.

Para hacer realidad tu visión de manera segura y eficiente, estructuraremos la implementación en **4 fases incrementales**.

Dado que el monorepo ya cuenta con las bases del bot de Telegram (`@msl/bot`), la base de datos neural (`@msl/memory` / Cortex), y las estructuras de campañas creativas (`@msl/workers/src/creative`), usaremos esta infraestructura existente para dar vida al rol del **CEO Virtual** y sus subagentes.

---

## Fase 1: Creación del Motor de Delegación y el Rol del CEO (Telegram)

En esta fase establecemos la jerarquía. El bot de Telegram principal pasa de ser un asistente pasivo a actuar como el **CEO/Socio Co-propietario** que lidera a los subagentes.

- **Objetivo:** Implementar la infraestructura para que el agente principal de conversación pueda delegar tareas.
- **Acciones en el Código:**
  1. **Evidencia de Especialización:** Modificar `packages/domain/src/specializationEvidence.ts` para rastrear flujos de trabajo sobre `"social_media"` y `"web_ecommerce"`.
  2. **Tool de Delegación:** Crear la herramienta `delegate_to_subagent` en `tools.ts` (`@msl/agent`).
  3. **Comportamiento del CEO:** Ajustar el prompt de sistema en `packages/bot/src/index.ts` para que el agente asuma un tono proactivo de "Socio Comercial". En lugar de solo responder tus dudas, usará el worker de analítica diariamente para encontrar oportunidades y proponértelas.

---

## Fase 2: Proactividad Creativa y Publicación Diaria (Social Media)

Aquí aprovechamos la data real de tus cuentas de MercadoLibre (que ya se ingesta en Cortex cada 6 horas) para generar contenido estratégico sin saturar las redes.

- **Objetivo:** Generar propuestas de publicación diarias (Instagram/TikTok/Telegram) enfocadas en un producto seleccionado de tus cuentas existentes.
- **Acciones en el Código:**
  1. **Integración con Ingesta:** Extender el worker creativo en `packages/workers/src/creative/index.ts` para que busque en Cortex:
     - Productos con alto stock y bajas ventas (para liquidar).
     - Productos estrella con excelente conversión (para amplificar).
  2. **Estrategia "Goteo" (Drip Posting):** El subagente creativo selecciona de forma autónoma **un único producto al día** y genera un borrador publicitario completo (guion para Reels/TikTok, copy optimizado para Chile y hashtags).
  3. **Propuesta por Telegram (Proactiva):** Usando `sendProactiveMessage` en `@msl/bot`, el CEO te escribirá por Telegram por la mañana:
     > _"Sebastian, analicé el stock y detecté que el producto [X] tiene 30 unidades sin movimiento. El subagente creativo generó esta propuesta para publicar en Instagram hoy: [Texto del post]. ¿Damos el visto bueno? responde **'dale'**."_
  4. **Aprobación y Cola:** Cuando dices _"dale"_, la acción pasa de `draft` a `approved` en la base de datos de auditoría de `@msl/tools`.

---

## Fase 3: Scaffolding de la Web y Sincronización Selectiva (E-commerce)

El subagente constructor automatiza la creación del sitio web e inyecta la pasarela de pagos.

- **Objetivo:** Autogenerar la estructura de la web (Medusa.js v2 + Next.js) y sincronizar productos seleccionados de MercadoLibre.
- **Acciones en el Código:**
  1. **Scaffolding de Aplicaciones:** Añadir en el monorepo las carpetas `apps/storefront` (Next.js) y `apps/medusa` (Medusa.js backend).
  2. **Filtro de Catálogo (No publicar todo de una):** Desarrollar en `@msl/mercadolibre` el conector de sincronización selectiva. El CEO decidirá qué productos merecen estar en la web (por ejemplo, solo aquellos con más de 10 ventas y calificación mayor a 4.5 estrellas en MercadoLibre). El subagente web se encargará de migrar sus fotos, variaciones y precios.
  3. **Integración de Pasarela de Pago:** Crear el controlador en la tienda Next.js usando la API oficial de **Mercado Pago Chile** para procesar Webpay Plus y pagos con tarjeta.

---

## Fase 4: Producción, Automatización Completa y Regulaciones

Pasamos de simulaciones y entornos locales a la automatización productiva real.

- **Objetivo:** Conectar las APIs de producción de redes sociales, pasarelas de pago y sincronización en tiempo real.
- **Acciones en el Código:**
  1. **Publicación Directa en Redes:** Configurar las llamadas HTTP autenticadas con la **Meta Graph API (Instagram)** y la **TikTok Content Posting API** para que, cuando digas _"dale"_ en Telegram, el contenido se publique en vivo inmediatamente.
  2. **Mercado Pago & SII:** Cambiar Mercado Pago a modo producción y conectar el webhook para la emisión obligatoria de la **Boleta Electrónica** ante el SII por cada venta generada en la tienda.
  3. **Protección de Datos:** Ajustar los formularios del storefront de Next.js para cumplir con la nueva Ley N° 21.719 de datos personales de Chile (vencimiento de consentimiento, términos claros).

---

### Beneficio clave de esta hoja de ruta:

Con esta planificación, **el proyecto crece de forma orgánica**: primero establecemos la comunicación de tu bot principal (CEO) con los subagentes, luego activamos el contenido diario para redes usando tu data existente, después levantamos la web con tus mejores productos de forma controlada y finalmente abrimos la pasarela de pago real y las APIs de Meta/TikTok.
