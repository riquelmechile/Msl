import type { MlDiagnosticResult } from "../contracts/creative-requests.js";

export type CreativeAssetKind = "image" | "video" | "audio" | "music";

export interface CreativeAsset {
  assetId: string;
  jobId: string;
  kind: CreativeAssetKind;
  storageUri: string;
  sha256: string;
  mlDiagnostic?: MlDiagnosticResult;
  policyFlags: string[];
}

export interface CreateCreativeAssetParams {
  jobId: string;
  kind: CreativeAssetKind;
  storageUri: string;
  sha256: string;
  mlDiagnostic?: MlDiagnosticResult;
  policyFlags?: string[];
}

/**
 * Factory function to create a CreativeAsset.
 * Generates a unique assetId and applies default policyFlags.
 */
export function createCreativeAsset(params: CreateCreativeAssetParams): CreativeAsset {
  return {
    assetId: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
    jobId: params.jobId,
    kind: params.kind,
    storageUri: params.storageUri,
    sha256: params.sha256,
    mlDiagnostic: params.mlDiagnostic,
    policyFlags: params.policyFlags ?? [],
  };
}
