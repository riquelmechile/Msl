import type { MlDiagnosticResult } from "../contracts/creative-requests.js";

// ── Types ────────────────────────────────────────────────────────────

export type MlDiagnosticAdapterConfig = {
  mlApiBaseUrl: string;
  authToken: string;
};

type MlApiDiagnosticResponse = {
  action?: "empty" | "diagnostic";
  detections?: Array<{
    name: string;
    wordings: Array<{ kind: string; value: string }>;
  }>;
};

type MlDiagnosticContext = {
  categoryId: string;
  title: string;
  pictureType: string;
};

// ── Adapter ─────────────────────────────────────────────────────────

/**
 * MercadoLibre Image Diagnostic adapter.
 *
 * Calls `POST /moderations/pictures/diagnostic` to pre-check generated
 * images for ML compliance (white_background, minimum_size, text_logo,
 * watermark).
 *
 * Non-blocking by design: API errors return `passed: true` so the
 * daemon flow is never blocked by a diagnostic failure.
 */
export class MlDiagnosticAdapter {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(config: MlDiagnosticAdapterConfig) {
    this.baseUrl = config.mlApiBaseUrl.replace(/\/+$/, "");
    this.authToken = config.authToken;
  }

  /**
   * Diagnose a generated image against ML quality rules.
   *
   * @param imageUrl — Public URL or base64 of the generated image
   * @param context  — Category, title, and picture type for context-aware diagnosis
   * @returns MlDiagnosticResult (never throws — API errors degrade gracefully)
   */
  async diagnoseImage(
    imageUrl: string,
    context: MlDiagnosticContext,
  ): Promise<MlDiagnosticResult> {
    try {
      const response = await fetch(
        `${this.baseUrl}/moderations/pictures/diagnostic`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.authToken}`,
          },
          body: JSON.stringify({
            picture_url: imageUrl,
            context: {
              category_id: context.categoryId,
              title: context.title,
              picture_type: context.pictureType,
            },
          }),
        },
      );

      if (!response.ok) {
        console.warn(
          `[ml-diagnostic] API returned ${response.status} — deferring to passed: true`,
        );
        return { passed: true, picture_type: context.pictureType, detections: [] };
      }

      const data = (await response.json()) as MlApiDiagnosticResponse;

      // Map the API response
      if (data.action === "empty" || !data.detections || data.detections.length === 0) {
        return { passed: true, picture_type: context.pictureType, detections: [] };
      }

      // Map detections — only include known types
      const knownDetectionNames = new Set([
        "white_background",
        "minimum_size",
        "text_logo",
        "watermark",
      ]);

      const detections = data.detections
        .filter((d) => knownDetectionNames.has(d.name))
        .map((d) => ({
          name: d.name as "white_background" | "minimum_size" | "text_logo" | "watermark",
          wordings: d.wordings,
        }));

      // If no known detections remain after filtering, treat as passed
      if (detections.length === 0) {
        return { passed: true, picture_type: context.pictureType, detections: [] };
      }

      return {
        passed: false,
        picture_type: context.pictureType,
        detections,
      };
    } catch (err) {
      // Non-blocking: log and return passed: true
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ml-diagnostic] API call failed: ${errorMessage} — deferring to passed: true`,
      );
      return { passed: true, picture_type: context.pictureType, detections: [] };
    }
  }
}
