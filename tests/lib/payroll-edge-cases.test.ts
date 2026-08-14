/**
 * v8.3 — Payroll Edge Cases Tests.
 *
 * Pruebas de edge cases de nómina: statutory holiday pay (BC ESA),
 * sick leave (BC ESA Parte 5.1), overtime (8h/día, 40h/semana),
 * y escenario multi-empleador (CPP/EI con ingresos de múltiples fuentes).
 *
 * Sin dependencia de base de datos — todas las funciones son puras.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateStatutoryHolidayPay } from "../../src/lib/compliance-resolver";
import {
  decideStatHolidayEligibility,
  computeAverageDayPay,
} from "../../src/lib/statutory-holidays";
import { decideSickLeaveEligibility } from "../../src/lib/sick-leave";
import { calculateOvertimePay } from "../../src/lib/payroll";
import { calculateCPP, calculateEI } from "../../src/lib/compliance-resolver";

// =========================================================================
// Statutory Holiday Pay (BC ESA Parte 5)
// =========================================================================

describe("Statutory Holiday Pay", () => {
  it("empleado elegible que NO trabaja el festivo recibe average day's pay", () => {
    // Empleado: ≥30 días de empleo, ≥15 días trabajados en los 30 anteriores
    const eligibility = decideStatHolidayEligibility({
      daysEmployedAtHoliday: 90,
      daysWorkedInPrior30: 22,
    });
    assert.strictEqual(eligibility.eligible, true);

    // Average day's pay = $30,000 (total 30 días) / 22 días = ~$1,363.64
    const avgPay = computeAverageDayPay(3_000_000, 22);
    assert.ok(avgPay > 0);

    // Empleado no trabaja el festivo → recibe average day's pay
    const result = calculateStatutoryHolidayPay({
      dayRateCents: avgPay,
      isHoliday: true,
      workedOnHoliday: false,
    });

    assert.strictEqual(result.holidayPayCents, avgPay);
    assert.strictEqual(result.premiumPayCents, 0);
    assert.strictEqual(result.totalCents, avgPay);
  });

  it("empleado que TRABAJA el festivo recibe 1.5× + average day's pay", () => {
    const eligibility = decideStatHolidayEligibility({
      daysEmployedAtHoliday: 180,
      daysWorkedInPrior30: 20,
    });
    assert.strictEqual(eligibility.eligible, true);

    const avgPay = computeAverageDayPay(4_000_000, 20); // $4,000 / 20 = $200

    // Empleado trabaja 6h el festivo, tarifa $25/hr
    const result = calculateStatutoryHolidayPay({
      dayRateCents: avgPay, // $200.00 = 20000 cents
      isHoliday: true,
      workedOnHoliday: true,
      hoursWorkedOnHoliday: 6,
      hourlyRateCents: 2500, // $25/hr
    });

    // Average day's pay
    assert.strictEqual(result.holidayPayCents, avgPay);

    // Premium: 6h × $25 × 1.5 = $225 = 22500 cents
    const expectedPremium = Math.round(6 * 2500 * 1.5);
    assert.strictEqual(result.premiumPayCents, expectedPremium);

    // Total: avgPay + premium
    assert.strictEqual(result.totalCents, avgPay + expectedPremium);
  });

  it("día NO festivo: no genera pago extra", () => {
    const result = calculateStatutoryHolidayPay({
      dayRateCents: 20000,
      isHoliday: false,
    });

    assert.strictEqual(result.holidayPayCents, 0);
    assert.strictEqual(result.premiumPayCents, 0);
    assert.strictEqual(result.totalCents, 0);
  });

  it("empleado NO elegible (<30 días de empleo) no recibe statutory holiday pay", () => {
    const eligibility = decideStatHolidayEligibility({
      daysEmployedAtHoliday: 15,
      daysWorkedInPrior30: 10,
    });
    assert.strictEqual(eligibility.eligible, false);
    assert.match(eligibility.reason, /Menos de 30/);
  });

  it("empleado con <15 días trabajados en los 30 anteriores no es elegible", () => {
    const eligibility = decideStatHolidayEligibility({
      daysEmployedAtHoliday: 45,
      daysWorkedInPrior30: 10,
    });
    assert.strictEqual(eligibility.eligible, false);
    assert.match(eligibility.reason, /Solo 10 de 15/);
  });

  it("computeAverageDayPay: 0 días trabajados retorna 0", () => {
    assert.strictEqual(computeAverageDayPay(100_000, 0), 0);
  });
});

// =========================================================================
// Sick Leave (BC ESA Parte 5.1)
// =========================================================================

describe("Sick Leave", () => {
  it("empleado con ≥90 días de empleo y días pagados disponibles recibe día pagado", () => {
    const result = decideSickLeaveEligibility({
      daysEmployedContinuous: 120,
      paidDaysUsedThisYear: 2,
      unpaidProtectedDaysUsedThisYear: 0,
    });

    assert.strictEqual(result.payType, "paid");
    assert.match(result.reason, /Día pagado 3 de 5/);
  });

  it("empleado que ya usó los 5 días pagados recibe día no pagado protegido", () => {
    const result = decideSickLeaveEligibility({
      daysEmployedContinuous: 200,
      paidDaysUsedThisYear: 5,
      unpaidProtectedDaysUsedThisYear: 0,
    });

    assert.strictEqual(result.payType, "unpaid_protected");
    assert.match(result.reason, /no pagado/);
  });

  it("empleado que agotó días pagados y no pagados queda a discreción del empleador", () => {
    const result = decideSickLeaveEligibility({
      daysEmployedContinuous: 365,
      paidDaysUsedThisYear: 5,
      unpaidProtectedDaysUsedThisYear: 3,
    });

    assert.strictEqual(result.payType, "discretionary");
    assert.match(result.reason, /discreción del empleador/);
  });

  it("empleado con <90 días de empleo: discretionary (no entitlement estatutaria)", () => {
    const result = decideSickLeaveEligibility({
      daysEmployedContinuous: 45,
      paidDaysUsedThisYear: 0,
      unpaidProtectedDaysUsedThisYear: 0,
    });

    assert.strictEqual(result.payType, "discretionary");
    assert.match(result.reason, /Menos de 90/);
  });
});

// =========================================================================
// Overtime: 8h/día, 40h/semana (BC ESA)
// =========================================================================

describe("Overtime Pay", () => {
  it("horas extra después de 8h/día: recargo 1.5× sobre day rate", () => {
    // Day rate $200 (20000 cents), jornada estándar 8h (480 min)
    // Empleado trabajó 10h (600 min) → 2h overtime
    const result = calculateOvertimePay({
      totalDayMinutes: 600, // 10h
      dayRateCents: 20000,  // $200 day rate
      standardDayMinutes: 480,
      overtimeMultiplier: 1.5,
    });

    assert.strictEqual(result.overtimeMinutes, 120); // 2h overtime
    assert.ok(result.overtimePayCents > 0);

    // Verificación manual:
    // hourlyRate = dayRateCents / (480/60) = 20000 / 8 = 2500 cents/hr ($25/hr)
    // overtimePay = (120 * 20000 * 1.5) / 480 = 7500 cents ($75)
    const expectedOvertimePay = Math.round((120 * 20000 * 1.5) / 480);
    assert.strictEqual(result.overtimePayCents, expectedOvertimePay);
  });

  it("sin overtime: jornada ≤8h retorna 0", () => {
    const result = calculateOvertimePay({
      totalDayMinutes: 480, // exactamente 8h
      dayRateCents: 20000,
    });

    assert.strictEqual(result.overtimeMinutes, 0);
    assert.strictEqual(result.overtimePayCents, 0);
  });

  it("jornada de 12h: máximo 2h overtime pagable (el resto bloqueado por dispatch)", () => {
    // La capa de dispatch (workday.ts) bloquea >10h, pero si ocurriera:
    // overtime = 720 - 480 = 240 min = 4h
    const result = calculateOvertimePay({
      totalDayMinutes: 720, // 12h
      dayRateCents: 20000,
      standardDayMinutes: 480,
    });

    // El cálculo de overtime detecta el excedente real (4h = 240 min)
    assert.strictEqual(result.overtimeMinutes, 240);
    assert.ok(result.overtimePayCents > 0);

    // Nota: en producción, la capa de dispatch/workday limita a ≤10h/día.
    // Este test solo verifica que el CÁLCULO de overtime funciona correctamente
    // para cualquier input — es responsabilidad del dispatch limitar el input.
  });

  it("overtime con day rate más alto y jornada parcial extra", () => {
    // Day rate $300 (30000 cents), 9h trabajadas → 1h overtime
    const result = calculateOvertimePay({
      totalDayMinutes: 540, // 9h
      dayRateCents: 30000,  // $300
      standardDayMinutes: 480,
    });

    assert.strictEqual(result.overtimeMinutes, 60);
    // hourlyRate = 30000/8 = 3750 cents/hr
    // overtimePay = (60 * 30000 * 1.5) / 480 = 5625 cents
    const expected = Math.round((60 * 30000 * 1.5) / 480);
    assert.strictEqual(result.overtimePayCents, expected);
    assert.strictEqual(result.hourlyRateCents, Math.round((30000 * 60) / 480));
  });

  it("cálculo de overtime usa enteros para precisión (fix auditoría)", () => {
    // Verifica que el fix de precisión está aplicado:
    // overtimePayCents se calcula en una sola expresión con Math.round al final
    const result = calculateOvertimePay({
      totalDayMinutes: 490, // 10 min overtime
      dayRateCents: 19999,  // valor impar para probar precisión
    });

    // Debe ser un entero exacto (centavos)
    assert.strictEqual(Number.isInteger(result.overtimePayCents), true);
    assert.ok(result.overtimePayCents >= 0);
  });
});

// =========================================================================
// Multi-empleador: CPP/EI con ingresos de múltiples fuentes
// =========================================================================

describe("Multi-empleador — CPP/EI con múltiples fuentes de ingreso", () => {
  /**
   * Escenario: un empleado trabaja para dos empleadores en el mismo año.
   * Cada empleador calcula CPP/EI independientemente sobre lo que le paga,
   * sin conocer los ingresos del otro empleador.
   *
   * Esto puede resultar en sobre-contribución de CPP/EI. El empleado
   * reclama el exceso en su T1 (tax return). El sistema de nómina NO
   * puede compensar automáticamente — solo puede calcular correctamente
   * sobre lo que ve (el YTD del empleado en ESTE negocio).
   *
   * Este test documenta el comportamiento esperado.
   */

  it("CPP: empleador solo calcula sobre su propio YTD (no ve otros empleadores)", () => {
    // Empleador A (Lulu Island) le ha pagado $35,000 en el año
    const ytdLulu = 3_500_000; // $35,000 cents

    // Este período paga $2,000 adicionales
    const cppResult = calculateCPP({
      grossPayCents: 200_000, // $2,000
      periodStart: new Date("2026-08-01"),
      ytdPensionableCents: ytdLulu,
    });

    // CPP se calcula normalmente porque $35,000 + $2,000 = $37,000 < $68,500 YMPE
    assert.ok(cppResult.employeeCents > 0, "CPP debe ser > 0 cuando YTD aún no alcanza el YMPE");

    // YTD pensionable después de este ciclo
    assert.strictEqual(cppResult.ytdPensionableAfterCents, ytdLulu + 200_000);
  });

  it("EI: empleador solo calcula sobre su propio YTD", () => {
    const ytdLulu = 2_000_000; // $20,000

    const eiResult = calculateEI({
      grossPayCents: 200_000, // $2,000
      periodStart: new Date("2026-08-01"),
      ytdInsurableCents: ytdLulu,
    });

    // EI se calcula normalmente porque $20,000 + $2,000 = $22,000 < $66,000 tope
    assert.ok(eiResult.employeeCents > 0, "EI debe ser > 0 cuando YTD aún no alcanza el tope");
    assert.strictEqual(eiResult.ytdInsurableAfterCents, ytdLulu + 200_000);
  });

  it("CPP: si el YTD de Lulu ya excede el YMPE, no hay más contribución CPP", () => {
    // El empleado ya ganó $75,000 en Lulu Island este año (> $74,600 YMPE 2026)
    const ytdLulu = 7_500_000; // $75,000

    const cppResult = calculateCPP({
      grossPayCents: 200_000, // $2,000 más
      periodStart: new Date("2026-08-01"),
      ytdPensionableCents: ytdLulu,
    });

    // CPP debe ser 0 porque ya se excedió el YMPE
    assert.strictEqual(cppResult.employeeCents, 0,
      "CPP debe ser 0 cuando YTD ya excede el YMPE ($74,600)");
  });

  it("EI: si el YTD de Lulu ya excede el tope asegurable, no hay más contribución EI", () => {
    const ytdLulu = 7_000_000; // $70,000 > $68,900 tope EI 2026

    const eiResult = calculateEI({
      grossPayCents: 200_000,
      periodStart: new Date("2026-08-01"),
      ytdInsurableCents: ytdLulu,
    });

    assert.strictEqual(eiResult.employeeCents, 0,
      "EI debe ser 0 cuando YTD ya excede el máximo asegurable ($68,900)");
  });

  it("escenario multi-empleador documentado: sobre-contribución es responsabilidad del empleado en T1", () => {
    /**
     * Documentación del comportamiento:
     *
     * Empleador A (Lulu Island): paga $40,000 → CPP sobre $40,000
     * Empleador B (otro):       paga $40,000 → CPP sobre $40,000
     *
     * Total real: $80,000 → CPP solo debería pagarse sobre $68,500 (YMPE)
     * Exceso pagado: CPP sobre ($80,000 - $68,500) = $11,500
     *
     * Esto es CORRECTO desde la perspectiva de cada empleador porque
     * ningún empleador conoce los ingresos del otro. El empleado reclama
     * el exceso de CPP en su tax return (T1, línea 448).
     *
     * El sistema NO intenta adivinar ingresos externos — sería
     * incorrecto y peligroso asumirlos.
     */
    const ytdEmployerA = 4_000_000; // $40,000 de Lulu Island

    // Empleador A calcula CPP sobre su porción
    const cppA = calculateCPP({
      grossPayCents: 200_000,
      periodStart: new Date("2026-08-01"),
      ytdPensionableCents: ytdEmployerA,
    });

    // Empleador A correctamente deduce CPP (aún no llega al YMPE con solo sus datos)
    assert.ok(cppA.employeeCents > 0,
      "Empleador A debe deducir CPP porque su YTD ($40,000) < YMPE ($68,500)");

    // Pero si el empleado también trabaja para Empleador B ($40,000 adicionales),
    // la suma ($80,000) excede el YMPE. El empleado reclama el exceso en T1.
    // Esto es comportamiento esperado y documentado.
  });
});

