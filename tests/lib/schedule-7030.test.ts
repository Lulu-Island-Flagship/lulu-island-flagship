/**
 * v8.3 E3 — Tests del modelo 70/30 (Horario Base / Ventana de Contingencia).
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import {
  classifySchedule,
  evaluateScheduleChange,
  calculateContingencyGuaranteedPay,
  evaluateOvertimeRejection,
  contingencyCutoff,
  type ScheduleBlock,
} from "../../src/lib/schedule-7030";

describe("classifySchedule", () => {
  it("clasifica bloques con >=5 dias de antelacion como base", () => {
    const blocks: ScheduleBlock[] = [
      { id: "1", dayOfWeek: 1, durationMinutes: 480, advanceNoticeDays: 7 },
      { id: "2", dayOfWeek: 2, durationMinutes: 120, advanceNoticeDays: 2 },
    ];
    const result = classifySchedule(blocks);
    assert.equal(result.totalMinutes, 600);
    assert.equal(result.baseMinutes, 480);
    assert.equal(result.contingencyMinutes, 120);
    assert.equal(result.blocks[0].kind, "base");
    assert.equal(result.blocks[1].kind, "contingency");
  });

  it("bloque fijado exactamente a 5 dias cuenta como base (borde inclusivo)", () => {
    const blocks: ScheduleBlock[] = [
      { id: "1", dayOfWeek: 1, durationMinutes: 100, advanceNoticeDays: 5 },
    ];
    const result = classifySchedule(blocks);
    assert.equal(result.blocks[0].kind, "base");
  });

  it("reparto exacto 70/30 esta dentro de tolerancia", () => {
    const blocks: ScheduleBlock[] = [
      { id: "1", dayOfWeek: 1, durationMinutes: 700, advanceNoticeDays: 7 },
      { id: "2", dayOfWeek: 2, durationMinutes: 300, advanceNoticeDays: 1 },
    ];
    const result = classifySchedule(blocks);
    assert.equal(result.expectedBaseMinutes, 700);
    assert.equal(result.withinTolerance, true);
    assert.equal(result.deviationReasons.length, 0);
  });

  it("desviacion grande del 70/30 se marca fuera de tolerancia", () => {
    const blocks: ScheduleBlock[] = [
      { id: "1", dayOfWeek: 1, durationMinutes: 200, advanceNoticeDays: 7 }, // solo 20% base
      { id: "2", dayOfWeek: 2, durationMinutes: 800, advanceNoticeDays: 1 },
    ];
    const result = classifySchedule(blocks);
    assert.equal(result.withinTolerance, false);
    assert.equal(result.deviationReasons.length, 1);
  });

  it("horario vacio no revienta (totalMinutes 0)", () => {
    const result = classifySchedule([]);
    assert.equal(result.totalMinutes, 0);
    assert.equal(result.withinTolerance, true);
  });
});

describe("contingencyCutoff", () => {
  it("corte es 5:30 PM del dia ANTERIOR al servicio", () => {
    const cutoff = contingencyCutoff("2026-07-10");
    assert.equal(cutoff.getDate(), 9);
    assert.equal(cutoff.getMonth(), 6); // julio = 6 (0-indexed)
    assert.equal(cutoff.getHours(), 17);
    assert.equal(cutoff.getMinutes(), 30);
  });
});

describe("evaluateScheduleChange", () => {
  it("permite cambio antes del corte de 5:30 PM del dia anterior", () => {
    const decision = evaluateScheduleChange({
      serviceDateISO: "2026-07-10",
      requestedAt: new Date(2026, 6, 9, 15, 0), // 3PM dia anterior
      isValidatedEmergency: false,
    });
    assert.equal(decision.allowed, true);
    assert.equal(decision.isPastCutoff, false);
  });

  it("rechaza cambio despues del corte sin emergencia validada", () => {
    const decision = evaluateScheduleChange({
      serviceDateISO: "2026-07-10",
      requestedAt: new Date(2026, 6, 9, 18, 0), // 6PM dia anterior, ya paso el corte
      isValidatedEmergency: false,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.isPastCutoff, true);
  });

  it("permite cambio despues del corte SI es emergencia validada", () => {
    const decision = evaluateScheduleChange({
      serviceDateISO: "2026-07-10",
      requestedAt: new Date(2026, 6, 9, 20, 0),
      isValidatedEmergency: true,
    });
    assert.equal(decision.allowed, true);
    assert.match(decision.reason, /emergencia validada/);
  });

  it("exactamente a las 5:30 PM (limite) aun se considera dentro de la ventana", () => {
    const decision = evaluateScheduleChange({
      serviceDateISO: "2026-07-10",
      requestedAt: new Date(2026, 6, 9, 17, 30),
      isValidatedEmergency: false,
    });
    assert.equal(decision.isPastCutoff, false);
    assert.equal(decision.allowed, true);
  });
});

describe("calculateContingencyGuaranteedPay", () => {
  it("paga la ventana de contingencia completa aunque no se use (en centavos)", () => {
    // 120 min a $20/hr (2000 centavos/hr) = 2h * 2000 = 4000 centavos
    const pay = calculateContingencyGuaranteedPay(120, 2000);
    assert.equal(pay, 4000);
  });

  it("minutos negativos no producen pago negativo", () => {
    const pay = calculateContingencyGuaranteedPay(-50, 2000);
    assert.equal(pay, 0);
  });
});

describe("evaluateOvertimeRejection", () => {
  it("jornada ok: no aplica derecho a rechazo", () => {
    const d = evaluateOvertimeRejection("ok");
    assert.equal(d.canRejectWithoutPenalty, false);
    assert.equal(d.requiresReassignment, false);
  });

  it("overtime_needs_approval: derecho a rechazar sin penalizacion, reasignar", () => {
    const d = evaluateOvertimeRejection("overtime_needs_approval");
    assert.equal(d.canRejectWithoutPenalty, true);
    assert.equal(d.requiresReassignment, true);
  });

  it("blocked: reasignacion obligatoria sin penalizacion", () => {
    const d = evaluateOvertimeRejection("blocked");
    assert.equal(d.canRejectWithoutPenalty, true);
    assert.equal(d.requiresReassignment, true);
  });
});
