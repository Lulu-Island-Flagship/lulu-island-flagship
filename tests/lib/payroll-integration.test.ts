/**
 * v8.4 — Payroll Integration Tests.
 *
 * Pruebas de integración para el pipeline completo de nómina:
 *   calculatePayrollForEmployee() → PayrollCalculationResult → PayStatement
 *
 * Cubre: Day Rate + comisiones + horas extra, topes CPP/EI, Vacation Pay
 * (4%/6%), WorkSafeBC, YTD acumulación, masking de SIN, validación PD7A,
 * y edge cases multi-rate y tope CPP a mitad de año.
 *
 * Sin dependencia de base de datos — todo mockeado con funciones puras.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { calculatePayrollForEmployee, type PayrollCalculationResult } from "../../src/lib/payroll-calculator";
import { generatePayStatement } from "../../src/lib/pay-statement";
import { maskSin, type LaborEvent } from "../../src/lib/payroll-line";
import { calculateCPP, calculateEI, calculateVacationAccrual, getWorksafeBCPremium } from "../../src/lib/compliance-resolver";

// =========================================================================
// Helpers
// =========================================================================

/** Day rate diario en centavos: $195.00 CAD */
const DAY_RATE_195 = 19500;
/** Comisión de ejemplo: $50.00 CAD */
const COMISION_50 = 5000;
/** Hora extra: 2h × 1.5 × ($195/8h≈$24.375/hr) ≈ $73.13 CAD */
const HORA_EXTRA_2H = 7313;

function dayRateEvent(amount_cents: number, fecha: string): LaborEvent {
  return { tipo: "day_rate", amount_cents, fecha };
}

function comisionEvent(amount_cents: number, fecha: string, referencia?: string): LaborEvent {
  return { tipo: "comision", amount_cents, fecha, referencia };
}

function horaExtraEvent(amount_cents: number, fecha: string): LaborEvent {
  return { tipo: "hora_extra", amount_cents, fecha };
}

// =========================================================================
// calculatePayrollForEmployee — flujo completo
// =========================================================================

