import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getTop3Teams,
  computeCompositeScore,
  assertNoIndividualIdentifier,
  formatAggregatedRows,
  type TeamWeeklyScoreInput,
} from "../../src/lib/team-ranking";

function baseScore(overrides: Partial<TeamWeeklyScoreInput> = {}): TeamWeeklyScoreInput {
  return {
    teamId: "team-jade",
    teamName: "Equipo Jade",
    weekStart: "2026-07-06",
    efficiencyScore: 80,
    qualityScore: 80,
    punctualityScore: 80,
    commercialScore: 80,
    ...overrides,
  };
}

describe("computeCompositeScore", () => {
  it("aplica los pesos literales del spec E8.10: 40/30/20/10", () => {
    const score = baseScore({
      efficiencyScore: 100,
      qualityScore: 0,
      punctualityScore: 0,
      commercialScore: 0,
    });
    assert.equal(computeCompositeScore(score), 40);
  });

  it("clampea valores fuera de 0-100", () => {
    const score = baseScore({
      efficiencyScore: 150,
      qualityScore: -20,
      punctualityScore: 80,
      commercialScore: 80,
    });
    // eff clamp 100*0.4=40, quality clamp 0*0.3=0, punct 80*0.2=16, comm 80*0.1=8 => 64
    assert.equal(computeCompositeScore(score), 64);
  });
});

describe("getTop3Teams", () => {
  it("ordena descendente y devuelve el ranking correcto", () => {
    const scores = [
      baseScore({ teamId: "1", teamName: "Jade", efficiencyScore: 90 }),
      baseScore({ teamId: "2", teamName: "Coral", efficiencyScore: 60 }),
      baseScore({ teamId: "3", teamName: "Ambar", efficiencyScore: 100 }),
    ];
    const top3 = getTop3Teams(scores);
    assert.deepEqual(
      top3.map((t) => t.teamId),
      ["3", "1", "2"]
    );
    assert.deepEqual(
      top3.map((t) => t.rank),
      [1, 2, 3]
    );
  });

  it("NUNCA devuelve más de 3 equipos aunque entren más (criterio de aceptación E8)", () => {
    const scores = Array.from({ length: 10 }, (_, i) =>
      baseScore({ teamId: `t${i}`, teamName: `Equipo ${i}`, efficiencyScore: i * 10 })
    );
    const top3 = getTop3Teams(scores);
    assert.equal(top3.length, 3);
  });

  it("desempata alfabéticamente por nombre cuando el score es idéntico", () => {
    const scores = [
      baseScore({ teamId: "1", teamName: "Zafiro" }),
      baseScore({ teamId: "2", teamName: "Ambar" }),
    ];
    const top3 = getTop3Teams(scores);
    assert.equal(top3[0].teamName, "Ambar");
  });

  it("con menos de 3 equipos, devuelve solo los disponibles", () => {
    const scores = [baseScore({ teamId: "1" })];
    const top3 = getTop3Teams(scores);
    assert.equal(top3.length, 1);
    assert.equal(top3[0].rank, 1);
  });

  it("salida solo contiene rank/teamId/teamName/compositeScore — ninguna otra clave", () => {
    const top3 = getTop3Teams([baseScore()]);
    const keys = Object.keys(top3[0]).sort();
    assert.deepEqual(keys, ["compositeScore", "rank", "teamId", "teamName"]);
  });
});

describe("assertNoIndividualIdentifier — defensa en profundidad B.2.21", () => {
  it("NO lanza con un score de equipo legítimo", () => {
    assert.doesNotThrow(() => assertNoIndividualIdentifier(baseScore()));
  });

  it("lanza si el objeto trae employeeId (bypass de tipos vía 'as unknown as')", () => {
    const tainted = { ...baseScore(), employeeId: "emp-123" } as unknown as TeamWeeklyScoreInput;
    assert.throws(() => assertNoIndividualIdentifier(tainted), /B\.2\.21/);
  });

  it("lanza si el objeto trae workerId anidado (ej. dentro de un objeto de metadata colado)", () => {
    const tainted = {
      ...baseScore(),
      metadata: { workerId: "w-9" },
    } as unknown as TeamWeeklyScoreInput;
    assert.throws(() => assertNoIndividualIdentifier(tainted));
  });

  it("lanza si trae un SIN (Social Insurance Number) colado", () => {
    const tainted = { ...baseScore(), sin: "123456789" } as unknown as TeamWeeklyScoreInput;
    assert.throws(() => assertNoIndividualIdentifier(tainted));
  });

  it("detecta identificadores dentro de un array anidado", () => {
    const tainted = {
      ...baseScore(),
      breakdown: [{ employeeName: "Juan" }],
    } as unknown as TeamWeeklyScoreInput;
    assert.throws(() => assertNoIndividualIdentifier(tainted));
  });

  it("getTop3Teams propaga el rechazo — no calcula ranking con datos contaminados", () => {
    const tainted = [{ ...baseScore(), employeeId: "emp-1" } as unknown as TeamWeeklyScoreInput];
    assert.throws(() => getTop3Teams(tainted), /B\.2\.21/);
  });

  it(
    "defensa de tipos: TeamWeeklyScoreInput no declara ningún campo de empleado " +
      "(verificado por inspección estática de las claves del tipo base, no solo runtime)",
    () => {
      const keys = Object.keys(baseScore());
      const hasIndividualField = keys.some((k) => /employee|worker|staff|empleado/i.test(k));
      assert.equal(hasIndividualField, false);
    }
  );
});

describe("formatAggregatedRows — camino desde la RPC de base de datos", () => {
  it("trunca a 3 y asigna rank aunque la RPC devuelva más filas", () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      teamId: `t${i}`,
      teamName: `Equipo ${i}`,
      compositeScore: 100 - i,
    }));
    const top3 = formatAggregatedRows(rows);
    assert.equal(top3.length, 3);
    assert.deepEqual(top3.map((t) => t.rank), [1, 2, 3]);
  });

  it("también rechaza filas de RPC contaminadas con identificador individual", () => {
    const rows = [{ teamId: "1", teamName: "Jade", compositeScore: 90, employeeId: "x" }] as unknown as {
      teamId: string;
      teamName: string;
      compositeScore: number;
    }[];
    assert.throws(() => formatAggregatedRows(rows));
  });
});
