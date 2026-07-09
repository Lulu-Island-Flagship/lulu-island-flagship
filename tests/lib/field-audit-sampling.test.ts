/**
 * v8.3 E5 — Tests de muestreo determinístico para Auditor de Campo.
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { isAuditSampleSelected, selectAuditSample } from "../../src/lib/field-audit-sampling";

describe("isAuditSampleSelected", () => {
  it("es determinístico: misma orden + misma fecha = mismo resultado siempre", () => {
    const a = isAuditSampleSelected("order-123", "2026-07-08");
    const b = isAuditSampleSelected("order-123", "2026-07-08");
    assert.equal(a, b);
  });

  it("cambia de muestra en otra fecha (no es siempre el mismo empleado auditado)", () => {
    const results = new Set<boolean>();
    for (let day = 1; day <= 30; day++) {
      results.add(isAuditSampleSelected("order-fixed", `2026-07-${String(day).padStart(2, "0")}`));
    }
    // con 30 fechas distintas, debe haber al menos un true y un false
    assert.ok(results.has(true) && results.has(false));
  });

  it("rate=0 nunca selecciona", () => {
    assert.equal(isAuditSampleSelected("order-1", "2026-07-08", 0), false);
  });

  it("rate=1 siempre selecciona", () => {
    assert.equal(isAuditSampleSelected("order-1", "2026-07-08", 1), true);
  });
});

describe("selectAuditSample — proporción sobre muestra grande", () => {
  it("con 5000 ordenes, el 20% seleccionado cae cerca de 20% (+-5 puntos)", () => {
    const ids = Array.from({ length: 5000 }, (_, i) => `order-${i}`);
    const selected = selectAuditSample(ids, "2026-07-08", 0.2);
    const pct = (selected.size / ids.length) * 100;
    assert.ok(pct > 15 && pct < 25, `esperaba ~20%, obtuve ${pct.toFixed(1)}%`);
  });
});
