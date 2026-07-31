// Módulo nuevo y separado: "Módulo de Cliente" -- facturación. Cálculo de
// mora/recargo por atraso (late fee). Funciones PURAS, sin DB ni efectos
// secundarios: quien llame esto decide qué hacer con el resultado (aplicarlo
// como línea de factura, notificar al cliente, o ignorarlo por completo).

// true si la fecha de referencia (normalmente "hoy") es posterior a la
// fecha de vencimiento Y la factura no está en un estado terminal donde el
// atraso ya no aplica ('paid' o 'void'). Cualquier otro status (ej.
// 'pending', 'sent', 'partially_paid') se considera potencialmente
// overdue si la fecha ya pasó.
export function isInvoiceOverdue(
  dueDate: Date,
  referenceDate: Date,
  invoiceStatus: string
): boolean {
  if (invoiceStatus === "paid" || invoiceStatus === "void") {
    return false;
  }
  return referenceDate.getTime() > dueDate.getTime();
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
