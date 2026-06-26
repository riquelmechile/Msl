import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { createDatabase } from "../../src/cortex/database.js";
import { GraphEngine } from "../../src/cortex/engine.js";
import type { ActorType } from "../../src/cortex/types.js";

const compradorTraits = {
  price_sensitivity: "high",
  trust_drivers: "reputation",
  shipping_preference: "gratis",
};
const proveedorTraits = {
  min_order: 10,
  lead_time_days: 3,
  negotiation_levers: "volume_discount",
};
const competidorTraits = {
  avg_price: 15000,
  strategy: "undercut",
  listing_count: 42,
};

const defaultProfiles: Array<{ actorType: ActorType; traits: Record<string, unknown> }> = [
  { actorType: "comprador", traits: compradorTraits },
  { actorType: "proveedor", traits: proveedorTraits },
  { actorType: "competidor", traits: competidorTraits },
];

describe("actor_simulations table", () => {
  it("is created by createDatabase", () => {
    const db = createDatabase(":memory:");
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("actor_simulations");
  });
});

describe("seedActorNodes", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("creates 3 nodes with correct activation and metadata", () => {
    const ids = engine.seedActorNodes(defaultProfiles);

    expect(ids).toHaveLength(3);

    for (const id of ids) {
      const node = engine.getNode(id);
      expect(node).not.toBeNull();
      expect(node!.activation).toBe(0.5);

      const meta = JSON.parse(node!.metadata) as {
        type: string;
        persona: string;
      };
      expect(meta.type).toBe("actor_profile");
      expect(["comprador", "proveedor", "competidor"]).toContain(meta.persona);
    }
  });

  it("stores each actor's traits in metadata", () => {
    engine.seedActorNodes(defaultProfiles);

    const compradorNode = engine.getActorNode("comprador");
    expect(compradorNode).not.toBeNull();
    const compMeta = JSON.parse(compradorNode!.metadata) as {
      traits: string[];
    };
    expect(compMeta.traits).toEqual(compradorTraits);

    const proveedorNode = engine.getActorNode("proveedor");
    expect(proveedorNode).not.toBeNull();
    const provMeta = JSON.parse(proveedorNode!.metadata) as {
      traits: string[];
    };
    expect(provMeta.traits).toEqual(proveedorTraits);

    const competidorNode = engine.getActorNode("competidor");
    expect(competidorNode).not.toBeNull();
    const comp2Meta = JSON.parse(competidorNode!.metadata) as {
      traits: string[];
    };
    expect(comp2Meta.traits).toEqual(competidorTraits);
  });

  it("is idempotent — re-seeding updates, does not duplicate", () => {
    const firstIds = engine.seedActorNodes(defaultProfiles);

    // Re-seed with same profiles
    const secondIds = engine.seedActorNodes(defaultProfiles);

    // Same IDs returned
    expect(secondIds).toEqual(firstIds);

    // Node count remains 3
    const count = (db.prepare("SELECT COUNT(*) as cnt FROM nodes").get() as { cnt: number }).cnt;
    expect(count).toBe(3);
  });
});

describe("getActorNode", () => {
  let engine: GraphEngine;

  beforeEach(() => {
    const db = createDatabase(":memory:");
    engine = new GraphEngine(db);
    engine.seedActorNodes(defaultProfiles);
  });

  it("returns the comprador node", () => {
    const node = engine.getActorNode("comprador");
    expect(node).not.toBeNull();
    expect(node!.label).toBe("actor_comprador");
  });

  it("returns the proveedor node", () => {
    const node = engine.getActorNode("proveedor");
    expect(node).not.toBeNull();
    expect(node!.label).toBe("actor_proveedor");
  });

  it("returns the competidor node", () => {
    const node = engine.getActorNode("competidor");
    expect(node).not.toBeNull();
    expect(node!.label).toBe("actor_competidor");
  });

  it("returns null for an invalid actor type", () => {
    const node = engine.getActorNode("unknown" as ActorType);
    expect(node).toBeNull();
  });
});

