import type { MlcApiClient } from "@msl/mercadolibre";

import type { ToolDefinition } from "../tools.js";
import { coerceSellerId } from "./_shared.js";

// ---------------------------------------------------------------------------
// read_my_orders tool
// ---------------------------------------------------------------------------

export function createReadMyOrdersTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "read_my_orders",
    description:
      "Lee el historial de órdenes (ventas) del vendedor en MercadoLibre. " +
      "Devuelve la lista de órdenes con su estado, monto total, moneda, fecha " +
      "de creación y comprador. Usá esta herramienta cuando el vendedor pregunte " +
      "por sus ventas recientes, quiera analizar tendencias, detectar productos " +
      "estacionales, o necesite datos históricos para planificar. Las órdenes " +
      "permiten identificar qué productos y categorías generan más ingresos.",
    parameters: {
      type: "object",
      properties: {
        sellerId: { type: "string", description: "ID del vendedor en MercadoLibre" },
      },
      required: ["sellerId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return { error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío." };
      }
      try {
        const snapshot = await mlcClient.getOrders(sellerId);
        return snapshot;
      } catch (err) {
        return {
          error: `No se pudo leer las órdenes de "${sellerId}": ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_shipment_status tool
// ---------------------------------------------------------------------------

export function createCheckShipmentStatusTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_shipment_status",
    description:
      "Consulta el estado de envío de una orden de MercadoLibre. Devuelve " +
      "estado actual, subestado, número de seguimiento, fechas y tipo logístico. " +
      "Usá esta herramienta cuando el vendedor pregunte por el estado de un envío, " +
      "necesite verificar si llegó a destino, o quiera hacer seguimiento de una entrega.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        shipmentId: {
          type: "string",
          description: "ID del envío en MercadoLibre. Ej: 41567890123.",
        },
      },
      required: ["sellerId", "shipmentId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const shipmentId =
        typeof args.shipmentId === "string" && args.shipmentId.length > 0 ? args.shipmentId : null;
      if (!shipmentId) {
        return {
          error: "El parámetro 'shipmentId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getShipmentStatus) {
        return {
          error: "La consulta de estado de envío no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getShipmentStatus(sellerId, shipmentId);
        const data = snapshot.data;
        return {
          ...snapshot,
          friendlyStatus: data.status
            ? `Estado: ${data.status}${data.substatus ? ` (${data.substatus})` : ""}`
            : "Estado desconocido",
          tracking: data.trackingNumber
            ? `Seguimiento: ${data.trackingNumber} (${data.trackingMethod ?? "método desconocido"})`
            : "Sin número de seguimiento",
          summary:
            `Envío ${data.id}: ${data.status ?? "estado desconocido"}. ` +
            `${data.trackingNumber ? `Tracking: ${data.trackingNumber}. ` : ""}` +
            `Logística: ${data.logisticType ?? "no especificada"}.`,
        };
      } catch (err) {
        return {
          error:
            `No se pudo consultar el estado del envío: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
