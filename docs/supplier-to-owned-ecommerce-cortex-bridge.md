# Supplier-to-Owned Ecommerce Cortex Bridge

## Resumen ejecutivo

La siguiente evolución de MSL no debe ser un agente web aislado. Debe ser un puente operativo entre el agente de proveedores, Cortex, el bus de mensajes interno y el agente de ecommerce propio.

La idea central es:

```text
supplier-manager detecta stock/precio/producto
  -> guarda/lee evidencia en SupplierMirrorStore, Cortex y operational read model
  -> avisa al CEO
  -> avisa también a owned-ecommerce
  -> owned-ecommerce prepara publicación, pausa, ajuste o preview
  -> CEO aprueba por Telegram
  -> backend executor revalida y ejecuta
  -> Cortex aprende el resultado
```

El objetivo es que MSL use señales reales de proveedores para operar las tiendas propias sin vender sin stock, sin publicar productos sin margen, sin romper SEO, y sin saltarse aprobación humana.

---

## Estado real del proyecto

MSL ya tiene piezas importantes implementadas:

- `supplier-manager` existe como lane y daemon.
- `owned-ecommerce` existe como lane interno.
- `Agent Message Bus` existe como cola SQLite deduplicada.
- `Cortex` y el operational read model existen como memoria/evidencia local.
- `SupplierMirrorStore` existe como base de proveedores, items, mappings y ledger.
- El ecommerce propio ya tiene una spec que exige selección basada en evidencia desde Plasticov, Maustian, Supplier Mirror/Jinpeng, proveedores futuros, operational read model y Cortex.
- El ecommerce propio ya tiene boundary de preview/proposal-only para el LLM y ejecución backend-only con aprobación.

La brecha principal es que el `supplier-manager` hoy encola propuestas al CEO, pero no despierta directamente al agente `owned-ecommerce`. Además, el scheduler tiene lane `owned-ecommerce` definido, pero necesita un handler/daemon que procese mensajes dirigidos a ese lane.

---

## Principio de diseño

```text
El agente web puede mirar, medir, comparar, preparar y proponer.
No puede publicar, cambiar checkout, tocar precios, borrar páginas, ocultar productos o purgar cache sin aprobación exacta.
```

Toda operación que afecte el negocio debe mantener:

- `requiresApproval: true`
- `noMutationExecuted: true` en herramientas LLM-facing
- ejecución real solo por backend runtime
- revalidación de stock/margen/readiness antes de ejecutar
- rollback/audit trail
- outcome registrado en Cortex

---

## Arquitectura propuesta

```text
Supplier Manager Daemon
  ├─ lee SupplierMirrorStore
  ├─ lee Cortex listing_snapshot
  ├─ detecta stock-gap / price-change / unfilled-mirror / publish opportunity
  ├─ encola propuesta al CEO
  └─ NUEVO: encola señal al owned-ecommerce

Agent Message Bus
  ├─ receiverAgentId: "ceo"
  └─ receiverAgentId: "owned-ecommerce"

Owned Ecommerce / Website Manager
  ├─ reclama señales del bus
  ├─ consulta Cortex + Operational Read Model + SupplierMirror
  ├─ calcula candidato web
  ├─ bloquea si falta evidencia crítica
  ├─ prepara storefront projection
  ├─ prepara pausa/ocultamiento/stock/check-out guard
  ├─ pide asset al Creative Studio si faltan imágenes
  └─ devuelve propuesta al CEO

CEO Agent / Telegram
  └─ humano aprueba, rechaza o redirige

Backend Executor
  ├─ revalida aprobación exacta
  ├─ revalida stock/freshness/readiness
  ├─ ejecuta Medusa/tienda
  ├─ purga cache si corresponde
  ├─ registra rollback
  └─ guarda outcome en Cortex
```

---

## Señales que debe emitir Supplier Manager hacia Owned Ecommerce

