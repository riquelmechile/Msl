import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import type { MlcCategoryAttributeSummary } from "@msl/mercadolibre";
import { enqueueProductLaunchResult, parseProductLaunchEnvelope } from "./productLaunchEnvelope.js";

// ── Input / Output types ─────────────────────────────────────────────

export type SpecTechnicianInput = {
  categoryId: string;
  brand: string;
  model: string;
  color?: string;
  sellerId?: string;
};

export type AttributeMapping = {
  id: string;
  name: string;
  valueId?: string;
  valueName?: string;
};

export type SpecTechnicianOutput = {
  requiredAttributes: AttributeMapping[];
  missingAttributes: string[];
  completenessPercent: number;
};

// ── Attribute mapping helpers ────────────────────────────────────────

function findMatchingValue(
  attribute: MlcCategoryAttributeSummary,
  productValues: string[],
): { valueId?: string; valueName?: string } {
  if (!attribute.values || attribute.values.length === 0) return {};

  const lowerProductValues = productValues.map((v) => v.toLowerCase().trim());
  for (const val of attribute.values) {
    const valName = (val.name ?? "").toLowerCase().trim();
    const valId = val.id;
    if (lowerProductValues.some((pv) => pv.includes(valName) || valName.includes(pv))) {
      const result: { valueId?: string; valueName?: string } = {};
      if (valId) result.valueId = valId;
      if (val.name) result.valueName = val.name;
      return result;
    }
  }

  return {};
}

const BRAND_ATTRIBUTE_IDS = new Set(["BRAND", "brand", "marca", "MARCA"]);

const MODEL_ATTRIBUTE_IDS = new Set(["MODEL", "model", "modelo", "MODELO"]);

const COLOR_ATTRIBUTE_IDS = new Set(["COLOR", "color", "COLOR_PRINCIPAL", "MAIN_COLOR"]);

function isBrandAttribute(attr: MlcCategoryAttributeSummary): boolean {
  return (
    BRAND_ATTRIBUTE_IDS.has(attr.id) ||
    (attr.name !== undefined && BRAND_ATTRIBUTE_IDS.has(attr.name.toUpperCase()))
  );
}

function isModelAttribute(attr: MlcCategoryAttributeSummary): boolean {
  return (
    MODEL_ATTRIBUTE_IDS.has(attr.id) ||
    (attr.name !== undefined && MODEL_ATTRIBUTE_IDS.has(attr.name.toUpperCase()))
  );
}

function isColorAttribute(attr: MlcCategoryAttributeSummary): boolean {
  return (
    COLOR_ATTRIBUTE_IDS.has(attr.id) ||
    (attr.name !== undefined && COLOR_ATTRIBUTE_IDS.has(attr.name.toUpperCase()))
  );
}

// ── ML Catalog attribute validation ──────────────────────────────────

