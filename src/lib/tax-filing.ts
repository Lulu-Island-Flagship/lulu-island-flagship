/**
 * Capa 5 — Tax Filing: declaraciones GST/PST, fechas límite y alertas.
 *
 * Genera los datos necesarios para NETFILE (GST return electrónico ante CRA),
 * calcula fechas de vencimiento según la frecuencia de declaración, y emite
 * alertas cuando una obligación fiscal está próxima a vencer o ya venció.
 *
 * Reutiliza `nextBusinessDay` de cra-remittances.ts para ajustar fechas
 * límite que caen en fin de semana o festivo CRA (política oficial).
 *
 * Todas las funciones son puras: no tocan base de datos ni APIs externas.
 */

import { nextBusinessDay } from "@/lib/cra-remittances";
import { type TaxObligation, type TaxType } from "@/lib/tax-engine";
import {
  getFilingFrequency as determineFilingFrequency,
} from "@/lib/tax-engine";

// =========================================================================
// Domain types
// =========================================================================

/** Frecuencia de declaración fiscal. */
export type FilingFrequency = "trimestral" | "mensual";

/**
 * Datos completos para una declaración NETFILE de GST.
 * Representa lo que se enviaría electrónicamente a la CRA.
 */
export interface GstReturnData {
  /** Período contable YYYY-MM */
  periodo: string;
  /** GST total cobrado en ventas, centavos */
  gst_collected_cents: number;
  /** GST Input Tax Credits (ITCs), centavos */
  gst_itc_cents: number;
  /** GST neto a remitir (collected - ITCs), centavos */
  gst_net_cents: number;
  /** Frecuencia de declaración del contribuyente */
  filing_frequency: FilingFrequency;
  /** Fecha límite de presentación (ISO 8601), ajustada al siguiente día hábil */
  deadline_iso: string;
  /** Días restantes hasta la fecha límite desde hoy */
  days_until_deadline: number;
}

/**
 * Alerta de vencimiento próximo para una obligación fiscal.
 */