### 1. Producto nuevo de proveedor no publicado

Cuando un item de proveedor no tiene `ml_item_id` ni mappings, hoy se detecta como `unfilled-mirror`. Para ecommerce propio, esa señal debe despertar al agente web para preparar una página candidata.

```json
{
  "type": "supplier-web-signal",
  "signalKind": "new-supplier-product",
  "supplierId": "jinpeng",
  "supplierItemId": "S001",
  "recommendedAction": "prepare-storefront-candidate",
  "receiverAgentId": "owned-ecommerce",
  "evidenceIds": ["supplier-item:S001"],
  "severity": "warning",
  "noMutationExecuted": true
}
```

### 2. Diferencia de stock entre sellers o canales

Cuando un seller/canal tiene stock y otro está en cero, el agente web debe revisar páginas afectadas y preparar disponibilidad segura.

```json
{
  "type": "supplier-web-signal",
  "signalKind": "stock-gap",
  "supplierId": "jinpeng",
  "supplierItemId": "S001",
  "affectedSellerIds": ["maustian", "plasticov"],
  "recommendedAction": "review-storefront-availability",
  "severity": "critical",
  "noMutationExecuted": true
}
```

### 3. Cambio de precio del proveedor

Cuando el proveedor sube o baja precio sobre el umbral configurado, el agente web debe preparar revisión de margen y precio visible.

```json
{
  "type": "supplier-web-signal",
  "signalKind": "supplier-price-change",
  "supplierId": "jinpeng",
  "supplierItemId": "S001",
  "priceDeltaPct": 8.5,
  "recommendedAction": "prepare-price-review",
  "severity": "warning",
  "noMutationExecuted": true
}
```

### 4. Stock restaurado

Cuando vuelve stock en proveedor y la página estaba pausada/sin checkout, se prepara reactivación controlada.

```json
{
  "type": "supplier-web-signal",
  "signalKind": "supplier-stock-restored",
  "supplierId": "jinpeng",
  "supplierItemId": "S001",
  "recommendedAction": "prepare-reactivation-review",
  "severity": "info",
  "noMutationExecuted": true
}
```

### 5. Oportunidad de publicación

Cuando hay stock, margen, producto razonable e imágenes suficientes, el agente web prepara publicación/preview.

```json
{
  "type": "supplier-web-signal",
  "signalKind": "publish-opportunity",
  "supplierId": "jinpeng",
  "supplierItemId": "S001",
  "recommendedAction": "prepare-product-page",
  "requiresEvidence": ["supplier-stock", "supplier-cost", "margin", "category", "image", "seo"],
  "severity": "info",
  "noMutationExecuted": true
}
```

---

## Contrato TypeScript sugerido

```ts
export type SupplierWebSignalKind =
  | "new-supplier-product"
  | "stock-gap"
  | "supplier-price-change"
  | "supplier-stock-restored"
  | "supplier-stock-out"
  | "publish-opportunity";

export type SupplierWebRecommendedAction =
  | "prepare-product-page"
  | "prepare-storefront-candidate"
  | "review-storefront-availability"
  | "prepare-availability-pause"
  | "prepare-price-review"
  | "prepare-reactivation-review"
  | "request-creative-assets";

export type SupplierWebSignalPayload = {
  type: "supplier-web-signal";
  signalKind: SupplierWebSignalKind;
  supplierId: string;
  supplierItemId: string;
  affectedSellerIds?: string[];
  evidenceIds: string[];
  recommendedAction: SupplierWebRecommendedAction;
  severity: "info" | "warning" | "critical";
  capturedAt: string;
  noMutationExecuted: true;
};
```

---

## Cambios concretos en el repo

### 1. Modificar `supplierManagerDaemon.ts`

Mantener el envío actual al CEO, pero agregar envío paralelo al lane `owned-ecommerce` cuando corresponda.

Ejemplo para producto no publicado:

```ts
bus.enqueue({
  senderAgentId: "supplier-manager",
  receiverAgentId: "owned-ecommerce",
  messageType: "supplier-web-signal",
  payloadJson: JSON.stringify({
    type: "supplier-web-signal",
    signalKind: "new-supplier-product",
    supplierId: supplier.id,
    supplierItemId: item.supplierItemId,
    severity: "warning",
    recommendedAction: "prepare-storefront-candidate",
    evidenceIds: [`supplier-item:${item.supplierItemId}`],
    capturedAt,
    noMutationExecuted: true,
  }),
  dedupeKey: `supplier-web-unfilled-${supplier.id}-${item.supplierItemId}-${hourKey}`,
});
```

Ejemplo para stock gap:

```ts
bus.enqueue({
  senderAgentId: "supplier-manager",
  receiverAgentId: "owned-ecommerce",
  messageType: "supplier-web-signal",
  payloadJson: JSON.stringify({
    type: "supplier-web-signal",
    signalKind: "stock-gap",
    supplierId: supplier.id,
    supplierItemId: item.supplierItemId,
    severity: "critical",
    recommendedAction: "prepare-availability-pause",
    evidenceIds: [
      `supplier-item:${item.supplierItemId}`,
      ...entries.map(([sellerId]) => `listing_snapshot:${sellerId}`),
    ],
    capturedAt,
    noMutationExecuted: true,
  }),
  dedupeKey: `supplier-web-stock-gap-${supplier.id}-${item.supplierItemId}-${hourKey}`,
});
```

Ejemplo para cambio de precio:

```ts
bus.enqueue({
  senderAgentId: "supplier-manager",
  receiverAgentId: "owned-ecommerce",
  messageType: "supplier-web-signal",
  payloadJson: JSON.stringify({
    type: "supplier-web-signal",
    signalKind: "supplier-price-change",
    supplierId: supplier.id,
    supplierItemId: item.supplierItemId,
    severity: "warning",
    recommendedAction: "prepare-price-review",
    evidenceIds: [`supplier-item:${item.supplierItemId}`],
    capturedAt,
    noMutationExecuted: true,
  }),
  dedupeKey: `supplier-web-price-change-${supplier.id}-${item.supplierItemId}-${hourKey}`,
});
```

### 2. Crear `ownedEcommerceDaemon.ts`

Nuevo archivo sugerido:

```text
packages/agent/src/workers/ownedEcommerceDaemon.ts
```

Responsabilidad:

```text
supplier-web-signal
  -> parse payload
  -> validate evidence
  -> query SupplierMirrorStore
  -> query Cortex
  -> query OperationalReadModel.searchSnapshots()
  -> apply WebsiteAvailabilityPolicy
  -> build candidate or block reason
  -> enqueue CEO proposal
```

El daemon debe operar con `noMutationExecuted: true` siempre.

### 3. Modificar `daemonScheduler.ts`

Agregar el handler:

```ts
import { ownedEcommerceDaemon } from "./ownedEcommerceDaemon.js";

const daemonHandlerMap: Partial<Record<LaneId, DaemonHandler>> = {
  ...,
  "owned-ecommerce": ownedEcommerceDaemon,
};
```

### 4. Crear `websiteAvailabilityPolicy.ts`

Nuevo archivo sugerido:

```text
packages/agent/src/workers/websiteAvailabilityPolicy.ts
```

Reglas principales:

```text
Si proveedor stock = 0 y no hay stock propio:
  -> prepare-disable-checkout

Si proveedor stock = 0 pero página tiene valor SEO:
  -> mantener indexable, desactivar compra, mostrar sin stock

Si precio proveedor sube y margen queda bajo:
  -> prepare-price-review o prepare-hide-product

Si producto nuevo tiene stock, margen e imagen:
  -> prepare-product-page

Si producto nuevo no tiene imagen suficiente:
  -> request-creative-assets
```

### 5. Crear candidate builder

