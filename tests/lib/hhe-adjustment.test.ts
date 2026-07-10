import { describe, it } from "node:test";
import assert from "node:assert";
import {
  detectHheAdjustmentSuggestions,
  detectTeamSpeedSuggestions,
  type HheObservation,
  type TeamSpeedObservation,
} from "../../src/lib/hhe-adjustment";

function makeDailyObservations(
  serviceType: string,
  sqftBand: string,
  baseline: number,
  actual: number,
  days: number,
  endDate: string
): HheObservation[] {
  const end = new Date(`${endDate}T00:00:00Z`);
  const obs: HheObservation[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(end.getTime() - i * 86_400_000);
    obs.push({
      serviceType,
      sqftBand,
      date: d.toISOString().slice(0, 10),
      baselineHhe: baseline,
      actualHhe: actual,
    });
  }
  return obs;
}

describe("detectHheAdjustmentSuggestions", () => {
  it("sugiere ajuste cuando la desviacion >15% es sostenida 30+ dias y consistente", () => {
    // Deep 700-1500: baseline 4.0, actual consistentemente 4.5 (=+12.5%)... probemos con 5.0 (+25%) para superar umbral claro
    const obs = makeDailyObservations("Deep", "700-1500", 4.0, 5.0, 32, "2026-07-09");
    const suggestions = detectHheAdjustmentSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 1);
    const s = suggestions[0];
    assert.equal(s.serviceType, "Deep");
    assert.equal(s.sqftBand, "700-1500");
    assert.equal(s.currentHhe, 4.0);
    assert.equal(s.suggestedHhe, 5.0);
    assert.equal(s.requiresManualApproval, true);
    assert.match(s.message, /¿Ajustar HHE de Deep 700-1500 de 4 a 5\? Impacto \+25%\. \[Aplicar\]/);
  });

  it("NO sugiere si la ventana es menor a 30 dias, aunque la desviacion sea grande", () => {
    const obs = makeDailyObservations("Deep", "700-1500", 4.0, 6.0, 10, "2026-07-09");
    const suggestions = detectHheAdjustmentSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 0);
  });

  it("NO sugiere si la desviacion esta bajo el umbral de 15%", () => {
    // 4.0 -> 4.3 = +7.5%, bajo el umbral
    const obs = makeDailyObservations("Regular", "≤700", 4.0, 4.3, 35, "2026-07-09");
    const suggestions = detectHheAdjustmentSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 0);
  });

  it("NO sugiere si la desviacion no es consistente (outlier unico entre muchas observaciones normales)", () => {
    const normal = makeDailyObservations("Move-in/out", "1500-2500", 8.0, 8.0, 34, "2026-07-08");
    const outlier: HheObservation = {
      serviceType: "Move-in/out",
      sqftBand: "1500-2500",
      date: "2026-07-09",
      baselineHhe: 8.0,
      actualHhe: 20.0, // pico atipico de un solo dia
    };
    const suggestions = detectHheAdjustmentSuggestions([...normal, outlier], "2026-07-09");
    assert.equal(suggestions.length, 0);
  });

  it("agrupa por separado servicios distintos y no mezcla bandas ft2", () => {
    const deepSmall = makeDailyObservations("Deep", "≤700", 2.5, 3.2, 32, "2026-07-09");
    const deepBig = makeDailyObservations("Deep", "2500-3500", 9.0, 9.0, 32, "2026-07-09");
    const suggestions = detectHheAdjustmentSuggestions([...deepSmall, ...deepBig], "2026-07-09");
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].sqftBand, "≤700");
  });

  it("nunca incluye un campo de aplicacion automatica -- requiresManualApproval siempre true", () => {
    const obs = makeDailyObservations("Post-construcción", ">3500", 18.0, 22.0, 31, "2026-07-09");
    const suggestions = detectHheAdjustmentSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 1);
    assert.strictEqual(suggestions[0].requiresManualApproval, true);
  });
});

describe("detectTeamSpeedSuggestions", () => {
  function makeTeamObs(teamLabel: string, estimated: number, actual: number, days: number, endDate: string): TeamSpeedObservation[] {
    const end = new Date(`${endDate}T00:00:00Z`);
    const obs: TeamSpeedObservation[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(end.getTime() - i * 86_400_000);
      obs.push({ teamLabel, date: d.toISOString().slice(0, 10), estimatedHours: estimated, actualHours: actual });
    }
    return obs;
  }

  it("sugiere revisar cuando un equipo es consistentemente 20%+ mas rapido durante 30+ dias", () => {
    const obs = makeTeamObs("Equipo Ámbar", 4.0, 3.0, 32, "2026-07-09"); // -25%
    const suggestions = detectTeamSpeedSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].teamLabel, "Equipo Ámbar");
    assert.equal(suggestions[0].averageSpeedupPercent, 25);
    assert.strictEqual(suggestions[0].requiresManualApproval, true);
  });

  it("NO sugiere si la rapidez esta bajo el 20%", () => {
    const obs = makeTeamObs("Equipo Coral", 4.0, 3.6, 32, "2026-07-09"); // -10%
    const suggestions = detectTeamSpeedSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 0);
  });

  it("NO confunde un equipo mas LENTO con uno mas rapido", () => {
    const obs = makeTeamObs("Equipo Zafiro", 4.0, 5.0, 32, "2026-07-09"); // +25% (mas lento)
    const suggestions = detectTeamSpeedSuggestions(obs, "2026-07-09");
    assert.equal(suggestions.length, 0);
  });
});
