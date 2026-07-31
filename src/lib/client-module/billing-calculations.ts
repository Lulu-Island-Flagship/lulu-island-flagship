// Módulo nuevo y separado: "Módulo de Cliente" -- facturación. Funciones
// PURAS de cálculo de montos de factura (line items, totales, número de
// factura). Sin DB, sin efectos secundarios, 100% testeables sin mocks.
//
// Todo se maneja en CENTAVOS ENTEROS (nunca float) por la razón de siempre:
// aritmética de punto flotante en dólares (ej. 0.1 + 0.2 !== 0.3 en JS)
// puede producir centavos fantasma que no cuadran en reconciliación. Cada
// función que multiplica/aplica una tasa redondea inmediatamente a un
// entero con Math.round() en vez de dejar que el resultado fraccionario se
// propague y se acumule en cálculos posteriores.

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
  propertyServiceId?: string | null;
}

// Redondeo aplicado AQUÍ (por línea), no al sumar el subtotal. Motivo: si
// se sumaran las cantidades*precio como floats y solo se redondeara el
// subtotal al final, el error de punto flotante de cada línea individual
// se acumularía en la suma antes del redondeo (ej. 3 líneas con 0.005
// centavos de error de flotante cada una podrían sumar 0.015 antes de
// redondear, potencialmente cruzando un borde de redondeo distinto al que
// se obtendría redondeando línea por línea). Redondear cada línea a un
// entero de centavos primero garantiza que la suma de líneas sea exacta
// (suma de enteros, sin re-introducir error de flotante) y que el importe
// mostrado por línea en la factura coincida exactamente con el que se usó
// para el subtotal.
export function calculateLineItemAmountCents(
  quantity: number,
  unitPriceCents: number
): number {
  return Math.round(quantity * unitPriceCents);
}

// ---------------------------------------------------------------------------
// Totales de factura
// ---------------------------------------------------------------------------

export interface InvoiceTotals {
  subtotalCents: number;
  gstAmountCents: number;
  pstAmountCents: number;
  totalCents: number;
}

// gstRate/pstRate siempre vienen como parámetro -- NUNCA hardcodeadas aquí.
// El caller (invoice-service.ts) las obtiene de system_settings vía
// getSetting('tax_gst_rate', ...) / getSetting('tax_pst_rate_bc', ...),
// exactamente como settings-service.ts ya expone para otras tasas del
// sistema. Mantener las tasas fuera de esta función pura permite testearla
// con cualquier combinación de tasas sin tocar la DB ni mockear settings.
export function calculateInvoiceTotals(
  lineItems: LineItemInput[],
  gstRate: number,
  pstRate: number
): InvoiceTotals {
  const subtotalCents = lineItems.reduce(
    (sum, item) =>
      sum + calculateLineItemAmountCents(item.quantity, item.unitPriceCents),
    0
  );

  // Redondeo independiente para GST y PST (no se deriva un impuesto del
  // otro) porque BC aplica GST (federal) y PST (provincial) como dos
  // cálculos separados e independientes sobre el mismo subtotal, cada uno
  // con su propia tasa -- así es como se calculan en la práctica en
  // facturas reales de BC, y así evitamos que el redondeo de uno
  // contamine el cálculo del otro.
  const gstAmountCents = Math.round(subtotalCents * gstRate);
  const pstAmountCents = Math.round(subtotalCents * pstRate);

  // Suma de enteros ya redondeados -- exacta, sin nuevo error de flotante.
  const totalCents = subtotalCents + gstAmountCents + pstAmountCents;

  return { subtotalCents, gstAmountCents, pstAmountCents, totalCents };
}

// ---------------------------------------------------------------------------
// Número de factura
// ---------------------------------------------------------------------------

// Formato: INV-<año>-<secuencial con padding a 6 dígitos>, ej.
// "INV-2026-000123". El año se toma de issueDate (no de la fecha actual del
// sistema) para que una factura emitida el 31 de diciembre y confirmada
// recién el 1 de enero conserve el año de emisión real, no el de cuando se
// ejecuta el código.
//
// [LIMITACIÓN CONOCIDA] Esta función SOLO resuelve el FORMATO del número de
// factura. NO resuelve -- ni intenta resolver -- la atomicidad de obtener
// un `sequenceNumber` único y sin condición de carrera. Si dos facturas se
// crean concurrentemente y ambas leen "el próximo secuencial" con algo como
// `SELECT COUNT(*) + 1` fuera de una transacción/lock, pueden terminar con
// el mismo sequenceNumber y por lo tanto el mismo invoice_number (colisión
// real, no solo teórica, bajo escritura concurrente). Es responsabilidad
// exclusiva del CALLER obtener un sequenceNumber libre de condición de
// carrera antes de invocar esta función -- por ejemplo con una secuencia
// nativa de Postgres (`CREATE SEQUENCE` + `nextval()`), o con un
// `SELECT COUNT(*) + 1 ... FOR UPDATE` dentro de una transacción real, o
// con un `UNIQUE` constraint sobre invoice_number que rechace duplicados y
// obligue a reintentar con un secuencial nuevo. Esta función no hace nada
// de eso: toma el número que se le pasa y solo le da formato.
export function generateInvoiceNumber(
  issueDate: Date,
  sequenceNumber: number
): string {
  const year = issueDate.getUTCFullYear();
  const padded = String(sequenceNumber).padStart(6, "0");
  return `INV-${year}-${padded}`;
}