Nuevo archivo sugerido:

```text
packages/agent/src/conversation/ownedEcommerceCandidateBuilder.ts
```

Responsabilidad:

```text
supplier item + stock + cost + margin + category + images
  -> storefront candidate
  -> readiness checks
  -> SEO/GEO Chile draft
  -> evidence IDs
  -> block reasons si falta algo
```

### 6. Conectar Creative Studio

Cuando `owned-ecommerce` detecte oportunidad pero falten imágenes, debe enviar un mensaje al lane creativo o al futuro `creative-studio`:

```json
{
  "type": "creative-asset-request",
  "requestedByAgent": "owned-ecommerce",
  "supplierItemId": "S001",
  "channel": "storefront",
  "kind": "product-cover-i2i",
  "objective": "conversion",
  "noMutationExecuted": true
}
```

---

## Flujo operativo final

```text
Proveedor actualiza stock/precio/productos
        ↓
supplier-manager detecta cambio
        ↓
supplier-manager registra evidencia/ledger
        ↓
supplier-manager manda:
   1) propuesta al CEO
   2) supplier-web-signal a owned-ecommerce
        ↓
owned-ecommerce consulta Cortex + SupplierMirror + read model
        ↓
si falta imagen -> pide Creative Studio
si falta margen -> consulta Cost/Supplier
si falta demanda -> consulta Market/Catalog
        ↓
genera storefront projection / pause proposal / price review
        ↓
CEO recibe en Telegram
        ↓
CEO dice "dale", rechaza o redirige
        ↓
backend runtime revalida y ejecuta
        ↓
Cortex registra outcome
```

---

## Ejemplos de propuestas al CEO

### Publicación de oportunidad

```text
Encontré una oportunidad web desde proveedor Jinpeng.

Producto: Esquiladora inalámbrica 21V
Origen: supplier-item:JINPENG-443
Stock proveedor: disponible
Margen estimado: 42%
Riesgo: falta validar imagen principal para SEO/CTR

Acción propuesta:
1. Crear página preview en maustian.cl.
2. Mantener checkout desactivado hasta validar stock final.
3. Pedir 3 portadas al Creative Studio.
4. Indexar solo cuando schema Product + imagen + precio estén validados.

¿Dale para preparar preview?
```

### Pausa controlada por stock

```text
Alerta web: proveedor sin stock para producto publicado.

Producto: X
Página afectada: maustian.cl/producto/x
Riesgo: venta sin stock / mala experiencia / reclamos

Acción propuesta:
1. Desactivar compra.
2. Mantener página indexable como "sin stock temporal".
3. Sacar de colecciones principales.
4. Revalidar stock cada 6 horas.

¿Dale para aplicar pausa controlada?
```

### Revisión de precio

```text
Proveedor subió el costo de un producto publicado.

Producto: X
Costo anterior: CLP 4.200
Costo nuevo: CLP 4.850
Delta: +15,4%
Margen actual estimado: bajo el mínimo objetivo

Acción propuesta:
1. Preparar nuevo precio.
2. Comparar contra MercadoLibre/catalog competitors.
3. Mantener página visible pero bloquear checkout si el margen queda negativo.
4. Pedir aprobación antes de aplicar.

¿Dale para preparar revisión de precio?
```

---

## OpenSpec sugerido

```text
openspec/changes/supplier-to-owned-ecommerce-cortex-bridge/
  proposal.md
  design.md
  tasks.md
  specs/
    supplier-manager-daemon/spec.md
    owned-ecommerce-agent/spec.md
    agent-message-bus/spec.md
    website-availability-policy/spec.md
```

### Requirements iniciales

