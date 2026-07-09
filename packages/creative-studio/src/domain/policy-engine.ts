import type { CreativeAssetRequest, CreativeJobKind } from "../contracts/creative-requests.js";

const productKinds: CreativeJobKind[] = [
  "product-cover-i2i",
  "product-gallery-i2i",
  "product-clip-6s",
  "product-clip-10s",
  "ml-clip-vertical-30s",
];

const i2iKinds: CreativeJobKind[] = ["product-cover-i2i", "product-gallery-i2i"];

export class PolicyEngine {
  /**
   * Validate a creative asset request against pre-flight policy rules.
   *
   * Rules:
   * 1. preserveProductTruth requires at least one reference for product kinds
   * 2. requestId must start with "cj_"
   * 3. Product kinds require at least one reference
   * 4. Image-to-image kinds require at least one reference (no empty prompt equivalents)
   */
  validate(request: CreativeAssetRequest): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Rule 1: preserveProductTruth constraint requires references for product kinds
    if (request.constraints.preserveProductTruth && productKinds.includes(request.kind)) {
      if (request.references.length === 0) {
        issues.push(`preserveProductTruth requires at least one reference for ${request.kind}`);
      }
    }

    // Rule 2: requestId format
    if (!request.requestId.startsWith("cj_")) {
      issues.push("requestId must start with 'cj_' prefix");
    }

    // Rule 3: product kinds require references
    if (productKinds.includes(request.kind) && request.references.length === 0) {
      issues.push(`${request.kind} requires at least one reference`);
    }

    // Rule 4: image-to-image kinds require references (empty prompt guard)
    if (i2iKinds.includes(request.kind) && request.references.length === 0) {
      issues.push("image-to-image kinds require at least one reference image as prompt equivalent");
    }

    return { valid: issues.length === 0, issues };
  }
}