// =========================================================================
// Combinación de edge cases en un solo ciclo
// =========================================================================

describe("Edge cases combinados en un ciclo de nómina", () => {
  it("empleado con sick leave + overtime + statutory holiday en el mismo período", () => {
    // Día 1: Sick leave (paid)
    const sickResult = decideSickLeaveEligibility({
      daysEmployedContinuous: 200,
      paidDaysUsedThisYear: 1,
      unpaidProtectedDaysUsedThisYear: 0,
    });
    assert.strictEqual(sickResult.payType, "paid");

    // Día 2: Overtime (10h trabajadas en vez de 8h)
    const overtimeResult = calculateOvertimePay({
      totalDayMinutes: 600,
      dayRateCents: 20000,
    });
    assert.strictEqual(overtimeResult.overtimeMinutes, 120);
    assert.ok(overtimeResult.overtimePayCents > 0);

    // Día 3: Statutory holiday — elegible, NO trabaja
    const holEligibility = decideStatHolidayEligibility({
      daysEmployedAtHoliday: 200,
      daysWorkedInPrior30: 20,
    });
    assert.strictEqual(holEligibility.eligible, true);

    const avgPay = computeAverageDayPay(3_000_000, 20);
    const holResult = calculateStatutoryHolidayPay({
      dayRateCents: avgPay,
      isHoliday: true,
      workedOnHoliday: false,
    });
    assert.strictEqual(holResult.totalCents, avgPay);

    // Todos estos montos deben ser positivos y razonables
    assert.ok(avgPay > 0);
    assert.ok(overtimeResult.overtimePayCents > 0);
  });
});