```markdown
### Requirement: Supplier-to-owned-ecommerce signal forwarding

When supplier-manager detects stock gap, supplier price change, unfilled mirror item, restored stock, or publish opportunity, it SHALL enqueue a deduplicated `supplier-web-signal` message to `owned-ecommerce` in addition to any CEO proposal.

### Requirement: Owned ecommerce signal handling

The owned-ecommerce daemon SHALL claim `supplier-web-signal` messages, collect SupplierMirrorStore, Cortex, and operational read model evidence, and prepare a proposal-only storefront action.

### Requirement: Website availability policy

The system SHALL decide between prepare-publish, disable-checkout, hide-from-collections, mark-out-of-stock, price-review, or block-candidate using deterministic stock, cost, margin, freshness, and SEO-risk checks.

### Requirement: No mutation from supplier/web signals

Supplier-to-web signal processing SHALL NOT publish pages, activate checkout, change prices, change stock, purge cache, or call external write APIs. All outputs SHALL keep `noMutationExecuted: true` until backend runtime execution receives exact CEO approval and fresh readiness.

### Requirement: Cortex outcome feedback

The system SHALL record CEO approvals, rejections, publish outcomes, stock incidents, SEO outcomes, and conversion outcomes as Cortex learning evidence for future supplier/web routing.
```

---

## Implementación por fases

### Fase 1 — Signal bridge

```text
feat(supplier): forward supplier web signals to owned ecommerce
```

Archivos:

```text
packages/agent/src/workers/supplierManagerDaemon.ts
packages/agent/src/workers/daemonTypes.ts
packages/agent/tests/workers/supplierManagerDaemon.test.ts
```

Objetivo:

```text
supplier-manager -> owned-ecommerce por Agent Message Bus
```

### Fase 2 — Owned ecommerce daemon

```text
feat(ecommerce): add owned ecommerce signal daemon
```

Archivos:

```text
packages/agent/src/workers/ownedEcommerceDaemon.ts
packages/agent/src/workers/daemonScheduler.ts
packages/agent/tests/workers/ownedEcommerceDaemon.test.ts
```

Objetivo:

```text
owned-ecommerce reclama mensajes y prepara CEO proposals
```

### Fase 3 — Website availability policy

```text
feat(ecommerce): add website availability policy
```

Archivos:

```text
packages/agent/src/workers/websiteAvailabilityPolicy.ts
packages/domain/src/ownedEcommerce.ts
```

Objetivo:

```text
pause / hide / disable-checkout / prepare-publish / price-review
```

### Fase 4 — Storefront candidate builder

```text
feat(ecommerce): build supplier-backed storefront candidates
```

Archivos:

```text
packages/agent/src/conversation/ownedEcommerceCandidateBuilder.ts
packages/memory/src/ownedEcommerceStore.ts
```

Objetivo:

```text
supplier item -> candidato web con evidencia
```

### Fase 5 — Creative handoff

```text
feat(ecommerce): request creative assets for supplier storefront candidates
```

Objetivo:

```text
owned-ecommerce -> creative-assets / creative-studio cuando falten imágenes
```

### Fase 6 — Backend executor

```text
feat(ecommerce): execute approved website actions through backend runtime
```

Archivos:

```text
packages/ecommerce-medusa
scripts/start-website-runtime.mjs
ecosystem.config.cjs
```

Objetivo:

```text
ejecución real solo con aprobación, readiness fresco y rollback
```

---

## Guardrails duros

```text
1. No publicar productos sin stock fresco.
2. No afirmar disponibilidad si depende de proveedor y la evidencia está stale.
3. No mantener checkout activo si no hay stock propio ni proveedor confiable.
4. No cambiar precio sin recalcular margen.
5. No usar claims SEO/GEO no respaldados por evidencia.
6. No eliminar páginas que tengan valor SEO sin preparar redirect o estado sin stock.
7. No publicar páginas con imágenes insuficientes o engañosas.
8. No activar checkout/pagos sin aprobación separada.
9. No entregar credenciales al LLM.
10. Toda ejecución real debe pasar por backend runtime con rollback.
```

---

## Estado de credenciales y operación

