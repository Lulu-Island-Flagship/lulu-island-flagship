import { describe, it } from "node:test";
import assert from "node:assert";
import { computeZonePlan } from "../../src/lib/zone-assignment";
import type { ZoneWeight } from "../../src/lib/zone-reparto";

const ZONES: ZoneWeight[] = [
  { zone: "kitchen", weight: 3.0 },
  { zone: "bathroom", weight: 3.0 },
  { zone: "living", weight: 2.0 },
  { zone: "bedroom", weight: 1.5 },
];

describe("computeZonePlan", () => {
  it("N=1: el único operario recibe todas las zonas, wasSplit=false", () => {
    const { plan, wasSplit } = computeZonePlan([{ employeeId: "e1" }], ZONES);
    assert.equal(wasSplit, false);
    assert.deepEqual(plan.get("e1")!.sort(), ["bathroom", "bedroom", "kitchen", "living"].sort());
  });

  it("N=0 operarios: plan vacío, sin crashear", () => {
    const { plan, wasSplit } = computeZonePlan([], ZONES);
    assert.equal(wasSplit, false);
    assert.equal(plan.size, 0);
  });

  it("sin zonas que repartir: cada operario recibe [], wasSplit=false", () => {
    const { plan, wasSplit } = computeZonePlan([{ employeeId: "e1" }, { employeeId: "e2" }], []);
    assert.equal(wasSplit, false);
    assert.deepEqual(plan.get("e1"), []);
    assert.deepEqual(plan.get("e2"), []);
  });

  it("N=2: reparte de verdad y nunca junta Cocina+Baño en el mismo empleado", () => {
    const { plan, wasSplit } = computeZonePlan(
      [{ employeeId: "lider" }, { employeeId: "ayudante" }],
      ZONES
    );
    assert.equal(wasSplit, true);
    const lider = plan.get("lider")!;
    const ayudante = plan.get("ayudante")!;
    const bothHaveKitchenAndBathroom =
      (lider.includes("kitchen") && lider.includes("bathroom")) ||
      (ayudante.includes("kitchen") && ayudante.includes("bathroom"));
    assert.equal(bothHaveKitchenAndBathroom, false);

    // Todas las zonas asignadas exactamente una vez entre los dos.
    const all = [...lider, ...ayudante].sort();
    assert.deepEqual(all, ["bathroom", "bedroom", "kitchen", "living"].sort());
  });

  it("orden estable: el primer operario de la lista siempre es operatorIndex 0", () => {
    const { plan: planA } = computeZonePlan(
      [{ employeeId: "a" }, { employeeId: "b" }],
      ZONES
    );
    const { plan: planB } = computeZonePlan(
      [{ employeeId: "a" }, { employeeId: "b" }],
      ZONES
    );
    assert.deepEqual(planA.get("a"), planB.get("a"));
    assert.deepEqual(planA.get("b"), planB.get("b"));
  });
});
