import { describe, it, expect } from "vitest";
import { CryptoRunIdFactory, DeterministicRunIdFactory } from "./runIdFactory.js";

describe("RunIdFactory", () => {
  describe("CryptoRunIdFactory", () => {
    it("generates unique IDs", () => {
      const factory = new CryptoRunIdFactory();
      const id1 = factory.createRunId();
      const id2 = factory.createRunId();
      expect(id1).not.toBe(id2);
    });

    it("generates 10,000 IDs with no collision", () => {
      const factory = new CryptoRunIdFactory();
      const ids = new Set<string>();
      for (let i = 0; i < 10_000; i++) {
        const id = factory.createRunId();
        ids.add(id);
      }
      // Every ID must be unique
      expect(ids.size).toBe(10_000);
    });

    it("format matches economic-ingestion-{uuid}", () => {
      const factory = new CryptoRunIdFactory();
      const id = factory.createRunId();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
      const uuidPattern =
        /^economic-ingestion-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(id).toMatch(uuidPattern);
    });
  });

  describe("DeterministicRunIdFactory", () => {
    it("returns predefined sequence in order", () => {
      const factory = new DeterministicRunIdFactory(["run-a", "run-b", "run-c"]);
      expect(factory.createRunId()).toBe("run-a");
      expect(factory.createRunId()).toBe("run-b");
      expect(factory.createRunId()).toBe("run-c");
    });

    it("cycles on exhaustion", () => {
      const factory = new DeterministicRunIdFactory(["r1", "r2"]);
      expect(factory.createRunId()).toBe("r1");
      expect(factory.createRunId()).toBe("r2");
      expect(factory.createRunId()).toBe("r1");
      expect(factory.createRunId()).toBe("r2");
    });

    it("throws when constructed with empty array", () => {
      expect(() => new DeterministicRunIdFactory([])).toThrow(
        "DeterministicRunIdFactory requires at least one ID",
      );
    });

    it("works with single ID (always returns same)", () => {
      const factory = new DeterministicRunIdFactory(["only"]);
      expect(factory.createRunId()).toBe("only");
      expect(factory.createRunId()).toBe("only");
      expect(factory.createRunId()).toBe("only");
    });
  });
});