async function validateAttributes(
  input: SpecTechnicianInput,
  mlcClient: Parameters<DaemonHandler>[0]["mlcClient"],
  sellerId: string,
): Promise<SpecTechnicianOutput> {
  if (!mlcClient) return stubValidate(input);

  try {
    const snapshot = await mlcClient.getCategoryAttributes(sellerId, input.categoryId);
    const attributes: readonly MlcCategoryAttributeSummary[] = Array.isArray(snapshot.data)
      ? snapshot.data
      : (snapshot as unknown as { data: unknown }).data
        ? (snapshot.data as MlcCategoryAttributeSummary[])
        : [];

    const requiredAttrs = attributes.filter(
      (attr) =>
        (attr.required || attr.catalogRequired) && !attr.variationAttribute && !attr.readOnly,
    );

    const mapped: AttributeMapping[] = [];
    const missing: string[] = [];

    for (const attr of requiredAttrs) {
      const attrName = attr.name ?? attr.id;

      if (isBrandAttribute(attr)) {
        const match = findMatchingValue(attr, [input.brand]);
        mapped.push({
          id: attr.id,
          name: attrName,
          ...(match.valueId ? { valueId: match.valueId } : {}),
          ...(match.valueName ? { valueName: match.valueName } : { valueName: input.brand }),
        });
        continue;
      }

      if (isModelAttribute(attr)) {
        const match = findMatchingValue(attr, [input.model]);
        mapped.push({
          id: attr.id,
          name: attrName,
          ...(match.valueId ? { valueId: match.valueId } : {}),
          ...(match.valueName ? { valueName: match.valueName } : { valueName: input.model }),
        });
        continue;
      }

      if (isColorAttribute(attr) && input.color) {
        const match = findMatchingValue(attr, [input.color]);
        mapped.push({
          id: attr.id,
          name: attrName,
          ...(match.valueId ? { valueId: match.valueId } : {}),
          ...(match.valueName ? { valueName: match.valueName } : { valueName: input.color }),
        });
        continue;
      }

      // Attribute we cannot auto-fill
      missing.push(attrName);
    }

    const completenessPercent =
      requiredAttrs.length > 0 ? Math.round((mapped.length / requiredAttrs.length) * 100) : 100;

    return {
      requiredAttributes: mapped,
      missingAttributes: missing,
      completenessPercent,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[spec-technician] ML category attributes call failed: ${errorMessage}`);
    return stubValidate(input);
  }
}

// ── Stub mode ────────────────────────────────────────────────────────

function stubValidate(input: SpecTechnicianInput): SpecTechnicianOutput {
  console.warn("[spec-technician] mlcClient not available — returning mock attribute schema");

  const stubAttrs: AttributeMapping[] = [
    { id: "BRAND", name: "Marca", valueName: input.brand },
    { id: "MODEL", name: "Modelo", valueName: input.model },
  ];

  if (input.color) {
    stubAttrs.push({ id: "COLOR", name: "Color principal", valueName: input.color });
  }

  return {
    requiredAttributes: stubAttrs,
    missingAttributes: [],
    completenessPercent: 100,
  };
}

// ── Daemon handler ──────────────────────────────────────────────────

/**
 * Spec Technician daemon handler.
 *
 * Claims messages with `receiverAgentId: "listing-composition"`.
 *
 * 1. Parse the claimed message payload as SpecTechnicianInput
 * 2. Call ML API to get required + conditional_required attributes for the category
 * 3. Map recognized product data (brand, model, color) to ML value_ids
 * 4. Flag missing required attributes
 * 5. Return findings with attribute validation result
 */
export const specTechnician: DaemonHandler = async ({ claim, bus, sellerIds, mlcClient }) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];

  // ── 1. Parse input ────────────────────────────────────────────
  let input: SpecTechnicianInput;
  try {
    input = JSON.parse(claim.payloadJson) as SpecTechnicianInput;
  } catch {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Spec Technician: invalid payload — could not parse SpecTechnicianInput",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  const launchEnvelope = parseProductLaunchEnvelope(claim);
  if (launchEnvelope && !input.categoryId) input.categoryId = launchEnvelope.category ?? "unknown";

  if (!input.categoryId) {
    findings.push({
      kind: "alert",
      severity: "warning",
      summary: "Spec Technician: missing categoryId in payload",
      evidenceIds: [claim.messageId],
    });
    return { findings, proposalEnqueued: false, messageIds };
  }

  const sellerId = launchEnvelope?.sellerId ?? input.sellerId ?? sellerIds[0] ?? "default";

  // ── 2. Validate attributes ────────────────────────────────────
  const output = await validateAttributes(input, mlcClient, sellerId);

  if (launchEnvelope) {
    const message = enqueueProductLaunchResult(bus, claim, launchEnvelope, {
      attributesJson: JSON.stringify(output.requiredAttributes),
    });
    messageIds.push(message.messageId);
    findings.push({
      kind: output.missingAttributes.length > 0 ? "alert" : "opportunity",
      severity: output.missingAttributes.length > 0 ? "warning" : "info",
      summary: `Spec Technician: ${output.completenessPercent}% complete`,
      evidenceIds: [claim.messageId, message.messageId],
    });
    return { findings, proposalEnqueued: true, messageIds };
  }

  // ── 3. Enqueue result ──────────────────────────────────────────
  const summary =
    output.missingAttributes.length > 0
      ? `Spec Technician: ${output.requiredAttributes.length} attrs mapped, ${output.missingAttributes.length} missing (${output.completenessPercent}%) for category ${input.categoryId}`
      : `Spec Technician: all ${output.requiredAttributes.length} attrs mapped (100%) for category ${input.categoryId}`;

  const severity = output.missingAttributes.length > 0 ? "warning" : "info";
  const kind = output.missingAttributes.length > 0 ? "alert" : "opportunity";

  const payload: Record<string, unknown> = {
    type: "finding",
    summary,
    specValidation: output,
    input: {
      categoryId: input.categoryId,
      brand: input.brand,
      model: input.model,
      ...(input.color ? { color: input.color } : {}),
    },
    nextAction: output.completenessPercent >= 80 ? "inspect_quality" : "resolve_missing_attrs",
    noMutationExecuted: true,
    capturedAt: new Date().toISOString(),
  };

  const message = bus.enqueue({
    senderAgentId: "listing-composition",
    receiverAgentId: "listing-composition",
    messageType: "spec-validation-result",
    payloadJson: JSON.stringify(payload),
    dedupeKey: `spec-technician-${claim.messageId}`,
  });
  messageIds.push(message.messageId);

  findings.push({
    kind,
    severity,
    summary,
    evidenceIds: [claim.messageId, message.messageId],
  });

  return { findings, proposalEnqueued: true, messageIds };
};
