import { describe, it } from "node:test";
import assert from "node:assert";
import { suggestConsequenceAction, weeklyPatternSummary, type NearMissRecord } from "../../src/lib/near-miss-patterns";

describe("suggestConsequenceAction", () => {
  it("casi-caida -> flag de riesgo en la direccion", () => {
    assert.match(suggestConsequenceAction("near_fall"), /flag de riesgo/i);
  });
  it("casi-mezcla (no recurrente) -> revisar poka-yoke", () => {
    assert.match(suggestConsequenceAction("near_chemical_mix", false), /poka-yoke/i);
    assert.doesNotMatch(suggestConsequenceAction("near_chemical_mix", false), /re-entrenamiento/i);
  });
  it("casi-mezcla RECURRENTE en la misma propiedad -> escala a re-entrenamiento", () => {
    assert.match(suggestConsequenceAction("near_chemical_mix", true), /re-entrenamiento/i);
  });
  it("casi-mordida -> dueño presente", () => {
    assert.match(suggestConsequenceAction("near_bite"), /dueño/i);
  });
  it("casi-quemadura -> verificar timer", () => {
    assert.match(suggestConsequenceAction("near_burn"), /timer/i);
  });
});

const rec = (over: Partial<NearMissRecord>): NearMissRecord => ({
  id: "id",
  category: "near_fall",
  clientPropertyId: null,
  createdAt: "2026-07-08T12:00:00Z",
  ...over,
});

describe("weeklyPatternSummary", () => {
  it("agrupa por categoria y cuenta correctamente", () => {
    const records = [
      rec({ id: "1", category: "near_fall" }),
      rec({ id: "2", category: "near_fall" }),
      rec({ id: "3", category: "near_burn" }),
    ];
    const patterns = weeklyPatternSummary(records, "2026-07-06", "2026-07-13");
    const fall = patterns.find((p) => p.category === "near_fall")!;
    const burn = patterns.find((p) => p.category === "near_burn")!;
    assert.equal(fall.count, 2);
    assert.equal(burn.count, 1);
  });

  it("excluye registros fuera de la ventana de la semana", () => {
    const records = [
      rec({ id: "1", createdAt: "2026-06-01T00:00:00Z" }),
      rec({ id: "2", createdAt: "2026-07-08T00:00:00Z" }),
    ];
    const patterns = weeklyPatternSummary(records, "2026-07-06", "2026-07-13");
    assert.equal(patterns.length, 1);
  });

  it("ordena de mayor a menor frecuencia", () => {
    const records = [
      rec({ id: "1", category: "near_burn" }),
      rec({ id: "2", category: "near_fall" }),
      rec({ id: "3", category: "near_fall" }),
      rec({ id: "4", category: "near_fall" }),
    ];
    const patterns = weeklyPatternSummary(records, "2026-07-06", "2026-07-13");
    assert.equal(patterns[0].category, "near_fall");
  });

  it("mezcla quimica recurrente en la MISMA propiedad escala la sugerencia", () => {
    const records = [
      rec({ id: "1", category: "near_chemical_mix", clientPropertyId: "prop-1" }),
      rec({ id: "2", category: "near_chemical_mix", clientPropertyId: "prop-1" }),
    ];
    const patterns = weeklyPatternSummary(records, "2026-07-06", "2026-07-13");
    assert.match(patterns[0].suggestedAction, /re-entrenamiento/i);
  });

  it("mezcla quimica en propiedades DISTINTAS no escala (no es recurrente en la misma direccion)", () => {
    const records = [
      rec({ id: "1", category: "near_chemical_mix", clientPropertyId: "prop-1" }),
      rec({ id: "2", category: "near_chemical_mix", clientPropertyId: "prop-2" }),
    ];
    const patterns = weeklyPatternSummary(records, "2026-07-06", "2026-07-13");
    assert.doesNotMatch(patterns[0].suggestedAction, /re-entrenamiento/i);
  });
});