describe("calculatePayrollForEmployee", () => {
  /** Escenario base: 2 días de Day Rate + 1 comisión, 2 años de servicio. */
  const baseEvents: LaborEvent[] = [
    dayRateEvent(DAY_RATE_195, "2026-08-01"),
    dayRateEvent(DAY_RATE_195, "2026-08-03"),
    comisionEvent(COMISION_50, "2026-08-02", "upsell_order_42"),
  ];
  const baseOptions = {
    years_of_service: 2,
    period_start: new Date("2026-08-01"),
  };

  it("calcula Day Rate + comisiones + horas extra correctamente", () => {
    const events: LaborEvent[] = [
      ...baseEvents,
      horaExtraEvent(HORA_EXTRA_2H, "2026-08-04"),
    ];

    const result = calculatePayrollForEmployee("emp-001", "ciclo-001", events, baseOptions);

    // Gross = day_rate (19500×2) + comision (5000) + hora_extra (7313) = 51313
    assert.strictEqual(result.day_rate_cents, 39000);
    assert.strictEqual(result.comisiones_cents, 5000);
    assert.strictEqual(result.horas_extra_cents, 7313);
    assert.strictEqual(result.gross_cents, 39000 + 5000 + 7313);

    // Vacation Pay 4% sobre gross
    const expectedVacation = Math.round((39000 + 5000 + 7313) * 0.04);
    assert.strictEqual(result.vacation_pay_cents, expectedVacation);
    assert.strictEqual(result.vacation_pay_rate, 0.04);

    // Neto debe ser positivo
    assert.ok(result.neto_pagar_cents > 0, "neto_pagar_cents debe ser positivo");
  });

  it("CPP no excede el tope anual ($74,600)", () => {
    // Empleado ya cerca del tope YMPE: ytd_gross = $73,000 (7,300,000 cents)
    const highYtd = {
      ytd_previous: {
        ytd_gross: 7_300_000,
        ytd_cpp: 300_000,
        ytd_ei: 0,
        ytd_tax: 0,
      },
      years_of_service: 3,
      period_start: new Date("2026-08-01"),
    };

    // Este período paga $5,000 → excede el YMPE y solo contribuye CPP sobre el espacio restante
    const events: LaborEvent[] = [
      dayRateEvent(500_000, "2026-08-01"), // $5,000 — excede el YMPE ($74,600)
    ];

    const result = calculatePayrollForEmployee("emp-002", "ciclo-001", events, highYtd);

    // Después de este ciclo: ytd_gross = 73,000 + 5,000 = 78,000 > 74,600
    // CPP solo sobre el espacio hasta YMPE: 74,600 - 73,000 = 1,600 = 160,000 cents
    // Fórmula: min(gross - exemptionPerPeriod, roomToYmpe) × rate
    //   roomToYmpe = 160,000, grossLessExemption = 500,000 - 14,583 = 485,417
    //   pensionableThisPeriod = min(485,417, 160,000) = 160,000
    //   expectedCpp = round(160,000 × 0.0595) = round(9,520) = 9,520
    const expectedCpp = Math.round(160_000 * 0.0595);
    assert.strictEqual(result.cpp_employee_cents, expectedCpp,
      `CPP debe ser ${expectedCpp} (solo sobre el espacio hasta YMPE), no sobre el gross completo`);
    assert.ok(result.cpp_employee_cents < 30_000, "CPP debe ser mucho menor que $300 (5% de $5,000)");
  });

  it("EI no excede el tope anual ($68,900)", () => {
    // Empleado ya cerca del tope EI (MIE 2026 = $68,900)
    const highYtd = {
      ytd_previous: {
        ytd_gross: 6_800_000, // $68,000
        ytd_cpp: 0,
        ytd_ei: 900_00,
        ytd_tax: 0,
      },
      years_of_service: 1,
      period_start: new Date("2026-08-01"),
    };

    const events: LaborEvent[] = [
      dayRateEvent(200_000, "2026-08-01"), // $2,000 — excede el tope EI ($68,900)
    ];

    const result = calculatePayrollForEmployee("emp-003", "ciclo-001", events, highYtd);

    // EI solo sobre espacio hasta $68,900: 68,900 - 68,000 = 900
    const maxEiThisPeriod = Math.round(90_000 * 0.0163);
    assert.ok(result.ei_employee_cents <= maxEiThisPeriod + 100, "EI no debe exceder el espacio hasta el tope asegurable");
  });

  it("Vacation Pay: 4% para <5 años, 6% para ≥5 años", () => {
    const events: LaborEvent[] = [dayRateEvent(200_000, "2026-08-01")]; // $2,000 gross

    // < 5 años
    const resultJunior = calculatePayrollForEmployee("emp-004", "ciclo-001", events, {
      years_of_service: 3,
      period_start: new Date("2026-08-01"),
    });
    assert.strictEqual(resultJunior.vacation_pay_rate, 0.04);
    assert.strictEqual(resultJunior.vacation_pay_cents, Math.round(200_000 * 0.04));

    // ≥ 5 años
    const resultSenior = calculatePayrollForEmployee("emp-005", "ciclo-001", events, {
      years_of_service: 6,
      period_start: new Date("2026-08-01"),
    });
    assert.strictEqual(resultSenior.vacation_pay_rate, 0.06);
    assert.strictEqual(resultSenior.vacation_pay_cents, Math.round(200_000 * 0.06));
  });

  it("WorkSafeBC prima se calcula correctamente (solo empleador)", () => {
    const events: LaborEvent[] = [dayRateEvent(300_000, "2026-08-01")]; // $3,000 gross

    const result = calculatePayrollForEmployee("emp-006", "ciclo-001", events, {
      years_of_service: 2,
      period_start: new Date("2026-08-01"),
    });

    // class_rate = 2.15, formula: gross_cents * class_rate / 100
    const expectedWsbc = Math.round((300_000 * 2.15) / 100);
    assert.strictEqual(result.worksafebc_cents, expectedWsbc);

    // WorkSafeBC es SOLO empleador — no afecta el neto del empleado
    const netoConWsbc = result.gross_cents + result.vacation_pay_cents - result.total_deductions_cents;
    assert.strictEqual(result.neto_pagar_cents, netoConWsbc);

    // La contribución del empleador NO se descuenta del neto del empleado
    assert.ok(result.total_employer_cents > 0);
    assert.ok(result.total_employer_cents >= result.worksafebc_cents);
  });

  it("YTD acumula correctamente a través de múltiples ciclos", () => {
    // Ciclo 1: $2,000 gross, sin YTD previo
    const events1: LaborEvent[] = [dayRateEvent(200_000, "2026-08-01")];
    const result1 = calculatePayrollForEmployee("emp-007", "ciclo-001", events1, {
      years_of_service: 2,
      period_start: new Date("2026-08-01"),
    });

    assert.strictEqual(result1.ytd_gross, 200_000);
    assert.ok(result1.ytd_cpp > 0);
    assert.ok(result1.ytd_ei > 0);

    // Ciclo 2: otros $3,000 gross, YTD previo = result1
    const events2: LaborEvent[] = [dayRateEvent(300_000, "2026-08-16")];
    const result2 = calculatePayrollForEmployee("emp-007", "ciclo-002", events2, {
      years_of_service: 2,
      period_start: new Date("2026-08-16"),
      ytd_previous: {
        ytd_gross: result1.ytd_gross,
        ytd_cpp: result1.ytd_cpp,
        ytd_ei: result1.ytd_ei,
        ytd_tax: result1.ytd_tax,
      },
    });

    // YTD debe acumular
    assert.strictEqual(result2.ytd_gross, result1.ytd_gross + 300_000);
    assert.strictEqual(result2.ytd_cpp, result1.ytd_cpp + result2.cpp_employee_cents);
    assert.strictEqual(result2.ytd_ei, result1.ytd_ei + result2.ei_employee_cents);
  });
});

