/**
 * Capa 1 — Financial Core: Reglas de imputación contable por tipo de evento.
 *
 * Cada evento de negocio que mueve dinero real o devenga una obligación tiene
 * una regla de imputación que asigna el débito y el crédito a las cuentas del
 * Chart of Accounts (coa.ts). Estas reglas son la fuente de verdad para que
 * cualquier subsistema (Shadow Ledger, nómina, inventario, gift cards, etc.)
 * sepa exactamente qué cuentas tocar sin hardcodear códigos dispersos por el
 * código.
 *
 * Principio de diseño:
 *   - Cada regla es un array de ImputationLine: la suma de débitos siempre
 *     iguala la suma de créditos en cantidad de líneas (el caller calcula
 *     los montos).
 *   - Las líneas con `computeFrom` indican que su monto se deriva de otra
 *     línea (ej. GST = 5% de la línea de revenue base).
 *   - Los tax rates son parametrizables por versión del COA (coa-version.ts)
 *     pero se declaran aquí como defaults razonables para la jurisdicción BC.
 */

// CuentaCOA se referencia desde coa.ts para validación de códigos.
// La importación es de tipo únicamente; el tipo concreto no se usa en runtime.

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Dirección de una línea de asiento contable. */
export type JournalSide = "debit" | "credit";

/**
 * Una línea individual dentro de una regla de imputación.
 *
 * @property accountCode — código de cuenta COA (ej. "1010", "2020").
 * @property side — débito o crédito.
 * @property description — descripción legible de qué representa esta línea.
 * @property computeFrom — si esta línea es un impuesto o cargo derivado,
 *   indica el accountCode de la línea base de la cual se calcula (ej. GST se
 *   calcula del revenue base). El caller multiplica el monto base por `rate`.
 * @property rate — tasa aplicable cuando computeFrom está presente
 *   (ej. 0.05 para 5% GST). Solo informativo: el caller debe usar la tasa
 *   vigente de coa-version.ts.
 */
export interface ImputationLine {
  readonly accountCode: string;
  readonly side: JournalSide;
  readonly description: string;
  readonly computeFrom?: string;
  readonly rate?: number;
}

/**
 * Resultado de una imputación: todas las líneas del asiento compuesto.
 */
export interface ImputationResult {
  /** Líneas completas del asiento. */
  readonly lines: readonly ImputationLine[];
  /** Códigos de cuenta al débito, separados por coma. */
  readonly debito: string;
  /** Códigos de cuenta al crédito, separados por coma. */
  readonly credito: string;
}

// ---------------------------------------------------------------------------
// Tasas impositivas por defecto (BC, 2026)
// ---------------------------------------------------------------------------

/** GST federal rate — 5% (2026). */
const GST_RATE = 0.05;

/** PST provincial rate — BC 7% (2026). */
const PST_RATE = 0.07;

// ---------------------------------------------------------------------------
// Catálogo de reglas de imputación
// ---------------------------------------------------------------------------

/**
 * Reglas de imputación: cada evento de negocio mapea a sus líneas contables.
 *
 * Convención de nombres de evento: `dominio.accion` en español, consistente
 * con el DSL de eventos del sistema (eventos.ts, shadow-ledger.ts).
 *
 * Tax handling: las líneas de GST/PST usan `computeFrom` para indicar que
 * su monto se deriva de la línea de revenue base. El caller (p.ej. el job
 * que genera asientos desde Shadow Ledger) debe:
 *   1. Determinar el monto base (revenue neto antes de impuestos).
 *   2. Calcular GST = base × tasa vigente (de coa-version.ts).
 *   3. Calcular PST = base × tasa vigente.
 *   4. El monto total cobrado = base + GST + PST → va a Cash/AR.
 *
 * Para imputaciones de nómina, los porcentajes de CPP, EI, y WorkSafeBC
 * también se obtienen de coa-version.ts (cambian anualmente).
 */
