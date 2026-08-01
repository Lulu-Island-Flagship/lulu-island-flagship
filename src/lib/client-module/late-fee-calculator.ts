// Módulo nuevo y separado: "Módulo de Cliente" -- facturación. Cálculo de
// mora/recargo por atraso (late fee). Funciones PURAS, sin DB ni efectos
// secundarios: quien llame esto decide qué hacer con el resultado (aplicarlo
// como línea de factura, notificar al cliente, o ignorarlo por completo).

// Reduce un Date a su fecha calendario en la zona horaria del negocio
// (America/Vancouver), como Date UTC a medianoche de ESE día calendario.
// Fix (auditoría 2026-07-31, hallazgo #16): la versión anterior de
// isInvoiceOverdue comparaba `referenceDate.getTime() > dueDate.getTime()`
// -- timestamps COMPLETOS, con hora. `due_date` es una columna DATE de
// Postgres (client_invoices.due_date, migración 276, sin componente de
// hora) que normalmente llega aquí como `new Date("YYYY-MM-DD")`, es decir
// medianoche UTC de ese día -- que en Vancouver (UTC-7/8) cae en la TARDE
// del día calendario ANTERIOR. Con la comparación anterior, una factura se
// marcaba "overdue" desde la tarde del día antes de su fecha de
// vencimiento real en hora de negocio -- horas antes de lo esperado, y
// consistentemente el día equivocado, no solo "unas horas antes". Se
// normalizan ambas fechas a su fecha calendario en America/Vancouver antes
// de comparar, para que "overdue" dependa solo del DÍA, no de la hora.
function toVancouverCalendarDayUtc(date: Date): number {
  const vancouverDateStr = date.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  // "en-CA" produce "YYYY-MM-DD" -- se parsea directo a un Date UTC de
  // medianoche para poder comparar como número (getTime()) sin volver a
  // arrastrar componente de hora.
  return new Date(`${vancouverDateStr}T00:00:00Z`).getTime();
}

// true si la fecha de referencia (normalmente "hoy") es posterior al DÍA
// de vencimiento (comparando fechas calendario en America/Vancouver, no
// timestamps con hora) Y la factura no está en un estado terminal donde el
// atraso ya no aplica ('paid' o 'void'). Cualquier otro status (ej.
// 'pending', 'sent', 'partially_paid') se considera potencialmente
// overdue si la fecha ya pasó. El propio día de vencimiento NO cuenta
// como overdue todavía (overdue empieza el día SIGUIENTE al due_date).
export function isInvoiceOverdue(
  dueDate: Date,
  referenceDate: Date,
  invoiceStatus: string
): boolean {
  if (invoiceStatus === "paid" || invoiceStatus === "void") {
    return false;
  }
  return toVancouverCalendarDayUtc(referenceDate) > toVancouverCalendarDayUtc(dueDate);
}

// lateFeePercentage viene de system_settings (key: "late_fee_percentage"),
// NUNCA hardcodeado aquí -- este módulo es independiente de settings-service
// a propósito (mantiene esta función pura y testeable sin DB); el caller es
// quien resuelve el valor vía getSetting("late_fee_percentage") y lo pasa
// como parámetro.
//
// [ASSUMPTION] El máximo legal en BC para recargos por atraso es 1.5%
// mensual (Consumer Protection Act de BC, restricciones sobre "interest" /
// cargos por pago atrasado en contratos de consumo). Esta función NO valida
// ese tope legal -- es responsabilidad de quien configura el valor de
// `late_fee_percentage` en system_settings asegurarse de que cumple con la
// ley aplicable. Si se requiere, ese chequeo debería vivir como validación
// en el servicio que escribe el setting, no aquí.
export function calculateLateFeeCents(
  balanceDueCents: number,
  lateFeePercentage: number
): number {
  return Math.round(balanceDueCents * lateFeePercentage);
}
