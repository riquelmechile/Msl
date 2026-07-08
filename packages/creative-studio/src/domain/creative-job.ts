import type {
  CreativeAssetRequest,
  CreativeJobKind,
  CreativeChannel,
  CreativeJobStatus,
} from "../contracts/creative-requests.js";

export interface CreativeJob {
  jobId: string;
  requestId: string;
  kind: CreativeJobKind;
  channel: CreativeChannel;
  status: CreativeJobStatus;
  provider: string;
  estimatedCost: number;
  actualCost?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Factory function to create a CreativeJob from a CreativeAssetRequest.
 * The job starts in "queued" status with no provider assigned.
 */
export function createCreativeJob(request: CreativeAssetRequest): CreativeJob {
  const now = new Date();
  return {
    jobId: `cj_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
    requestId: request.requestId,
    kind: request.kind,
    channel: request.channel,
    status: "queued",
    provider: "",
    estimatedCost: 0,
    createdAt: now,
    updatedAt: now,
  };
}
