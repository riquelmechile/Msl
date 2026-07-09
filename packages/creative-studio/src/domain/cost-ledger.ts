export type CostLedgerConfig = {
  maxDailyUsd: number;
  maxJobUsd: number;
};

export class CostLedger {
  private dailySpentUsd: number = 0;
  private lastResetDate: string;
  private readonly config: CostLedgerConfig;

  constructor(config: CostLedgerConfig) {
    this.config = config;
    this.lastResetDate = this.todayUtc();
  }

  private todayUtc(): string {
    const now = new Date();
    return (
      `${now.getUTCFullYear()}-` +
      `${String(now.getUTCMonth() + 1).padStart(2, "0")}-` +
      `${String(now.getUTCDate()).padStart(2, "0")}`
    );
  }

  private checkReset(): void {
    const today = this.todayUtc();
    if (today !== this.lastResetDate) {
      this.dailySpentUsd = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Check whether a job with the given estimated cost can be afforded.
   * Resets daily spend at UTC midnight.
   */
  canAfford(estimatedCostUsd: number): { allowed: boolean; reason?: string } {
    this.checkReset();

    if (estimatedCostUsd > this.config.maxJobUsd) {
      return {
        allowed: false,
        reason: `Job cost $${estimatedCostUsd} exceeds max job USD $${this.config.maxJobUsd}`,
      };
    }

    const projectedTotal = this.dailySpentUsd + estimatedCostUsd;
    if (projectedTotal > this.config.maxDailyUsd) {
      return {
        allowed: false,
        reason:
          `Daily budget exceeded ($${this.config.maxDailyUsd} USD limit, ` +
          `$${this.dailySpentUsd} already spent)`,
      };
    }

    return { allowed: true };
  }

  /** Record a completed spend amount. */
  recordSpend(amountUsd: number): void {
    this.checkReset();
    this.dailySpentUsd += amountUsd;
  }

  /** Get the current accumulated daily spend. */
  getDailySpent(): number {
    this.checkReset();
    return this.dailySpentUsd;
  }

  /** Return a copy of the current config. */
  getConfig(): CostLedgerConfig {
    return { ...this.config };
  }
}
