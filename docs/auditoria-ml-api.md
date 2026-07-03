# MSL vs API Oficial de MercadoLibre — Auditoría de Gaps

> **Fecha:** 2026-07-02
> **Fuente:** Documentación oficial de MercadoLibre Developers (vía MCP, actualizada a junio 2026)
> **Propósito:** Identificar todo lo que falta en MSL respecto a la API oficial de ML

---

## Resumen

MSL tiene **42 métodos en MlcApiClient** y **8 métodos en MlClient**. Cubre bien las operaciones de lectura (listings, órdenes, pricing, claims, shipping status, promociones, etc.) y ya incorporó parte de los gaps de escritura/preservación. Quedan gaps importantes en:

1. **Campos del ítem** — `MlItem` y `NewItem` aún no reflejan el schema completo de ML
2. **Operaciones de escritura** — `MlClient` ya cubre publish/update/relist/catalog; quedan helpers explícitos para ciclo de vida y borrado
3. **Lecturas faltantes** — 4 endpoints read-only que serían útiles para sync multi-cuenta

---

## 1. Campos en `NewItem` (POST /items)

Según la API oficial, el POST /items acepta estos campos. MSL ya preserva los más críticos para sync, pero no todo el schema:

| Campo                  | Tipo                                                                        | Requerido? | Impacto en sync                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shipping`             | `{ mode, local_pick_up, free_shipping, dimensions, logistic_type, tags[] }` | No         | ✅ Implementado en tipos/buildNewItemFromMlItem; preservar en sync sigue siendo crítico                                                                                                           |
| `sale_terms`           | `Array<{ id, value_id?, value_name? }>`                                     | No         | ✅ Implementado en tipos/buildNewItemFromMlItem; preserva garantía                                                                                                                                |
| `official_store_id`    | `number \| null`                                                            | No         | Bajo                                                                                                                                                                                              |
| `differential_pricing` | `number \| null`                                                            | No         | Bajo                                                                                                                                                                                              |
| `seller_custom_field`  | `string \| null`                                                            | No         | Medio — útil para tracking interno                                                                                                                                                                |
| `automatic_relist`     | `boolean`                                                                   | No         | Bajo                                                                                                                                                                                              |
| `tags`                 | `string[]`                                                                  | No         | Medio — tags como "immediate_payment" afectan visibilidad                                                                                                                                         |
| `description`          | `{ plain_text: string }`                                                    | No         | **ALTO** — Actualmente MSL usa `descriptions: Array<...>`. La API oficial usa `description: { plain_text }` para crear y `descriptions: [...]` en la respuesta GET. Hay que mapear correctamente. |

### Ejemplo de `shipping` preservado:

```json
"shipping": {
  "mode": "me2",
  "local_pick_up": false,
  "free_shipping": false,
  "logistic_type": "drop_off",
  "dimensions": null,
  "tags": []
}
```

### Ejemplo de `sale_terms` preservado:

```json
"sale_terms": [
  { "id": "WARRANTY_TYPE", "value_id": "2230280", "value_name": "Garantía del vendedor" },
  { "id": "WARRANTY_TIME", "value_name": "3 meses" }
]
```

---

## 2. Campos de `MlItem` pendientes de ampliar (GET /items response)

Según la respuesta oficial de GET /items, `MlItem` ya incluye los campos críticos para republicar (`shipping`, `sale_terms`, `currency_id`, `buying_mode`, `listing_type_id`, `condition`, `warranty`, `permalink` y `domain_id`). Quedan campos informativos o de enriquecimiento que todavía no están modelados:

| Campo                  | Tipo                    | Útil para sync?          |
| ---------------------- | ----------------------- | ------------------------ |
| `official_store_id`    | `number \| null`        | Informativo              |
| `differential_pricing` | `number \| null`        | Informativo              |
| `seller_custom_field`  | `string \| null`        | Medio — tracking interno |
| `automatic_relist`     | `boolean`               | Bajo                     |
| `health`               | `number \| null`        | Bajo                     |
| `tags`                 | `string[]`              | Medio                    |
| `video_id`             | `string \| null`        | Ya agregado en NewItem   |
| `base_price`           | `number`                | Informativo              |
| `original_price`       | `number \| null`        | Informativo              |
| `descriptions`         | `Array<{ id: string }>` | Referencia               |

---

## 3. Métodos de `MlClient` (Write Client)

El `MlClient` actual ya tiene `publishItem`, `updateItem`, `relistItem` y `createCatalogListing`. Quedan helpers explícitos de ciclo de vida/borrado, aunque técnicamente pueden expresarse con `updateItem`:

| Método                                  | Endpoint                                    | Necesidad                                                         |
| --------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `closeItem(sellerId, itemId)`           | `PUT /items/:id` con `{ status: "closed" }` | **ALTO** — Necesario para cerrar items viejos antes de republicar |
| `pauseItem(sellerId, itemId)`           | `PUT /items/:id` con `{ status: "paused" }` | **MEDIO** — Pausar sin borrar                                     |
| `relistItem(sellerId, itemId, input)`   | `POST /items/:id/relist`                    | ✅ Implementado — republicar items cerrados preservando historial |
| `createCatalogListing(sellerId, input)` | `POST /items/catalog_listings`              | ✅ Implementado — optin de item tradicional a catálogo            |
| `deleteItem(sellerId, itemId)`          | `PUT /items/:id` con `{ deleted: "true" }`  | Bajo — Borrado permanente                                         |

---

## 4. Métodos Faltantes en `MlcApiClient` (Read Client)

| Método                                 | Endpoint                              | Utilidad                                      |
| -------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `getItemDescription(sellerId, itemId)` | `GET /items/:id/description`          | Leer descripción para preservar al republicar |
| `getPack(sellerId, packId)`            | `GET /marketplace/orders/pack/:id`    | Órdenes con carrito (múltiples items)         |
| `getShippingOptions(sellerId, itemId)` | `GET /items/:id/shipping_options`     | Ver opciones de envío disponibles             |
| `getShippingPreferences(sellerId)`     | `GET /users/:id/shipping_preferences` | Ver configuración de envío del seller         |

---

## 5. Priorización — Lo que realmente importa para sync multi-cuenta

### 🔴 Bloqueante (sin esto el sync es incompleto)

1. ✅ **Agregar `shipping` a `MlItem` + `NewItem`** — implementado para preservar configuración de envío
2. ✅ **Agregar `sale_terms` a `MlItem` + `NewItem`** — implementado para preservar garantía
3. ✅ **Agregar `currency_id`, `buying_mode`, `listing_type_id`, `condition` a `MlItem`** — implementado como defaults de `buildNewItemFromMlItem`
4. ✅ **Agregar `relistItem` a `MlClient`** — implementado para republicar con historial
5. ✅ **Agregar `createCatalogListing` a `MlClient`** — implementado para optin de marketplace a catálogo

### 🟡 Alta prioridad

6. **`closeItem` / `pauseItem` en `MlClient`** — Gestión de ciclo de vida
7. **`descriptions` en `MlItem`** — Para preservar la descripción original
8. **`tags`, `seller_custom_field` en `MlItem` + `NewItem`** — Metadatos que afectan visibilidad

### 🟢 Baja prioridad

9. **`getItemDescription` en `MlcApiClient`**
10. **`getPack`, `getShippingOptions` en `MlcApiClient`**
11. **Resto de campos informativos en `MlItem`**

---

## 6. Comparación: MSL vs API Oficial

| Área                       | MSL actual                                                    | API Oficial                  | Gap                                                                         |
| -------------------------- | ------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Read: listings             | ✅ 42 métodos MlcApiClient                                    | Completo                     | OK                                                                          |
| Read: pricing intelligence | ✅ sale_price, prices, price_to_win, automation               | Completo                     | OK                                                                          |
| Read: claims               | ✅ search, detail, messages, resolutions, reputation, history | Completo                     | OK                                                                          |
| Read: shipping status      | ✅ getShipmentStatus                                          | Completo                     | OK                                                                          |
| Read: promotions           | ✅ seller, detail, items                                      | Completo                     | OK                                                                          |
| Write: create item         | ✅ publishItem (POST /items)                                  | Completo                     | OK                                                                          |
| Write: update item         | ✅ updateItem (PUT /items/:id)                                | Parcial                      | Soporta payload parcial; faltan helpers específicos para close/pause/delete |
| Write: close/pause         | ❌                                                            | PUT /items/:id status        | **Falta**                                                                   |
| Write: relist              | ✅ relistItem                                                 | POST /items/:id/relist       | OK                                                                          |
| Write: catalog optin       | ✅ createCatalogListing                                       | POST /items/catalog_listings | OK                                                                          |
| Item fields (read)         | 11 campos                                                     | 30+ campos                   | **Faltan 19**                                                               |
| Item fields (write)        | 14 campos                                                     | 25+ campos                   | **Faltan 11**                                                               |
| Variations                 | ✅ variations en MlItem + NewItem                             | Completo                     | OK                                                                          |
| Catalog                    | ✅ catalog_product_id + catalog_listing                       | Completo                     | OK                                                                          |
| Pictures                   | ✅ source URL                                                 | Completo                     | OK                                                                          |
| Shipping config            | ✅ En tipos                                                   | `shipping` object            | OK                                                                          |
| Sale terms (warranty)      | ✅ En tipos                                                   | `sale_terms` array           | OK                                                                          |

---

## Conclusión

MSL está **muy bien en lecturas** (42 métodos, 13 áreas de API, todo con snapshots tipados) y ya cerró los gaps más críticos de preservación (`shipping`, `sale_terms`) y escritura (`relistItem`, `createCatalogListing`). El gap principal restante está en helpers explícitos de ciclo de vida, descripción completa y endpoints read-only adicionales para enriquecer sync multi-cuenta.