const IMPUTATION_RULES: ReadonlyMap<string, readonly ImputationLine[]> = new Map([

  // =========================================================================
  // INGRESOS — Captura de pagos de cliente
  // =========================================================================

  [
    "hold.capturado",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo recibido del cliente (captura de hold en Stripe/PayPal).",
      },
      {
        accountCode: "4010",
        side: "credit",
        description: "Ingreso por servicio principal — base imponible para GST/PST.",
      },
      {
        accountCode: "2020",
        side: "credit",
        description: "GST 5% federal cobrado al cliente.",
        computeFrom: "4010",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "credit",
        description: "PST 7% provincial (BC) cobrado al cliente.",
        computeFrom: "4010",
        rate: PST_RATE,
      },
    ],
  ],

  [
    "venta.directa",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo recibido por venta directa sin hold (pago inmediato).",
      },
      {
        accountCode: "4010",
        side: "credit",
        description: "Ingreso por servicio — base imponible.",
      },
      {
        accountCode: "2020",
        side: "credit",
        description: "GST 5% cobrado.",
        computeFrom: "4010",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "credit",
        description: "PST 7% cobrado.",
        computeFrom: "4010",
        rate: PST_RATE,
      },
    ],
  ],

  [
    "upsell.capturado",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo recibido por upsell/add-on capturado.",
      },
      {
        accountCode: "4020",
        side: "credit",
        description: "Ingreso por upsell — base imponible.",
      },
      {
        accountCode: "2020",
        side: "credit",
        description: "GST 5% sobre upsell.",
        computeFrom: "4020",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "credit",
        description: "PST 7% sobre upsell.",
        computeFrom: "4020",
        rate: PST_RATE,
      },
    ],
  ],

  [
    "cargo.cancelacion",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo recibido por penalidad de cancelación.",
      },
      {
        accountCode: "4050",
        side: "credit",
        description: "Ingreso por cargo de cancelación.",
      },
      {
        accountCode: "2020",
        side: "credit",
        description: "GST 5% sobre cargo de cancelación.",
        computeFrom: "4050",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "credit",
        description: "PST 7% sobre cargo de cancelación.",
        computeFrom: "4050",
        rate: PST_RATE,
      },
    ],
  ],

  [
    "cargo.rush",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Recargo por servicio urgente/fuera de horario.",
      },
      {
        accountCode: "4060",
        side: "credit",
        description: "Ingreso por rush service fee — base imponible.",
      },
      {
        accountCode: "2020",
        side: "credit",
        description: "GST 5% sobre rush fee.",
        computeFrom: "4060",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "credit",
        description: "PST 7% sobre rush fee.",
        computeFrom: "4060",
        rate: PST_RATE,
      },
    ],
  ],

  // =========================================================================
  // REEMBOLSOS
  // =========================================================================

  [
    "reembolso.emitido",
    [
      {
        accountCode: "4010",
        side: "debit",
        description: "Reversión de ingreso por servicio reembolsado.",
      },
      {
        accountCode: "2020",
        side: "debit",
        description: "Reversión de GST cobrado (se devuelve al cliente).",
        computeFrom: "4010",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "debit",
        description: "Reversión de PST cobrado (se devuelve al cliente).",
        computeFrom: "4010",
        rate: PST_RATE,
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo devuelto al cliente.",
      },
    ],
  ],

  [
    "reembolso.garantia",
    [
      {
        accountCode: "2095",
        side: "debit",
        description: "Consumo de provisión de garantía por re-trabajo cubierto.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo pagado por servicio de garantía (reembolso al cliente o pago a tercero).",
      },
    ],
  ],

  // =========================================================================
  // GIFT CARDS
  // =========================================================================

  [
    "giftcard.vendida",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo recibido por venta de gift card.",
      },
      {
        accountCode: "2100",
        side: "credit",
        description: "Pasivo por gift card emitida — no es ingreso hasta redención.",
      },
    ],
  ],

  [
    "giftcard.redimida",
    [
      {
        accountCode: "2100",
        side: "debit",
        description: "Extinción del pasivo por gift card redimida.",
      },
      {
        accountCode: "4010",
        side: "credit",
        description: "Ingreso por servicio pagado con gift card — base imponible.",
      },
      {
        accountCode: "2020",
        side: "credit",
        description: "GST 5% sobre servicio (aunque el cliente pagó con gift card, el impuesto se devengó al redimir).",
        computeFrom: "4010",
        rate: GST_RATE,
      },
      {
        accountCode: "2030",
        side: "credit",
        description: "PST 7% sobre servicio.",
        computeFrom: "4010",
        rate: PST_RATE,
      },
    ],
  ],

  [
    "giftcard.breakage",
    [
      {
        accountCode: "2100",
        side: "debit",
        description: "Cancelación del pasivo por gift card no redimida (breakage).",
      },
      {
        accountCode: "4035",
        side: "credit",
        description: "Ingreso por breakage de gift card — ASPE 3400. No gravado con GST/PST (no hubo servicio).",
      },
    ],
  ],

  // =========================================================================
  // NÓMINA
  // =========================================================================

  [
    "nomina.calculada",
    [
      {
        accountCode: "5010",
        side: "debit",
        description: "Costo de mano de obra directa (day rate + QC bonus + rework pagado + ajuste BC min wage).",
      },
      {
        accountCode: "5020",
        side: "debit",
        description: "Carga patronal: CPP employer, EI employer (1.4x), WorkSafeBC.",
      },
      {
        accountCode: "2080",
        side: "credit",
        description: "Salario neto a pagar al empleado (gross pay — retenciones).",
      },
      {
        accountCode: "2040",
        side: "credit",
        description: "CPP retenido del empleado + employer contribution, pendiente de remitir a CRA.",
      },
      {
        accountCode: "2050",
        side: "credit",
        description: "EI retenido del empleado + employer premium, pendiente de remitir a CRA.",
      },
      {
        accountCode: "2060",
        side: "credit",
        description: "Income tax federal/provincial retenido del empleado, pendiente de remitir a CRA.",
      },
      {
        accountCode: "2085",
        side: "credit",
        description: "WorkSafeBC premiums devengados del período.",
      },
    ],
  ],

  [
    "nomina.pagada",
    [
      {
        accountCode: "2080",
        side: "debit",
        description: "Liquidación del pasivo de salarios por pago de nómina al empleado.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido al empleado (net pay).",
      },
    ],
  ],

  [
    "nomina.desembolso",
    [
      {
        accountCode: "5200",
        side: "debit",
        description: "Gasto por nómina neta — desembolso al empleado (payroll_disbursement).",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido al empleado (net pay vía financial-ledger).",
      },
    ],
  ],

  [
    "vacaciones.devengadas",
    [
      {
        accountCode: "5010",
        side: "debit",
        description: "Costo laboral por vacaciones devengadas en el período (4% o 6% del gross según BC ESA).",
      },
      {
        accountCode: "2070",
        side: "credit",
        description: "Pasivo acumulado por vacaciones no tomadas.",
      },
    ],
  ],

  [
    "retenciones.remitidas",
    [
      {
        accountCode: "2040",
        side: "debit",
        description: "Remisión de CPP (empleado + empleador) a la CRA.",
      },
      {
        accountCode: "2050",
        side: "debit",
        description: "Remisión de EI (empleado + empleador) a la CRA.",
      },
      {
        accountCode: "2060",
        side: "debit",
        description: "Remisión de income tax retenido a la CRA.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido a la CRA por remesas de nómina.",
      },
    ],
  ],

  [
    "worksafebc.pagado",
    [
      {
        accountCode: "2085",
        side: "debit",
        description: "Liquidación de primas de WorkSafeBC devengadas.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido a WorkSafeBC.",
      },
    ],
  ],

  // =========================================================================
  // INVENTARIO
  // =========================================================================

  [
    "inventario.consumido",
    [
      {
        accountCode: "5030",
        side: "debit",
        description: "Consumo de suministros en servicio (inventario → gasto directo).",
      },
      {
        accountCode: "1030",
        side: "credit",
        description: "Reducción del inventario por suministros consumidos en la orden.",
      },
    ],
  ],

  [
    "inventario.comprado",
    [
      {
        accountCode: "1030",
        side: "debit",
        description: "Ingreso de suministros al inventario.",
      },
      {
        accountCode: "2025",
        side: "debit",
        description: "GST Input Tax Credit por compra de inventario (recuperable contra GST Payable).",
        computeFrom: "1030",
        rate: GST_RATE,
      },
      {
        accountCode: "2010",
        side: "credit",
        description: "Cuenta por pagar al proveedor (o efectivo si se pagó al contado).",
      },
    ],
  ],

  [
    "inventario.ajuste",
    [
      {
        accountCode: "5030",
        side: "debit",
        description: "Ajuste por merma, obsolescencia o diferencia de inventario (write-down).",
      },
      {
        accountCode: "1030",
        side: "credit",
        description: "Reducción del inventario al valor neto realizable (ASPE 3031).",
      },
    ],
  ],

  // =========================================================================
  // ACTIVOS FIJOS
  // =========================================================================

  [
    "activo.adquirido",
    [
      {
        accountCode: "1100",
        side: "debit",
        description: "Adquisición de activo fijo al costo histórico.",
      },
      {
        accountCode: "2025",
        side: "debit",
        description: "GST Input Tax Credit por compra de activo fijo.",
        computeFrom: "1100",
        rate: GST_RATE,
      },
      {
        accountCode: "2010",
        side: "credit",
        description: "Cuenta por pagar al proveedor del activo.",
      },
    ],
  ],

  [
    "depreciacion.calculada",
    [
      {
        accountCode: "7030",
        side: "debit",
        description: "Gasto por depreciación del período.",
      },
      {
        accountCode: "1110",
        side: "credit",
        description: "Depreciación acumulada — reduce el valor en libros del activo.",
      },
    ],
  ],

  [
    "activo.dispuesto",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo recibido por venta del activo (proceeds).",
      },
      {
        accountCode: "1110",
        side: "debit",
        description: "Cancelación de depreciación acumulada del activo dado de baja.",
      },
      {
        accountCode: "1100",
        side: "credit",
        description: "Retiro del activo al costo histórico.",
      },
      {
        accountCode: "7040",
        side: "credit",
        description: "Ganancia por disposición del activo (si proceeds > net book value).",
      },
    ],
  ],

  // =========================================================================
  // GASTOS OPERATIVOS
  // =========================================================================

  [
    "gasto.registrado",
    [
      {
        accountCode: "6010",
        side: "debit",
        description: "Gasto operativo genérico — la cuenta exacta la determina el caller según el tipo de gasto.",
      },
      {
        accountCode: "2025",
        side: "debit",
        description: "GST Input Tax Credit por gasto operativo (si aplica).",
        computeFrom: "6010",
        rate: GST_RATE,
      },
      {
        accountCode: "2010",
        side: "credit",
        description: "Cuenta por pagar al proveedor.",
      },
    ],
  ],

  [
    "gasto.prepagado",
    [
      {
        accountCode: "1040",
        side: "debit",
        description: "Gasto pagado por anticipado (activo — se devenga en períodos futuros).",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo pagado por adelantado.",
      },
    ],
  ],

  [
    "gasto.devengado",
    [
      {
        accountCode: "6010",
        side: "debit",
        description: "Reconocimiento del gasto del período (por ejemplo, parte proporcional del prepago).",
      },
      {
        accountCode: "1040",
        side: "credit",
        description: "Reducción del activo prepagado a medida que se consume.",
      },
    ],
  ],

  // =========================================================================
  // IMPUESTOS
  // =========================================================================

  [
    "gst.remitido",
    [
      {
        accountCode: "2020",
        side: "debit",
        description: "Liquidación del GST cobrado a clientes (neto de ITCs).",
      },
      {
        accountCode: "2025",
        side: "credit",
        description: "Aplicación de Input Tax Credits acumulados contra el GST a pagar.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido a la CRA (remesa neta de GST).",
      },
    ],
  ],

  [
    "pst.remitido",
    [
      {
        accountCode: "2030",
        side: "debit",
        description: "Liquidación del PST cobrado a clientes.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido al Ministry of Finance de BC.",
      },
    ],
  ],

  // =========================================================================
  // PATRIMONIO
  // =========================================================================

  [
    "retiro.propietario",
    [
      {
        accountCode: "3030",
        side: "debit",
        description: "Retiro del propietario — reduce el patrimonio neto.",
      },
      {
        accountCode: "1010",
        side: "credit",
        description: "Efectivo transferido al propietario.",
      },
    ],
  ],

  [
    "aporte.propietario",
    [
      {
        accountCode: "1010",
        side: "debit",
        description: "Efectivo aportado por el propietario al negocio.",
      },
      {
        accountCode: "3010",
        side: "credit",
        description: "Aumento del capital del propietario.",
      },
    ],
  ],

  // =========================================================================
  // CIERRE ANUAL
  // =========================================================================

  [
    "cierre.ingresos",
    [
      {
        accountCode: "4010",
        side: "debit",
        description: "Cierre de Service Revenue contra Retained Earnings.",
      },
      {
        accountCode: "4020",
        side: "debit",
        description: "Cierre de Upsell Revenue.",
      },
      {
        accountCode: "4030",
        side: "debit",
        description: "Cierre de Gift Card Revenue.",
      },
      {
        accountCode: "4035",
        side: "debit",
        description: "Cierre de Gift Card Breakage Revenue.",
      },
      {
        accountCode: "4040",
        side: "debit",
        description: "Cierre de Referral Revenue.",
      },
      {
        accountCode: "4050",
        side: "debit",
        description: "Cierre de Cancellation Fee Revenue.",
      },
      {
        accountCode: "4060",
        side: "debit",
        description: "Cierre de Rush Service Fee Revenue.",
      },
      {
        accountCode: "7010",
        side: "debit",
        description: "Cierre de Interest Income.",
      },
      {
        accountCode: "3020",
        side: "credit",
        description: "Ingresos netos cerrados contra Retained Earnings.",
      },
    ],
  ],

  [
    "cierre.gastos",
    [
      {
        accountCode: "3020",
        side: "debit",
        description: "Gastos netos cerrados contra Retained Earnings.",
      },
      {
        accountCode: "5010",
        side: "credit",
        description: "Cierre de Labor — Day Rate.",
      },
      {
        accountCode: "5020",
        side: "credit",
        description: "Cierre de Payroll Taxes — Employer.",
      },
      {
        accountCode: "5030",
        side: "credit",
        description: "Cierre de Supplies.",
      },
      {
        accountCode: "5040",
        side: "credit",
        description: "Cierre de Equipment (costo directo).",
      },
      {
        accountCode: "5050",
        side: "credit",
        description: "Cierre de Fuel.",
      },
      {
        accountCode: "5060",
        side: "credit",
        description: "Cierre de Uniforms.",
      },
      {
        accountCode: "5070",
        side: "credit",
        description: "Cierre de Chemical Supplies.",
      },
      {
        accountCode: "5080",
        side: "credit",
        description: "Cierre de PPE & Safety Supplies.",
      },
      {
        accountCode: "5090",
        side: "credit",
        description: "Cierre de Vehicle Maintenance.",
      },
      {
        accountCode: "5100",
        side: "credit",
        description: "Cierre de Equipment Maintenance & Repairs.",
      },
      {
        accountCode: "6010",
        side: "credit",
        description: "Cierre de Rent.",
      },
      {
        accountCode: "6020",
        side: "credit",
        description: "Cierre de Insurance.",
      },
      {
        accountCode: "6030",
        side: "credit",
        description: "Cierre de Marketing.",
      },
      {
        accountCode: "6040",
        side: "credit",
        description: "Cierre de Software.",
      },
      {
        accountCode: "6050",
        side: "credit",
        description: "Cierre de Professional Fees.",
      },
      {
        accountCode: "6060",
        side: "credit",
        description: "Cierre de Bank Fees.",
      },
      {
        accountCode: "6070",
        side: "credit",
        description: "Cierre de Office Supplies.",
      },
      {
        accountCode: "6080",
        side: "credit",
        description: "Cierre de Telephone & Internet.",
      },
      {
        accountCode: "6090",
        side: "credit",
        description: "Cierre de Travel & Meals.",
      },
      {
        accountCode: "6100",
        side: "credit",
        description: "Cierre de Training & Development.",
      },
      {
        accountCode: "6110",
        side: "credit",
        description: "Cierre de Licenses & Permits.",
      },
      {
        accountCode: "6120",
        side: "credit",
        description: "Cierre de Bad Debt Expense.",
      },
      {
        accountCode: "6130",
        side: "credit",
        description: "Cierre de Utilities.",
      },
      {
        accountCode: "6140",
        side: "credit",
        description: "Cierre de Repairs & Maintenance.",
      },
      {
        accountCode: "6150",
        side: "credit",
        description: "Cierre de Postage & Delivery.",
      },
      {
        accountCode: "7020",
        side: "credit",
        description: "Cierre de Interest Expense.",
      },
      {
        accountCode: "7030",
        side: "credit",
        description: "Cierre de Depreciation Expense.",
      },
      {
        accountCode: "7040",
        side: "credit",
        description: "Cierre de Gain/Loss on Disposal.",
      },
      {
        accountCode: "7050",
        side: "credit",
        description: "Cierre de Foreign Exchange Gain/Loss.",
      },
    ],
  ],

]);

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Obtiene las líneas de imputación contable para un tipo de evento.
 *
 * @param eventType — identificador del evento en formato `dominio.accion`
 *   (ej. "hold.capturado", "nomina.calculada", "inventario.consumido").
 * @returns Las líneas del asiento compuesto con débitos, créditos y notas
 *   de cálculo de impuestos, o `undefined` si el evento no tiene regla.
 *
 * @example
 *   const imputacion = getImputation("hold.capturado");
 *   // imputacion.debito  → "1010"
 *   // imputacion.credito → "4010,2020,2030"
 *   // imputacion.lines   → [{accountCode:"1010", side:"debit", ...}, ...]
 */
