import { describe, it } from "node:test";
import assert from "node:assert";
import {
  assignZonesToOperators,
  violatesKitchenBathroomRule,
  type ZoneWeight,
} from "../../src/lib/zone-reparto";

describe("assignZonesToOperators", () => {
  it("devuelve arreglo vacío si operatorCount <= 0", () => {
    assert.deepEqual(assignZonesToOperators([{ zone: "kitchen", weight: 3 }], 0), []);
  });

  it("ejemplo exacto del plan D.7 (2 habitaciones, N=2)", () => {
    // Cocina 3.0 + Baño 3.0 + Sala 2.0 + 2×Habitación 1.5 + Pasillo 0.5 = 11.5
    const zones: ZoneWeight[] = [
      { zone: "kitchen", weight: 3.0 },
      { zone: "bathroom", weight: 3.0 },
      { zone: "living", weight: 2.0 },
      { zone: "bedroom_1", weight: 1.5 },
      { zone: "bedroom_2", weight: 1.5 },
      { zone: "hallway", weight: 0.5 },
    ];
    const result = assignZonesToOperators(zones, 2);
    assert.equal(result.length, 2);
    assert.equal(violatesKitchenBathroomRule(result), false);

    // Balance razonable: ningún operario debería quedar con >70% del peso total
    const total = result.reduce((s, o) => s + o.totalWeight, 0);
    for (const op of result) {
      assert.ok(op.totalWeight / total <= 0.7, `operario ${op.operatorIndex} desbalanceado`);
    }
  });

  it("regla dura: nunca Cocina + Baño con la misma persona si N>=2 (property test)", () => {
    // Genera muchos escenarios de pesos aleatorios con Cocina y Baño presentes
    // y N entre 2 y 6, y verifica la regla dura en todos.
    const otherZones = ["living", "bedroom", "hallway", "laundry", "balcony", "windows"];
    let seed = 42;
    const rand = () => {
      // PRNG determinístico simple para reproducibilidad del test
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let trial = 0; trial < 200; trial++) {
      const N = 2 + Math.floor(rand() * 5); // 2..6
      const extraCount = Math.floor(rand() * otherZones.length);
      const zones: ZoneWeight[] = [
        { zone: "kitchen", weight: 1 + rand() * 4 },
        { zone: "bathroom", weight: 1 + rand() * 4 },
        ...otherZones.slice(0, extraCount).map((z) => ({ zone: z, weight: 0.5 + rand() * 2 })),
      ];

      const result = assignZonesToOperators(zones, N);
      assert.equal(
        violatesKitchenBathroomRule(result),
        false,
        `trial ${trial} violó la regla con N=${N}: ${JSON.stringify(result)}`
      );
    }
  });

  it("con N=1, Cocina y Baño caen en el único operario (la regla dura no aplica)", () => {
    const zones: ZoneWeight[] = [
      { zone: "kitchen", weight: 3 },
      { zone: "bathroom", weight: 3 },
    ];
    const result = assignZonesToOperators(zones, 1);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].zones.sort(), ["bathroom", "kitchen"]);
  });

  it("todas las zonas quedan asignadas exactamente una vez", () => {
    const zones: ZoneWeight[] = [
      { zone: "kitchen", weight: 3 },
      { zone: "bathroom", weight: 3 },
      { zone: "living", weight: 2 },
      { zone: "bedroom", weight: 1.5 },
    ];
    const result = assignZonesToOperators(zones, 2);
    const allAssigned = result.flatMap((o) => o.zones).sort();
    assert.deepEqual(allAssigned, ["bathroom", "bedroom", "kitchen", "living"].sort());
  });
});

describe("violatesKitchenBathroomRule", () => {
  it("false si hay menos de 2 operarios", () => {
    assert.equal(
      violatesKitchenBathroomRule([{ operatorIndex: 0, zones: ["kitchen", "bathroom"], totalWeight: 6 }]),
      false
    );
  });

  it("true si algún operario tiene ambas zonas con N>=2", () => {
    assert.equal(
      violatesKitchenBathroomRule([
        { operatorIndex: 0, zones: ["kitchen", "bathroom"], totalWeight: 6 },
        { operatorIndex: 1, zones: ["living"], totalWeight: 2 },
      ]),
      true
    );
  });
});