// =========================================================================
// PayStatement — generación y validación
// =========================================================================

describe("generatePayStatement", () => {
  const baseResult: PayrollCalculationResult = {
    employee_id: "emp-010",
    ciclo_id: "ciclo-010",
    day_rate_cents: 39000,
    comisiones_cents: 5000,
    horas_extra_cents: 0,
    vacation_pay_cents: 1760,
    gross_cents: 44000,
    cpp_employee_cents: 2100,
    ei_employee_cents: 717,
    tax_federal_cents: 6600,
    tax_provincial_cents: 2226,
    total_deductions_cents: 11643,
    cpp_employer_cents: 2100,
    ei_employer_cents: 1004,
    worksafebc_cents: 946,
    total_employer_cents: 4050,
    vacation_pay_rate: 0.04,
    neto_pagar_cents: 34117,
    ytd_gross: 44000,
    ytd_cpp: 2100,
    ytd_ei: 717,
    ytd_tax: 8826,
    years_of_service: 2,
  };

  it("genera un PayStatement con todos los campos requeridos", () => {
    const statement = generatePayStatement("emp-010", "ciclo-010", {
      calculation: baseResult,
      employee_name: "María García",
      sin_plain: "123456789",
      periodo: {
        quincena: "2026-08 Q1",
        fecha_inicio: "2026-08-01",
        fecha_fin: "2026-08-15",
        fecha_pago: "2026-08-20",
      },
    });

    // Estructura completa
    assert.ok(statement.employer, "employer debe existir");
    assert.ok(statement.employee, "employee debe existir");
    assert.ok(statement.periodo, "periodo debe existir");
    assert.ok(statement.earnings, "earnings debe existir");
    assert.ok(statement.deductions, "deductions debe existir");
    assert.ok(statement.employer_contributions, "employer_contributions debe existir");
    assert.ok(statement.ytd, "ytd debe existir");
    assert.ok(typeof statement.net_pay_cents === "number", "net_pay_cents debe ser number");
    assert.ok(statement.legal_note.length > 0, "legal_note debe existir");
    assert.ok(statement.generated_at.length > 0, "generated_at debe existir");

    // Employer defaults
    assert.strictEqual(statement.employer.nombre, "Lulu Island Flagship Ltd.");
    assert.strictEqual(statement.employer.business_number, "123456789");

    // Employee info
    assert.strictEqual(statement.employee.nombre, "María García");

    // Earnings
    assert.strictEqual(statement.earnings.day_rate_cents, 39000);
    assert.strictEqual(statement.earnings.comisiones_cents, 5000);
    assert.strictEqual(statement.earnings.gross_cents, 44000);
    assert.strictEqual(statement.earnings.total_gross_cents, 44000 + 1760);

    // Deductions
    assert.strictEqual(statement.deductions.cpp_cents, 2100);
    assert.strictEqual(statement.deductions.ei_cents, 717);

    // Employer contributions
    assert.strictEqual(statement.employer_contributions.cpp_cents, 2100);
    assert.strictEqual(statement.employer_contributions.worksafebc_cents, 946);

    // Net pay
    assert.strictEqual(statement.net_pay_cents, 34117);
  });

  it("SIN se enmascara correctamente: '*** *** 123'", () => {
    const statement = generatePayStatement("emp-011", "ciclo-011", {
      calculation: baseResult,
      employee_name: "Carlos López",
      sin_plain: "987654321",
    });

    assert.strictEqual(statement.employee.sin_masked, "*** *** 321");
  });

  it("SIN inválido o corto se enmascara con asteriscos completos", () => {
    assert.strictEqual(maskSin("12345"), "*** *** ***");
    assert.strictEqual(maskSin("123 456 78"), "*** *** ***");
    assert.strictEqual(maskSin("123-456-789"), "*** *** 789");
  });

  it("PD7A: totales del PayStatement cuadran con el PayrollCalculationResult", () => {
    const statement = generatePayStatement("emp-012", "ciclo-012", {
      calculation: baseResult,
      employee_name: "Ana Rodríguez",
    });

    // Gross del statement = gross del calculation
    assert.strictEqual(statement.earnings.gross_cents, baseResult.gross_cents);

    // Deductions del statement = total_deductions del calculation
    const totalDedStmt =
      statement.deductions.cpp_cents +
      statement.deductions.ei_cents +
      statement.deductions.federal_tax_cents +
      statement.deductions.provincial_tax_cents;
    assert.strictEqual(totalDedStmt, baseResult.total_deductions_cents);

    // Net pay del statement = neto_pagar del calculation
    assert.strictEqual(statement.net_pay_cents, baseResult.neto_pagar_cents);

    // YTD del statement = YTD del calculation
    assert.strictEqual(statement.ytd.gross_cents, baseResult.ytd_gross);
    assert.strictEqual(statement.ytd.cpp_cents, baseResult.ytd_cpp);
    assert.strictEqual(statement.ytd.ei_cents, baseResult.ytd_ei);
    assert.strictEqual(statement.ytd.tax_cents, baseResult.ytd_tax);
  });
});

