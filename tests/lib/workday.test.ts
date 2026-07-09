/**
 * v8.3 E3 — Tests de reglas de jornada (B.2.14/15, BC ESA).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluateWorkday, fitsInWorkday } from "../../src/lib/workday";

const block = (serviceMinutes: number, transitMinutes = 0) => ({ serviceMinutes, transitMinutes });

describe("evaluateWorkday", () => {
  it("jornada corta: sin pausas, ok", () => {
    const r = evaluateWorkday([block(180, 20)]); // 3h20
    assert.equal(r.status, "ok");
    assert.equal(r.requiredBreaks, 0);
  });

  it("a las 5h EXACTAS ya se debe una pausa de 30 min", () => {
    const r = evaluateWorkday([block(300)]); // 5h
    assert.equal(r.requiredBreaks, 1);
    assert.equal(r.totalDayMinutes, 330);
  });

  it("el tránsito CUENTA como jornada (turno estándar incluye tránsito)", () => {
    const r = evaluateWorkday([block(270, 30)]); // 4.5h + 0.5h tránsito = 5h
    assert.equal(r.requiredBreaks, 1);
  });

  it(">8h (con pausas) = requiere autorización admin (1.5x)", () => {
    const r = evaluateWorkday([block(240, 30), block(210, 30)]); // 8.5h trabajo + 1 pausa = 9h
    assert.equal(r.status, "overtime_needs_approval");
  });

  it(">10h = BLOQUEADO absoluto, sin excepción", () => {
    const r = evaluateWorkday([block(300, 30), block(300, 30)]); // 10.5h + 2 pausas = 11.5h
    assert.equal(r.status, "blocked");
  });

  it("exactamente 8h = ok sin alerta", () => {
    const r = evaluateWorkday([block(270), block(180)]); // 7.5h + 1 pausa = 8h
    assert.equal(r.status, "ok");
    assert.equal(r.totalDayMinutes, 480);
  });
});

describe("fitsInWorkday", () => {
  it("rechaza un bloque que rompería el tope de 10h", () => {
    const existing = [block(300, 30), block(150, 30)]; // 8.5h + pausa
    assert.equal(fitsInWorkday(existing, block(120, 20)), false);
  });

  it("acepta un bloque que cabe (aunque dispare overtime con aprobación)", () => {
    const existing = [block(240, 30)];
    assert.equal(fitsInWorkday(existing, block(240, 20)), true);
  });
});
