import { describe, expect, it } from "vitest";
import { ECONOMIC_SQLITE_WRITERS } from "../src/economicWriterInventory.js";

describe("R5 economic SQLite writer inventory", () => {
  it("contains a seller, receipt, fence, and epoch policy for every discovered writer", () => {
    expect(ECONOMIC_SQLITE_WRITERS.map(([writer]) => writer).sort()).toEqual([
      "alert-intent",
      "backlog",
      "checkpoint",
      "component",
      "evidence",
      "outcome",
      "run",
      "snapshot",
      "source-health",
    ]);
    for (const [
      ,
      ,
      ,
      sellerScoped,
      receiptRequired,
      fenceRequired,
      epochAdvances,
    ] of ECONOMIC_SQLITE_WRITERS) {
      expect(sellerScoped).toBe(true);
      expect(receiptRequired).toBe(true);
      expect(fenceRequired).toBe(true);
      expect(epochAdvances).toBe(true);
    }
  });
});