// =========================================================================
// Edge cases — payroll
// =========================================================================

describe("Payroll edge cases", () => {
  it("empleado con múltiples Day Rates en un mismo ciclo (diferentes tarifas)", () => {
    const events: LaborEvent[] = [
      dayRateEvent(19500, "2026-08-01"), // $195
      dayRateEvent(22000, "2026-08-03"), // $220 (tarifa distinta, ej. servicio especial)
      dayRateEvent(19500, "2026-08-05"), // $195
    ];

    const result = calculatePayrollForEmployee("emp-100", "ciclo-100", events, {
      years_of_service: 2,
      period_start: new Date("2026-08-01"),
    });

    // Day rate total = suma de todas las tarifas
    assert.strictEqual(result.day_rate_cents, 19500 + 22000 + 19500);
    assert.strictEqual(result.gross_cents, result.day_rate_cents);
  });

  it("empleado excede tope CPP a mitad de año", () => {
    // Simulamos estar en julio (mitad de año fiscal) con YTD ya alto
    const midYearYtd = {
      ytd_previous: {
        ytd_gross: 7_300_000, // $73,000 — casi en el tope YMPE de $74,600
        ytd_cpp: 350_000,
        ytd_ei: 100_000,
        ytd_tax: 600_000,
      },
      years_of_service: 4,
      period_start: new Date("2026-07-15"),
    };

    const events: LaborEvent[] = [
      dayRateEvent(300_000, "2026-07-15"), // $3,000
    ];

    const result = calculatePayrollForEmployee("emp-101", "ciclo-101", events, midYearYtd);

    // CPP solo sobre el espacio hasta $74,600 = 160,000 cents
    // pensionableThisPeriod = min(gross - exemption, roomToYmpe)
    //   = min(300,000 - 14,583, 160,000) = 160,000
    // expectedCpp = round(160,000 × 0.0595) = 9,520
    const expectedCpp = Math.round(160_000 * 0.0595);
    assert.strictEqual(result.cpp_employee_cents, expectedCpp,
      `CPP ${result.cpp_employee_cents} should be ${expectedCpp}`);

    // Employer CPP también limitado
    assert.strictEqual(result.cpp_employer_cents, result.cpp_employee_cents);

    // Después de este período, el empleado ya no contribuye más CPP en el año
    // porque alcanzó el YMPE (o está muy cerca)
    assert.ok(result.ytd_gross >= 7_300_000 + 300_000);
  });

  it("empleado con eventos de hora extra múltiples en un ciclo", () => {
    const events: LaborEvent[] = [
      dayRateEvent(19500, "2026-08-01"),
      horaExtraEvent(5000, "2026-08-01"),  // overtime mismo día
      horaExtraEvent(3000, "2026-08-03"),  // overtime otro día
    ];

    const result = calculatePayrollForEmployee("emp-102", "ciclo-102", events, {
      years_of_service: 1,
      period_start: new Date("2026-08-01"),
    });

    assert.strictEqual(result.horas_extra_cents, 5000 + 3000);
    assert.strictEqual(result.gross_cents, 19500 + 5000 + 3000);
  });
});

