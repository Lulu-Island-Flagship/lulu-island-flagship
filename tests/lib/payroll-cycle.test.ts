/**
 * v8.3 E2/E9 — Tests del ciclo quincenal (invariante B.1).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  getCycleForDate,
  getPreviousCycle,
  aggregateCycle,
  cycleToCsv,
  type CycleEntry,
} from "../../src/lib/payroll-cycle";

describe("getCycleForDate — bordes", () => {
  it("día 15 pertenece a Q1", () => {
    assert.deepEqual(getCycleForDate("2026-07-15"), { start: "2026-07-01", end: "2026-07-15", label: "2026-07 Q1" });
  });
  it("día 16 pertenece a Q2 hasta fin de mes", () => {
    assert.deepEqual(getCycleForDate("2026-07-16"), { start: "2026-07-16", end: "2026-07-31", label: "2026-07 Q2" });
  });
  it("febrero no bisiesto termina el 28", () => {
    assert.equal(getCycleForDate("2027-02-20").end, "2027-02-28");
  });
  it("febrero bisiesto termina el 29", () => {
    assert.equal(getCycleForDate("2028-02-20").end, "2028-02-29");
  });
});

describe("getPreviousCycle", () => {
  it("desde Q2 el anterior es Q1 del mismo mes", () => {
    assert.equal(getPreviousCycle("2026-07-20").label, "2026-07 Q1");
  });
  it("desde Q1 el anterior es Q2 del mes anterior", () => {
    assert.equal(getPreviousCycle("2026-07-10").label, "2026-06 Q2");
  });
  it("desde enero Q1 el anterior es diciembre Q2 del año anterior", () => {
    assert.equal(getPreviousCycle("2026-01-05").label, "2025-12 Q2");
  });
});

const entry = (over: Partial<CycleEntry>): CycleEntry => ({
  employeeId: "e1",
  employeeName: "Ana",
  serviceDate: "2026-07-10",
  baseAmountCents: 20000,
  bonusCents: 0,
  penaltyCents: 0,
  reworkAmountCents: 0,
  minimumWageAdjustmentCents: 0,
  grossAmountCents: 20000,
  ...over,
});

describe("aggregateCycle + cycleToCsv", () => {
  const cycle = getCycleForDate("2026-07-10");

  it("suma por empleado y excluye fechas fuera del ciclo", () => {
    const out = aggregateCycle(
      [
        entry({}),
        entry({ bonusCents: 1500, grossAmountCents: 21500 }),
        entry({ serviceDate: "2026-07-20" }), // fuera de Q1
        entry({ employeeId: "e2", employeeName: "Beto" }),
      ],
      cycle
    );
    assert.equal(out.length, 2);
    const ana = out.find((s) => s.employeeId === "e1")!;
    assert.equal(ana.services, 2);
    assert.equal(ana.grossCents, 41500);
  });

  it("CSV con encabezado estable y montos en CAD con 2 decimales", () => {
    const csv = cycleToCsv(aggregateCycle([entry({})], cycle), cycle);
    const [header, row] = csv.split("\n");
    assert.match(header, /^cycle,employee_id,employee_name,services,base_cad/);
    assert.match(row, /2026-07 Q1,e1,"Ana",1,200\.00/);
  });

  // v8.3 E9: un crédito de payroll_readiness_credits (readiness_requests
  // full_day_rate) se construye como un CycleEntry más — sin order/servicio
  // real, base=gross=day_rate, todo lo demás en 0 — y aggregateCycle lo suma
  // igual que cualquier otra entrada del ciclo, sin lógica especial.
  it("un crédito de Day Rate por 'no estoy listo' se suma como un día trabajado más", () => {
    const readinessCredit = entry({
      employeeId: "e1",
      bonusCents: 0,
      penaltyCents: 0,
      reworkAmountCents: 0,
      minimumWageAdjustmentCents: 0,
      baseAmountCents: 20000,
      grossAmountCents: 20000,
      serviceDate: "2026-07-12",
    });
    const out = aggregateCycle([entry({}), readinessCredit], cycle);
    assert.equal(out.length, 1);
    assert.equal(out[0].services, 2);
    assert.equal(out[0].grossCents, 40000);
  });

  // v8.3 fix auditoría E9: EmployeeCycleSummary ahora expone días
  // trabajados / Day Rate / minutos de rework pagados (antes faltaban en
  // el export de nómina).
  it("daysWorked cuenta días DISTINTOS, no servicios (varios servicios el mismo día = 1 día trabajado)", () => {
    const out = aggregateCycle(
      [entry({}), entry({ serviceDate: "2026-07-10" }), entry({ serviceDate: "2026-07-11" })],
      cycle
    );
    assert.equal(out[0].services, 3);
    assert.equal(out[0].daysWorked, 2);
  });

  it("dayRateCents suma el mismo total que baseCents (Day Rate pagado)", () => {
    const out = aggregateCycle([entry({}), entry({ baseAmountCents: 25000 })], cycle);
    assert.equal(out[0].dayRateCents, out[0].baseCents);
    assert.equal(out[0].dayRateCents, 45000);
  });

  it("reworkPaidMinutesTotal suma los minutos de rework pagados del ciclo", () => {
    const out = aggregateCycle(
      [entry({ reworkPaidMinutes: 15 }), entry({ reworkPaidMinutes: 30 }), entry({})],
      cycle
    );
    assert.equal(out[0].reworkPaidMinutesTotal, 45);
  });

  it("CSV incluye days_worked/day_rate_cad/rework_paid_minutes al final", () => {
    const csv = cycleToCsv(aggregateCycle([entry({ reworkPaidMinutes: 10 })], cycle), cycle);
    const [header, row] = csv.split("\n");
    assert.match(header, /days_worked,day_rate_cad,rework_paid_minutes$/);
    assert.match(row, /,1,200\.00,10$/);
  });
});