describe("reinforceActorOutcome", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
    engine.seedActorNodes(defaultProfiles);
  });

  it("strengthens edges from actor node on success", () => {
    const comprador = engine.getActorNode("comprador")!;
    const ctx1 = engine.createNode("precio_bajo");
    const ctx2 = engine.createNode("envio_gratis");

    const edge1 = engine.createEdge(comprador.id, ctx1.id);
    const edge2 = engine.createEdge(comprador.id, ctx2.id);

    expect(edge1.weight).toBe(0.5);
    expect(edge2.weight).toBe(0.5);

    engine.reinforceActorOutcome("comprador", true);

    const e1 = engine.getEdge(edge1.id)!;
    const e2 = engine.getEdge(edge2.id)!;
    expect(e1.weight).toBe(0.6);
    expect(e1.last_activated).not.toBeNull();
    expect(e2.weight).toBe(0.6);
    expect(e2.last_activated).not.toBeNull();
  });

  it("weakens edges from actor node on failure", () => {
    const comprador = engine.getActorNode("comprador")!;
    const ctx = engine.createNode("precio_alto");

    const edge = engine.createEdge(comprador.id, ctx.id);
    expect(edge.weight).toBe(0.5);

    engine.reinforceActorOutcome("comprador", false);

    const after = engine.getEdge(edge.id)!;
    expect(after.weight).toBe(0.35);
    expect(after.last_activated).not.toBeNull();
  });

  it("clamps weight to 0.0 on repeated penalization", () => {
    const comprador = engine.getActorNode("comprador")!;
    const ctx = engine.createNode("target");

    const edge = engine.createEdge(comprador.id, ctx.id);
    // Manually set weight to 0.10
    db.prepare("UPDATE edges SET weight = 0.10 WHERE id = ?").run(edge.id);

    engine.reinforceActorOutcome("comprador", false);

    const after = engine.getEdge(edge.id)!;
    // 0.10 - 0.15 = -0.05 → clamped to 0.0
    expect(after.weight).toBe(0.0);
  });

  it("clamps weight to 1.0 on repeated reinforcement", () => {
    const comprador = engine.getActorNode("comprador")!;
    const ctx = engine.createNode("target");

    const edge = engine.createEdge(comprador.id, ctx.id);
    // Manually set weight to 0.95
    db.prepare("UPDATE edges SET weight = 0.95 WHERE id = ?").run(edge.id);

    engine.reinforceActorOutcome("comprador", true);

    const after = engine.getEdge(edge.id)!;
    // 0.95 + 0.1 = 1.05 → clamped to 1.0
    expect(after.weight).toBe(1.0);
  });

  it("does nothing when no edges exist for the actor", () => {
    // No edges created — reinforce should not throw
    expect(() => engine.reinforceActorOutcome("comprador", true)).not.toThrow();
    expect(() => engine.reinforceActorOutcome("comprador", false)).not.toThrow();
  });

  it("does not affect edges where the actor is the target, not the source", () => {
    const comprador = engine.getActorNode("comprador")!;
    const ctx = engine.createNode("context");

    // Edge: context → comprador (comprador is target)
    const edge = engine.createEdge(ctx.id, comprador.id);
    expect(edge.weight).toBe(0.5);

    engine.reinforceActorOutcome("comprador", true);

    // Target edges are NOT affected — only source edges
    const after = engine.getEdge(edge.id)!;
    expect(after.weight).toBe(0.5);
  });

  it("is a no-op for unknown actor types", () => {
    expect(() => engine.reinforceActorOutcome("unknown" as ActorType, true)).not.toThrow();
  });
});

describe("recordSimulation", () => {
  let db: Database.Database;
  let engine: GraphEngine;

  beforeEach(() => {
    db = createDatabase(":memory:");
    engine = new GraphEngine(db);
  });

  it("inserts a row and returns the id", () => {
    const result = {
      actorType: "comprador" as ActorType,
      recommendation: "Bajar precio 10%",
      confidence: 0.85,
      rationale: "Alta sensibilidad al precio en esta categoria",
      simulationId: "sim-001",
    };

    const id = engine.recordSimulation("comprador", "¿Comprarias a $15.000?", result);

    expect(id).toBeGreaterThan(0);

    const row = db.prepare("SELECT * FROM actor_simulations WHERE id = ?").get(id) as {
      id: number;
      actor_type: string;
      query: string;
      result: string;
      created_at: string;
    };

    expect(row.actor_type).toBe("comprador");
    expect(row.query).toBe("¿Comprarias a $15.000?");
    expect(row.created_at).toBeTruthy();

    const parsed = JSON.parse(row.result) as Record<string, unknown>;
    expect(parsed).toEqual(result);
  });

  it("returns increasing ids for sequential inserts", () => {
    const result = {
      actorType: "proveedor" as ActorType,
      recommendation: "Mantener precio",
      confidence: 0.7,
      rationale: "Sin cambios relevantes",
      simulationId: "sim-002",
    };

    const id1 = engine.recordSimulation("proveedor", "test 1", result);
    const id2 = engine.recordSimulation("proveedor", "test 2", result);

    expect(id2).toBe(id1 + 1);
  });
});
