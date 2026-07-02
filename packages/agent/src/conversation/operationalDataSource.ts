import type { OperationalReadModelReader } from "@msl/memory";
import type { SellerId } from "@msl/domain";
import type { DailyDataSource } from "./cacheBlocks.js";

// ── Snapshot data shapes ────────────────────────────────────────────────

type CategoryStatsItem = {
  name: string;
  activeProducts: number;
  monthlySales?: number;
  marginAvg?: number;
};

type OrderVolumeData = { total: number };

type ReputationData = {
  level: string;
  rating: number;
  openClaims: number;
  mediationClaims: number;
  pendingResponse: number;
  resolvedThisMonth: number;
  claimRate: number;
  avgResponseTimeHours: number;
};

// ── Defaults (hardcoded fallback when no operational DB) ─────────────────

const DEFAULT_CATEGORIES: CategoryStatsItem[] = [
  { name: "Hogar y Muebles", activeProducts: 423, monthlySales: 4_200_000, marginAvg: 35.2 },
  { name: "Jardín y Aire Libre", activeProducts: 312, monthlySales: 2_800_000, marginAvg: 28.5 },
  { name: "Herramientas", activeProducts: 198, monthlySales: 1_500_000, marginAvg: 41.0 },
  { name: "Industrias y Oficinas", activeProducts: 187, monthlySales: 980_000, marginAvg: 25.8 },
  { name: "Otras", activeProducts: 127, monthlySales: 340_000, marginAvg: 31.5 },
];

const DEFAULT_VOLUME = 9_820_000;

const DEFAULT_REPUTATION: ReputationData = {
  level: "Platinum",
  rating: 4.8,
  openClaims: 3,
  mediationClaims: 1,
  pendingResponse: 2,
  resolvedThisMonth: 14,
  claimRate: 0.4,
  avgResponseTimeHours: 4.2,
};

// ── Freshness metadata stored alongside cached data ──────────────────────

type FreshnessNote = {
  kind: string;
  evidenceId: string;
  capturedAt: string;
  freshnessStatus: string;
};

function formatFreshnessLine(note: FreshnessNote): string {
  const age = ageDescription(note.capturedAt);
  const iso = stripMillis(note.capturedAt);
  return `[${note.kind}] ${note.evidenceId} captured=${iso} (${note.freshnessStatus}, ${age})`;
}

function stripMillis(isoString: string): string {
  return isoString.replace(/\.\d{3}Z$/, "Z");
}

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

// ── Class ────────────────────────────────────────────────────────────────

/**
 * Operational-backed implementation of {@link DailyDataSource}.
 *
 * Reads pre-aggregated snapshots from the operational read model via a
 * background ingestion cycle (6h).  Gracefully falls back to hardcoded
 * defaults when no operational DB is available.
 *
 * Use the static `create()` factory to pre-load snapshots.  Once created,
 * the getter methods are synchronous and match the {@link DailyDataSource}
 * contract.
 */
export class OperationalDailyDataSource implements DailyDataSource {
  private _categoryStats: CategoryStatsItem[];
  private _monthlyVolume: number;
  private _reputation: ReputationData;
  private _freshnessNotes: FreshnessNote[];

  private constructor(
    categories: CategoryStatsItem[],
    volume: number,
    reputation: ReputationData,
    freshnessNotes: FreshnessNote[],
  ) {
    this._categoryStats = categories;
    this._monthlyVolume = volume;
    this._reputation = reputation;
    this._freshnessNotes = freshnessNotes;
  }

  /**
   * Creates an {@link OperationalDailyDataSource} by pre-loading listing,
   * order, and reputation snapshots from the operational read model.
   *
   * Falls back to hardcoded defaults when any snapshot returns `null`.
   */
  static async create(
    reader: OperationalReadModelReader,
    sellerId: SellerId,
  ): Promise<OperationalDailyDataSource> {
    const [catSnapshot, volSnapshot, repSnapshot] = await Promise.all([
      reader.readSnapshot<CategoryStatsItem[]>({ sellerId, snapshotKind: "listing" }),
      reader.readSnapshot<OrderVolumeData>({ sellerId, snapshotKind: "order" }),
      reader.readSnapshot<ReputationData>({ sellerId, snapshotKind: "reputation" }),
    ]);

    const freshnessNotes: FreshnessNote[] = [];

    // ── Category stats ───────────────────────────────────────────────
    let categories: CategoryStatsItem[];
    if (catSnapshot) {
      const data = catSnapshot.data;
      categories = (Array.isArray(data) ? data : [data]) as CategoryStatsItem[];
      freshnessNotes.push({
        kind: "listing",
        evidenceId: catSnapshot.evidence.evidenceId,
        capturedAt: catSnapshot.evidence.capturedAt.toISOString(),
        freshnessStatus: catSnapshot.evidence.freshnessStatus,
      });
    } else {
      categories = DEFAULT_CATEGORIES;
    }

    // ── Monthly volume ───────────────────────────────────────────────
    let volume: number;
    if (volSnapshot) {
      const data = volSnapshot.data;
      if (typeof data === "number") {
        volume = data;
      } else if (Array.isArray(data)) {
        volume = (data as readonly OrderVolumeData[]).reduce(
          (sum: number, o: OrderVolumeData) => sum + (o.total ?? 0),
          0,
        );
      } else {
        volume = (data as OrderVolumeData).total ?? DEFAULT_VOLUME;
      }
      freshnessNotes.push({
        kind: "order",
        evidenceId: volSnapshot.evidence.evidenceId,
        capturedAt: volSnapshot.evidence.capturedAt.toISOString(),
        freshnessStatus: volSnapshot.evidence.freshnessStatus,
      });
    } else {
      volume = DEFAULT_VOLUME;
    }

    // ── Reputation ───────────────────────────────────────────────────
    let reputation: ReputationData;
    if (repSnapshot) {
      const data = repSnapshot.data;
      reputation = (Array.isArray(data) ? (data[0] as ReputationData) : data) as ReputationData;
      freshnessNotes.push({
        kind: "reputation",
        evidenceId: repSnapshot.evidence.evidenceId,
        capturedAt: repSnapshot.evidence.capturedAt.toISOString(),
        freshnessStatus: repSnapshot.evidence.freshnessStatus,
      });
    } else {
      reputation = DEFAULT_REPUTATION;
    }

    return new OperationalDailyDataSource(categories, volume, reputation, freshnessNotes);
  }

  getCategoryStats(): CategoryStatsItem[] {
    return this._categoryStats;
  }

  getMonthlyVolume(): number {
    return this._monthlyVolume;
  }

  getReputation(): ReputationData {
    return this._reputation;
  }

  /**
   * Returns formatted freshness metadata for all loaded snapshots.
   *
   * Each line is ≤ 80 chars and follows the format:
   * `"[kind] evt-XX captured=ISO8601 (fresh|stale, Xh ago)"`
   */
  getFreshnessNotes(): string {
    if (this._freshnessNotes.length === 0) return "";
    return this._freshnessNotes.map(formatFreshnessLine).join("\n");
  }
}
