export type RunIdFactory = {
  createRunId(): string;
};

export class CryptoRunIdFactory implements RunIdFactory {
  createRunId(): string {
    return `economic-ingestion-${crypto.randomUUID()}`;
  }
}

export class DeterministicRunIdFactory implements RunIdFactory {
  private readonly ids: readonly string[];
  private index: number;

  constructor(ids: readonly string[]) {
    if (ids.length === 0) {
      throw new Error("DeterministicRunIdFactory requires at least one ID");
    }
    this.ids = ids;
    this.index = 0;
  }

  createRunId(): string {
    const id = this.ids[this.index]!;
    this.index = (this.index + 1) % this.ids.length;
    return id;
  }
}