export function getImputation(eventType: string): ImputationResult | undefined {
  const lines = IMPUTATION_RULES.get(eventType);
  if (!lines) return undefined;

  const debitCodes = lines
    .filter((l) => l.side === "debit")
    .map((l) => l.accountCode)
    .join(",");
  const creditCodes = lines
    .filter((l) => l.side === "credit")
    .map((l) => l.accountCode)
    .join(",");

  return { lines, debito: debitCodes, credito: creditCodes };
}

/**
 * Lista todos los tipos de evento que tienen regla de imputación definida.
 * Útil para documentación, tests de cobertura, y validación de que un
 * evento nuevo no se olvidó de registrar.
 */
export function getDefinedEventTypes(): readonly string[] {
  return Array.from(IMPUTATION_RULES.keys()).sort();
}

/**
 * Verifica si un tipo de evento tiene regla de imputación definida.
 */
export function hasImputation(eventType: string): boolean {
  return IMPUTATION_RULES.has(eventType);
}

/**
 * Filtra las líneas de imputación para obtener solo los débitos.
 * Conveniencia cuando el caller solo necesita los códigos de débito.
 */
export function getDebitLines(eventType: string): readonly ImputationLine[] {
  const lines = IMPUTATION_RULES.get(eventType);
  if (!lines) return [];
  return lines.filter((l) => l.side === "debit");
}

/**
 * Filtra las líneas de imputación para obtener solo los créditos.
 * Conveniencia cuando el caller solo necesita los códigos de crédito.
 */
export function getCreditLines(eventType: string): readonly ImputationLine[] {
  const lines = IMPUTATION_RULES.get(eventType);
  if (!lines) return [];
  return lines.filter((l) => l.side === "credit");
}

/**
 * Total de reglas de imputación definidas.
 * Útil para asserts en tests: el número no debe bajar accidentalmente.
 */
export const IMPUTATION_TOTAL_RULES: number = IMPUTATION_RULES.size;