// =========================================================================
// compliance-resolver — cálculos directos
// =========================================================================

describe("compliance-resolver (CPP/EI/Vacation/WorkSafeBC)", () => {
  it("calculateCPP con YTD cero devuelve contribución estándar", () => {
    const result = calculateCPP({
      grossPayCents: 200_000, // $2,000
      periodStart: new Date("2026-08-01"),
      ytdPensionableCents: 0,
    });

    // Empleado: (200000 - 350000/24) * 0.0595
    const exemptionPerPeriod = Math.round(350_000 / 24);
    const expectedEmployeeCents = Math.round((200_000 - exemptionPerPeriod) * 0.0595);

    assert.strictEqual(result.employeeCents, expectedEmployeeCents);
    assert.strictEqual(result.rate, 0.0595);
    assert.strictEqual(result.ympEcents, 7_460_000);
  });

  it("calculateEI con YTD cero devuelve contribución estándar", () => {
    const result = calculateEI({
      grossPayCents: 200_000,
      periodStart: new Date("2026-08-01"),
      ytdInsurableCents: 0,
    });

    const expectedEmployeeCents = Math.round(200_000 * 0.0163);
    assert.strictEqual(result.employeeCents, expectedEmployeeCents);
    assert.strictEqual(result.rate, 0.0163);
    assert.strictEqual(result.maxInsurableCents, 6_890_000);
  });

  it("calculateVacationAccrual: 4% para <5 años, 6% para ≥5 años", () => {
    const gross = 300_000; // $3,000
    const periodStart = new Date("2026-08-01");

    assert.strictEqual(calculateVacationAccrual(gross, 0, periodStart), Math.round(gross * 0.04));
    assert.strictEqual(calculateVacationAccrual(gross, 2, periodStart), Math.round(gross * 0.04));
    assert.strictEqual(calculateVacationAccrual(gross, 4, periodStart), Math.round(gross * 0.04));
    // Límite exacto — 5 años = 6%
    assert.strictEqual(calculateVacationAccrual(gross, 5, periodStart), Math.round(gross * 0.06));
    assert.strictEqual(calculateVacationAccrual(gross, 10, periodStart), Math.round(gross * 0.06));
  });

  it("getWorksafeBCPremium usa class_rate 2.15", () => {
    const premium = getWorksafeBCPremium({
      totalPayrollCents: 500_000, // $5,000
      referenceDate: new Date("2026-08-01"),
    });

    // class_rate = 2.15, formula: totalPayrollCents * 2.15 / 100
    const expected = Math.round((500_000 * 2.15) / 100);
    assert.strictEqual(premium, expected);
  });
});