Mientras las credenciales reales de MercadoLibre, Medusa, proveedor y publicación web no estén configuradas, este puente debe operar en modo:

```text
read-only
prepare-only
preview-only
noMutationExecuted: true
```

No debe activar automatización viva hasta que:

- OAuth MercadoLibre esté listo por seller.
- Supplier Mirror dry-run haya pasado.
- Medusa esté configurado.
- El backend executor tenga credenciales de runtime.
- El CEO haya aprobado la política de operación.

---

## Decisión final

El siguiente paso lógico para MSL es crear un puente Supplier-to-Web sobre Cortex y Agent Message Bus.

No se debe duplicar inteligencia. El agente web debe ser consumidor de señales del Supplier Manager y de Cortex.

La empresa agente quedaría así:

```text
supplier-manager detecta
owned-ecommerce recibe
website policy decide
creative-studio complementa
CEO aprueba
backend executor aplica
Cortex aprende
```

Esto convierte MSL en una operación comercial multicanal: MercadoLibre sigue siendo el primer canal, pero las tiendas propias empiezan a reaccionar a proveedores, stock, margen, imágenes, SEO y resultados reales bajo control humano.

---

## Signal Contract (Implemented)

The Supplier Manager Daemon now enqueues `supplier-web-signal` messages to the `owned-ecommerce` lane via the Agent Message Bus. Each signal follows a strict contract defined by `SupplierWebSignalPayload` in `packages/domain/src/supplierWebSignal.ts`.

### Dedupe Key Format

```
sws:{supplierId}:{supplierItemId}:{signalKind}:{hourKey}
```

Duplicate signals within the same hour window are suppressed by the bus dedupe key.

### Feature Flag

`MSL_OWNED_ECOMMERCE_INTELLIGENCE_ENABLED=true` enables signal enqueue. When disabled, no signals are sent.

### Signal Kinds

| Kind                      | Trigger                                  | Severity   | Example Dedupe Key                                       |
| ------------------------- | ---------------------------------------- | ---------- | -------------------------------------------------------- |
| `new-supplier-product`    | Item has no `ml_item_id` and no mappings | `warning`  | `sws:jinpeng:S001:new-supplier-product:2026-07-10T12`    |
| `stock-gap`               | One seller stock > 0, another = 0        | `critical` | `sws:jinpeng:S001:stock-gap:2026-07-10T12`               |
| `supplier-price-change`   | Price delta >5%                          | `warning`  | `sws:jinpeng:S001:supplier-price-change:2026-07-10T12`   |
| `supplier-stock-restored` | All sellers stock > 0                    | `info`     | `sws:jinpeng:S001:supplier-stock-restored:2026-07-10T12` |
| `supplier-stock-out`      | All sellers stock = 0                    | `critical` | `sws:jinpeng:S001:supplier-stock-out:2026-07-10T12`      |
| `publish-opportunity`     | Unfilled mirror with price evidence      | `info`     | `sws:jinpeng:S001:publish-opportunity:2026-07-10T12`     |

### Missing Evidence Handling

When an unfilled mirror item has no price evidence, the `new-supplier-product` signal uses `recommendedAction: "collect-more-evidence"` instead of `"prepare-storefront-candidate"`. No aggressive proposals are made without evidence.

## Implementation Status

| Fase                                                             | Descripción           | Estado |
| ---------------------------------------------------------------- | --------------------- | ------ |
| Signal bridge (domain types, daemon enqueue, dedupe)             | ✅ Implemented (PR 1) |
| Owned ecommerce daemon (claim signals, prepare proposals)        | 🔲 Planned (PR 2)     |
| Intelligence service + Cortex reasoner + scorer + projection     | 🔲 Planned (PR 2)     |
| Daemon integration + tools + creative delegation + work sessions | 🔲 Planned (PR 3)     |

See `docs/architecture/owned-ecommerce-intelligence.md` for the full architecture reference.
