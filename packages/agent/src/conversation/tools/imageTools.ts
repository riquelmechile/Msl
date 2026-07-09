import type { MlcApiClient, MlcImageDiagnosticInput } from "@msl/mercadolibre";
import { normalizeImageOrchestration } from "@msl/mercadolibre";

import type { ToolDefinition } from "../tools.js";
import { coerceSellerId } from "./_shared.js";


// ---------------------------------------------------------------------------
// diagnose_image tool
// ---------------------------------------------------------------------------

export function createDiagnoseImageTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "diagnose_image",
    description:
      "Diagnostica una imagen antes de publicarla en MercadoLibre. " +
      "Detecta problemas de fondo blanco, tamaño mínimo, texto/logos " +
      "y marcas de agua que podrían causar moderación o rechazo. " +
      "Usá esta herramienta cuando el vendedor esté preparando imágenes " +
      "para una publicación nueva o quiera verificar si una imagen " +
      "cumple con los requisitos de MercadoLibre.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        pictureUrl: {
          type: "string",
          description: "URL de la imagen a diagnosticar (puede ser URL pública o base64).",
        },
        categoryId: {
          type: "string",
          description: "ID de la categoría de MercadoLibre donde se publicará. Ej: MLC1743.",
        },
        title: {
          type: "string",
          description: "Título del producto (opcional, ayuda al diagnóstico contextual).",
        },
        pictureType: {
          type: "string",
          enum: ["thumbnail", "variation_thumbnail", "other"],
          description: "Tipo de imagen: thumbnail, variation_thumbnail, u other.",
        },
      },
      required: ["sellerId", "pictureUrl", "categoryId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.diagnoseImage) {
        return {
          error: "El diagnóstico de imágenes no está disponible en este momento.",
        };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const pictureUrl = args.pictureUrl as string;
      if (!pictureUrl || typeof pictureUrl !== "string") {
        return {
          error: "El parámetro 'pictureUrl' es obligatorio y debe ser una URL válida.",
        };
      }

      const categoryId = args.categoryId as string;
      if (!categoryId || typeof categoryId !== "string") {
        return {
          error: "El parámetro 'categoryId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const input: MlcImageDiagnosticInput = {
        pictureUrl,
        categoryId,
      };
      if (typeof args.title === "string" && args.title.length > 0) {
        input.title = args.title;
      }
      if (
        typeof args.pictureType === "string" &&
        (args.pictureType === "thumbnail" ||
          args.pictureType === "variation_thumbnail" ||
          args.pictureType === "other")
      ) {
        input.pictureType = args.pictureType;
      }

      try {
        const snapshot = await mlcClient.diagnoseImage(sellerId, input);
        const data = snapshot.data as import("@msl/mercadolibre").MlcImageDiagnosticSummary;
        const issues = data.diagnostics.flatMap((d) =>
          d.detections.map((det) => ({
            type: det.name,
            pictureType: d.pictureType,
            details: det.wordings.map((w) => `${w.kind}: ${w.value}`).join("; "),
          })),
        );

        return {
          ...snapshot,
          issues,
          recommendation: data.hasIssues
            ? `Se detectaron ${issues.length} problemas en la imagen. Corregilos antes de publicar.`
            : "La imagen pasó el diagnóstico sin problemas detectados.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo diagnosticar la imagen: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// upload_image tool
// ---------------------------------------------------------------------------

export function createUploadImageTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "upload_image",
    description:
      "Sube una imagen al CDN de MercadoLibre para usarla en publicaciones. " +
      "Descarga la imagen desde la URL proporcionada y la sube a MercadoLibre. " +
      "Devuelve el ID de la imagen y las URLs en diferentes tamaños. " +
      "Usá esta herramienta cuando el vendedor necesite subir imágenes para " +
      "una publicación nueva o reemplazar las imágenes de una existente. " +
      "IMPORTANTE: pasá siempre las imágenes por diagnose_image antes de publicar.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        imageUrl: {
          type: "string",
          description: "URL pública de la imagen a subir al CDN de MercadoLibre.",
        },
      },
      required: ["sellerId", "imageUrl"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (!mlcClient.uploadImage) {
        return {
          error: "La subida de imágenes no está disponible en este momento.",
        };
      }

      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }

      const imageUrl = args.imageUrl as string;
      if (!imageUrl || typeof imageUrl !== "string") {
        return {
          error: "El parámetro 'imageUrl' es obligatorio y debe ser una URL válida.",
        };
      }

      try {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          return {
            error:
              `No se pudo descargar la imagen desde "${imageUrl}": ` +
              `${imageResponse.status} ${imageResponse.statusText}`,
          };
        }

        const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const filename =
          imageUrl
            .split("/")
            .pop()
            ?.replace(/[^a-zA-Z0-9._-]/g, "_") ?? "image.jpg";

        const snapshot = await mlcClient.uploadImage(sellerId, imageBuffer, filename);
        return {
          ...snapshot,
          uploadedFrom: imageUrl,
          contentType,
        };
      } catch (err) {
        return {
          error:
            `No se pudo subir la imagen a MercadoLibre: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// check_image_moderation tool
// ---------------------------------------------------------------------------

export function createCheckImageModerationTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "check_image_moderation",
    description:
      "Verifica el estado de moderación de imágenes de una publicación de MercadoLibre. " +
      "Detecta si las imágenes tienen marcas de agua, texto superpuesto, o problemas " +
      "que pueden causar moderación o rechazo. Usá esta herramienta cuando el vendedor " +
      "pregunte por el estado de sus imágenes, sospeche problemas de moderación, o " +
      "quiera verificar que una publicación cumple con los requisitos de ML.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: MLC123456789.",
        },
      },
      required: ["sellerId", "itemId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const itemId = typeof args.itemId === "string" && args.itemId.length > 0 ? args.itemId : null;
      if (!itemId) {
        return {
          error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío.",
        };
      }
      if (!mlcClient.getModerationStatus) {
        return {
          error: "La verificación de moderación no está disponible en este momento.",
        };
      }

      try {
        const snapshot = await mlcClient.getModerationStatus(sellerId, itemId);
        const data = snapshot.data;
        return {
          ...snapshot,
          hasIssues: data.blocked || data.wordings.length > 0,
          recommendation: data.blocked
            ? `La publicación ${itemId} tiene imágenes bloqueadas por moderación. Revisar y corregir.`
            : data.wordings.length > 0
              ? `La publicación ${itemId} tiene ${data.wordings.length} advertencias de moderación. Se recomienda corregir antes de que escalen.`
              : `La publicación ${itemId} no tiene problemas de moderación detectados.`,
        };
      } catch (err) {
        return {
          error:
            `No se pudo verificar la moderación de imágenes: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// prepare_image_flow tool
// ---------------------------------------------------------------------------

export function createPrepareImageFlowTool(mlcClient: MlcApiClient): ToolDefinition {
  return {
    name: "prepare_image_flow",
    description:
      "Prepara un flujo completo de imágenes para una publicación de MercadoLibre " +
      "en 4 pasos: diagnóstico → subida → asociación → verificación. " +
      "requiresApproval: true. noMutationExecuted: true. " +
      "Ejecuta el diagnóstico de inmediato para detectar problemas, " +
      "pero NO realiza la subida, asociación ni verificación sin aprobación. " +
      "Usá esta herramienta cuando el vendedor necesite preparar imágenes para " +
      "una publicación nueva, combinando diagnóstico, subida y asociación en un solo flujo.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "ID del vendedor en MercadoLibre. Ej: 'plasticov' o 'maustian'.",
        },
        itemId: {
          type: "string",
          description: "ID de la publicación en MercadoLibre. Ej: MLC123456789.",
        },
        pictureUrl: {
          type: "string",
          description: "URL de la imagen a procesar (pública o base64).",
        },
        categoryId: {
          type: "string",
          description: "ID de la categoría de MercadoLibre. Ej: MLC1743.",
        },
        title: {
          type: "string",
          description: "Título del producto (opcional, ayuda al diagnóstico contextual).",
        },
      },
      required: ["sellerId", "itemId", "pictureUrl", "categoryId"],
    },
    execute: async (args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const sellerId = coerceSellerId(args.sellerId);
      if (!sellerId) {
        return {
          error: "El parámetro 'sellerId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const itemId = typeof args.itemId === "string" && args.itemId.length > 0 ? args.itemId : null;
      if (!itemId) {
        return {
          error: "El parámetro 'itemId' es obligatorio y debe ser un string no vacío.",
        };
      }
      const pictureUrl =
        typeof args.pictureUrl === "string" && args.pictureUrl.length > 0 ? args.pictureUrl : null;
      if (!pictureUrl) {
        return {
          error: "El parámetro 'pictureUrl' es obligatorio y debe ser una URL válida.",
        };
      }
      const categoryId =
        typeof args.categoryId === "string" && args.categoryId.length > 0 ? args.categoryId : null;
      if (!categoryId) {
        return {
          error: "El parámetro 'categoryId' es obligatorio y debe ser un string no vacío.",
        };
      }

      if (!mlcClient.diagnoseImage) {
        return {
          error:
            "El flujo de imágenes no está disponible: el diagnóstico de imágenes " +
            "no está habilitado en este momento. Se requiere diagnose_image para continuar.",
        };
      }

      try {
        const diagInput: MlcImageDiagnosticInput = { pictureUrl, categoryId };
        if (typeof args.title === "string" && args.title.length > 0) {
          diagInput.title = args.title;
        }
        const diagSnapshot = await mlcClient.diagnoseImage(sellerId, diagInput);

        const orchestrationInput = {
          sellerId,
          itemId,
          pictureUrl,
          categoryId,
          now: new Date(),
        };
        if (typeof args.title === "string") {
          Object.assign(orchestrationInput, { title: args.title });
        }
        const orchestration = normalizeImageOrchestration(orchestrationInput);
        const summary = orchestration.data;

        const updatedSteps = summary.steps.map((s) =>
          s.step === "diagnose" ? { ...s, status: "completed" as const, result: diagSnapshot } : s,
        );

        return {
          ...orchestration,
          data: {
            ...summary,
            steps: updatedSteps,
          },
          diagnoseResult: diagSnapshot,
          nextStep: "upload",
          instructions:
            "Paso 1 (diagnóstico) completado. Pasos pendientes: upload, associate, check. " +
            "El vendedor debe aprobar antes de continuar con la subida de imagen.",
        };
      } catch (err) {
        return {
          error:
            `No se pudo preparar el flujo de imágenes: ` +
            `${err instanceof Error ? err.message : String(err)}`,
          failedStep: "diagnose",
          instructions:
            "El diagnóstico falló. Verificá que la URL de la imagen y la categoría " +
            "sean correctas antes de reintentar.",
        };
      }
    },
  };
}