export interface FilingDeadlineAlert {
  /** Período contable YYYY-MM */
  periodo: string;
  /** Tipo de impuesto: GST o PST */
  tipo: TaxType;
  /** Días restantes hasta la fecha límite */
  days_until_deadline: number;
  /** Fecha límite (ISO 8601) */
  deadline_iso: string;
  /** Nivel de urgencia de la alerta */
  urgency: "info" | "warning" | "critical";
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Retorna el trimestre calendario para un período YYYY-MM.
 *
 * @param periodo — Período en formato YYYY-MM.
 * @returns Número de trimestre: 1 (Ene-Mar), 2 (Abr-Jun), 3 (Jul-Sep), 4 (Oct-Dic).
 */
export function getQuarterFromPeriod(periodo: string): number {
  const month = parseInt(periodo.slice(5, 7), 10);
  return Math.ceil(month / 3);
}

/**
 * Último día de un mes dado (1-indexado).
 */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Formatea año, mes (1-indexado) y día como ISO date string YYYY-MM-DD.
 */
function isoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Calcula los días restantes entre hoy y una fecha ISO.
 * Retorna número negativo si la fecha ya pasó.
 */
function daysUntil(deadlineIso: string, referenceDate?: Date): number {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  ref.setUTCHours(0, 0, 0, 0);
  const deadline = new Date(`${deadlineIso}T00:00:00.000Z`);
  return Math.ceil(
    (deadline.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24),
  );
}

// =========================================================================
// Filing deadline calculation
// =========================================================================

/**
 * Calcula la fecha de vencimiento para un período y frecuencia de declaración.
 *
 * Reglas:
 *  - Trimestral: vence el último día del mes siguiente al cierre del trimestre.
 *    Q1 (Ene-Mar) → último día de Abr | Q2 (Abr-Jun) → último día de Jul
 *    Q3 (Jul-Sep) → último día de Oct | Q4 (Oct-Dic) → último día de Ene (año siguiente)
 *  - Mensual: vence el último día del mes siguiente.
 *
 * En ambos casos, si la fecha cae en fin de semana o festivo CRA,
 * se ajusta al siguiente día hábil vía `nextBusinessDay()`.
 *
 * @param periodo — Período contable YYYY-MM.
 * @param frequency — "trimestral" o "mensual".
 * @returns Fecha de vencimiento ISO 8601 ajustada al siguiente día hábil.
 */
export function getFilingDeadline(
  periodo: string,
  frequency?: FilingFrequency,
): string {
  const freq = frequency ?? "trimestral";
  const year = parseInt(periodo.slice(0, 4), 10);
  const month = parseInt(periodo.slice(5, 7), 10);

  if (freq === "mensual") {
    // Deadline: último día del mes siguiente
    const deadlineYear = month === 12 ? year + 1 : year;
    const deadlineMonth = month === 12 ? 1 : month + 1;
    const rawDeadline = isoDate(
      deadlineYear,
      deadlineMonth,
      lastDayOfMonth(deadlineYear, deadlineMonth),
    );
    return nextBusinessDay(rawDeadline);
  }

  // Trimestral: deadline es el último día del mes siguiente al cierre del trimestre
  const quarter = getQuarterFromPeriod(periodo);
  let deadlineYear: number;
  let deadlineMonth: number;

  switch (quarter) {
    case 1: // Ene-Mar → último día de Abr
      deadlineYear = year;
      deadlineMonth = 4;
      break;
    case 2: // Abr-Jun → último día de Jul
      deadlineYear = year;
      deadlineMonth = 7;
      break;
    case 3: // Jul-Sep → último día de Oct
      deadlineYear = year;
      deadlineMonth = 10;
      break;
    case 4: // Oct-Dic → último día de Ene (año siguiente)
      deadlineYear = year + 1;
      deadlineMonth = 1;
      break;
    default:
      throw new Error(`Trimestre inválido para periodo=${periodo}`);
  }

  const rawDeadline = isoDate(
    deadlineYear,
    deadlineMonth,
    lastDayOfMonth(deadlineYear, deadlineMonth),
  );
  return nextBusinessDay(rawDeadline);
}

// =========================================================================
// Filing frequency
// =========================================================================

/**
 * Determina la frecuencia de declaración según el revenue anual.
 *
 * Delega en tax-engine.getFilingFrequency:
 *  - < $3,000,000/año → trimestral
 *  - ≥ $3,000,000/año → mensual
 *
 * Si no se provee annualRevenueCents, asume trimestral (small business default).
 *
 * @param annualRevenueCents — Revenue anual en centavos (opcional).
 * @returns "trimestral" o "mensual".
 */
export function getFilingFrequency(annualRevenueCents?: number): FilingFrequency {
  if (annualRevenueCents === undefined) return "trimestral";
  return determineFilingFrequency(annualRevenueCents);
}

/**
 * Determina la frecuencia de declaración a partir del revenue anual (alias).
 *
 * @deprecated Use getFilingFrequency(annualRevenueCents) instead.
 */
export function getFilingFrequencyFromRevenue(
  annualRevenueCents: number,
): FilingFrequency {
  return determineFilingFrequency(annualRevenueCents);
}

// =========================================================================
// GST Return generation (NETFILE data)
// =========================================================================

/**
 * Genera los datos completos para una declaración NETFILE de GST.
 *
 * Calcula el GST neto, determina la frecuencia, obtiene la fecha límite
 * y calcula los días restantes. No envía nada a CRA — solo prepara el
 * payload que el caller puede presentar (o almacenar como borrador).
 *
 * @param periodo — Período contable YYYY-MM.
 * @param gstCollectedCents — GST cobrado en ventas del período.
 * @param gstItcCents — GST ITCs (créditos fiscales por compras/gastos).
 * @param annualRevenueCents — Revenue anual para determinar frecuencia (opcional).
 * @returns Datos completos del GST return.
 */
export function generateGstReturn(
  periodo: string,
  gstCollectedCents: number,
  gstItcCents: number,
  annualRevenueCents?: number,
): GstReturnData {
  const gstNetCents = gstCollectedCents - gstItcCents;
  const frequency = getFilingFrequency(annualRevenueCents);
  const deadlineIso = getFilingDeadline(periodo, frequency);

  return {
    periodo,
    gst_collected_cents: gstCollectedCents,
    gst_itc_cents: gstItcCents,
    gst_net_cents: gstNetCents,
    filing_frequency: frequency,
    deadline_iso: deadlineIso,
    days_until_deadline: daysUntil(deadlineIso),
  };
}

// =========================================================================
// Overdue filings detection
// =========================================================================

/**
 * Identifica obligaciones fiscales vencidas que no han sido declaradas.
 *
 * Una obligación está overdue si:
 *  - Su estado es PENDIENTE (no DECLARADO ni PAGADO).
 *  - Su fecha_vencimiento es anterior a la fecha de referencia (hoy por defecto).
 *
 * @param obligations — Lista de obligaciones fiscales a revisar.
 * @param referenceDate — Fecha de referencia (default: hoy).
 * @returns Obligaciones vencidas no declaradas, ordenadas por fecha de vencimiento ascendente.
 */
export function getOverdueFilings(
  obligations: TaxObligation[],
  referenceDate?: Date,
): TaxObligation[] {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  ref.setUTCHours(0, 0, 0, 0);

  return obligations
    .filter((obl) => {
      if (obl.estado !== "PENDIENTE") return false;
      const deadline = new Date(`${obl.fecha_vencimiento}T00:00:00.000Z`);
      return deadline < ref;
    })
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento));
}

