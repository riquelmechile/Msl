import type { ApprovalRecord } from "./approval.js";
import type { AuditId, PreparedAction } from "./preparedAction.js";

export type AuditStatus = "blocked" | "executed" | "failed";

export type AuditRecord = {
  id: AuditId;
  sellerId: PreparedAction["sellerId"];
  actionId: PreparedAction["id"];
  approvedBy?: ApprovalRecord["approvedBy"];
  exactChange: PreparedAction["exactChange"];
  rationale: PreparedAction["rationale"];
  riskLevel: PreparedAction["riskLevel"];
  status: AuditStatus;
  recordedAt: Date;
  resultMessage: string;
};

export function createBlockedAuditRecord(input: {
  id: AuditId;
  action: PreparedAction;
  reason: string;
  recordedAt: Date;
}): AuditRecord {
  return {
    id: input.id,
    sellerId: input.action.sellerId,
    actionId: input.action.id,
    exactChange: input.action.exactChange,
    rationale: input.action.rationale,
    riskLevel: input.action.riskLevel,
    status: "blocked",
    recordedAt: input.recordedAt,
    resultMessage: input.reason,
  };
}
