import type { OperationalReadModelReader } from "@msl/memory";
import type { BusinessSignalKind, OperationalEvidenceCompleteness, SellerId } from "@msl/domain";
import type { LaneId } from "./lanes.js";
import { getLaneContract } from "./lanes.js";

// ── Mapping: requiredEvidenceKinds → BusinessSignalKind[] ────────────────

/**
 * Hardcoded lane-to-signal mapping.
 *
 * Keys match {@link LaneContract.requiredEvidenceKinds} strings.
 * Each value lists the {@link BusinessSignalKind}s that provide
 * operational evidence for that evidence kind.
 */
const KIND_SIGNAL_MAP = new Map<string, BusinessSignalKind[]>([
  ["cost", ["listing", "order"]],
  ["supplier", ["listing"]],
  ["margin", ["pricing"]],
  ["catalog", ["listing", "order", "claim"]],
  ["stock", ["stock"]],
  ["market", ["pricing", "product-ads-insights"]],
  ["product", ["listing"]],
  ["campaign", ["product-ads-insights"]],
  ["outcome", ["order", "claim"]],
]);

// ── Helpers ──────────────────────────────────────────────────────────────

function ageDescription(isoTimestamp: string): string {
  const captured = new Date(isoTimestamp).getTime();
  const now = Date.now();
  const diffMs = now - captured;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatEvidenceLine(
  kind: BusinessSignalKind,
  evidenceId: string,
  capturedAt: string,
  freshnessStatus: "fresh" | "stale",
  completeness: OperationalEvidenceCompleteness,
): string {
  const age = ageDescription(capturedAt);
  const iso = stripMillis(capturedAt);
  if (kind === "pricing") {
    const label = completeness === "complete" ? "evidence-only" : "limited-evidence";
    return `[pricing:${label}] ${evidenceId} captured=${iso} (${freshnessStatus}, ${age})`;
  }
  return `[${kind}] ${evidenceId} captured=${iso} (${freshnessStatus}, ${age})`;
}

function stripMillis(isoString: string): string {
  return isoString.replace(/\.\d{3}Z$/, "Z");
}

// ── Class ────────────────────────────────────────────────────────────────

/**
 * Provides per-lane operational evidence by mapping lane contracts
 * to business signal kinds and querying the operational read model.
 *
 * Evidence is formatted as compact one-line-per-item strings suitable
 * for LLM prompt injection (≤ 80 chars per line).
 */
export class OperationalEvidenceProvider {
  private _reader: OperationalReadModelReader;

  constructor(reader: OperationalReadModelReader) {
    this._reader = reader;
  }

  /**
   * Returns formatted operational evidence context for a given lane.
   *
   * Resolves the lane contract, extracts `requiredEvidenceKinds`,
   * maps each kind to its {@link BusinessSignalKind}s, queries
   * `findEvidence` for each signal, and formats the results.
   *
   * @param laneId  - The specialisation lane.
   * @param sellerId - The seller to query evidence for.
   * @returns Multi-line evidence string (one line per item), or `""`
   *          when the lane is unknown or no evidence is available.
   */
  async getEvidenceForLane(laneId: LaneId, sellerId: SellerId): Promise<string> {
    let contract;
    try {
      contract = getLaneContract(laneId);
    } catch {
      // Unknown lane — return empty context.
      return "";
    }

    // Collect BusinessSignalKind[] for every required evidence kind.
    const signalKinds: BusinessSignalKind[] = [];
    for (const ek of contract.requiredEvidenceKinds) {
      const mapped = KIND_SIGNAL_MAP.get(ek);
      if (mapped) {
        for (const sk of mapped) {
          if (!signalKinds.includes(sk)) {
            signalKinds.push(sk);
          }
        }
      }
    }

    if (signalKinds.length === 0) {
      return "";
    }

    // Query operational DB per signal kind.
    const lines: string[] = [];
    for (const sk of signalKinds) {
      const evidence = await this._reader.findEvidence({
        sellerId,
        snapshotKind: sk,
      });

      if (evidence) {
        lines.push(
          formatEvidenceLine(
            sk,
            evidence.evidenceId,
            evidence.capturedAt.toISOString(),
            evidence.freshnessStatus,
            evidence.completeness,
          ),
        );
      }
    }

    return lines.join("\n");
  }
}