// =========================================================================
// Filing reminder generation
// =========================================================================

/**
 * Genera un mensaje de recordatorio para una obligación fiscal.
 *
 * El formato varía según la urgencia:
 *  - Vencida: "GST return del período 2026-Q1 VENCIÓ el 2026-04-30. ¡Regularizar urgente!"
 *  - Próxima: "GST return del período 2026-Q2 vence en 5 días (2026-07-31)."
 *  - Lejana: "GST return del período 2026-Q3 vence en 30 días (2026-10-31)."
 *
 * @param obligation — La obligación fiscal.
 * @param referenceDate — Fecha de referencia (default: hoy).
 * @returns Mensaje de recordatorio en español.
 */
export function generateFilingReminder(
  obligation: TaxObligation,
  referenceDate?: Date,
): string {
  const remaining = daysUntil(obligation.fecha_vencimiento, referenceDate);
  const tipoLabel = obligation.tipo;
  const deadline = obligation.fecha_vencimiento;

  if (remaining < 0) {
    return (
      `${tipoLabel} return del período ${obligation.periodo} VENCIÓ ` +
      `el ${deadline}. ¡Regularizar urgente!`
    );
  }

  if (remaining === 0) {
    return (
      `${tipoLabel} return del período ${obligation.periodo} vence HOY ` +
      `(${deadline}).`
    );
  }

  if (remaining === 1) {
    return (
      `${tipoLabel} return del período ${obligation.periodo} vence ` +
      `mañana (${deadline}).`
    );
  }

  return (
    `${tipoLabel} return del período ${obligation.periodo} vence ` +
    `en ${remaining} días (${deadline}).`
  );
}

// =========================================================================
// Deadline alerts (batch)
// =========================================================================

/** Umbral en días para considerar una obligación como "próxima a vencer". */
const ALERT_WINDOW_DAYS = 14;

/**
 * Revisa una lista de obligaciones fiscales y emite alertas para aquellas
 * cuyo vencimiento está dentro de los próximos 14 días.
 *
 * Niveles de urgencia:
 *  - "critical": 0-2 días (o vencido — días negativos).
 *  - "warning": 3-7 días.
 *  - "info": 8-14 días.
 *
 * @param obligations — Lista de TaxObligation a revisar.
 * @param referenceDate — Fecha de referencia (default: hoy).
 * @returns Alertas ordenadas por días restantes ascendente (más urgentes primero).
 */
export function checkUpcomingDeadlines(
  obligations: TaxObligation[],
  referenceDate?: Date,
): FilingDeadlineAlert[] {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  ref.setUTCHours(0, 0, 0, 0);

  const alerts: FilingDeadlineAlert[] = [];

  for (const obl of obligations) {
    // Solo obligaciones pendientes
    if (obl.estado !== "PENDIENTE") continue;

    const remaining = daysUntil(obl.fecha_vencimiento, ref);

    // Incluir vencidas (días negativos) y las dentro de la ventana
    if (remaining > ALERT_WINDOW_DAYS) continue;

    let urgency: FilingDeadlineAlert["urgency"];
    if (remaining <= 2) {
      urgency = "critical";
    } else if (remaining <= 7) {
      urgency = "warning";
    } else {
      urgency = "info";
    }

    alerts.push({
      periodo: obl.periodo,
      tipo: obl.tipo,
      days_until_deadline: remaining,
      deadline_iso: obl.fecha_vencimiento,
      urgency,
    });
  }

  // Ordenar por urgencia: critical > warning > info, luego por días ascendente
  const urgencyOrder: Record<FilingDeadlineAlert["urgency"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return alerts.sort((a, b) => {
    const orderDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (orderDiff !== 0) return orderDiff;
    return a.days_until_deadline - b.days_until_deadline;
  });
}

export type FilingStatus = "PENDIENTE" | "GENERADO" | "REVISADO" | "ENVIADO" | "RECIBIDO_CRA" | "RECHAZADO_CRA";
export type FilingAttempt = { periodo: string; timestamp: string; resultado: string };
export type CRAConfirmationTracking = { referencia: string; estado: string };
export const getFilingStatus = (_periodo: string): FilingStatus => "PENDIENTE";
export const recordFilingAttempt = (_periodo: string, _result: string): void => {};
export const trackCRAConfirmation = (reference: string): CRAConfirmationTracking => ({ referencia: reference, estado: "PENDING" });
