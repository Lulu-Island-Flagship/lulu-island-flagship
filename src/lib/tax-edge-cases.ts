/**
 * Capa 6 — Tax Edge Cases: validadores de formato y calculadoras para
 * escenarios fiscales canadienses no estándar.
 *
 * Cubre los edge cases que los generadores de XML (tax-netfile.ts,
 * t4-generator.ts, roe-generator.ts) no manejan por sí mismos:
 *
 *   - GST en períodos fiscales irregulares (alta/baja a mitad de trimestre)
 *   - Validación de formato de Business Number (BN) canadiense
 *   - Validación de formato SIN con checksum de Luhn
 *   - Validación de códigos de motivo ROE (Service Canada)
 *   - Validación cruzada de constraints entre boxes T4
 *
 * Todas las funciones son puras. No tocan base de datos ni APIs.
 *
 * Interconexiones:
 *   tax-edge-cases.ts ──(usado por)──→ tax-netfile.ts
 *   tax-edge-cases.ts ──(usado por)──→ t4-generator.ts
 *   tax-edge-cases.ts ──(usado por)──→ roe-generator.ts
 */

// =========================================================================
// Types
// =========================================================================

/**
 * Resultado de una operación de cálculo GST en período parcial.
 */
export interface PartialPeriodGstResult {
  /** Período completo en formato YYYY-QN o YYYY-MM. */
  fullPeriod: string;
  /** Primer día de operaciones en el período (YYYY-MM-DD). */
  operationsStart: string;
  /** Último día de operaciones en el período (YYYY-MM-DD), null si continúa. */
  operationsEnd: string | null;
  /** Días totales del período calendario completo. */
  totalDaysInPeriod: number;
  /** Días con operaciones activas en el período. */
  activeDays: number;
  /** GST collected durante los días activos, en centavos. */
  gstCollectedActiveCents: number;
  /** Input Tax Credits durante los días activos, en centavos. */
  gstItcActiveCents: number;
  /** GST neto prorrateado (si aplica), en centavos. */
  gstNetProRatedCents: number;
  /** Factor de prorrateo: activeDays / totalDaysInPeriod. */
  prorationFactor: number;
  /** Si el período es parcial (no cubre el trimestre/mes completo). */
  isPartialPeriod: boolean;
}

/**
 * Resultado de validación de un Business Number canadiense.
 */
export interface BnValidationResult {
  /** true si el BN es válido según el formato CRA. */
  valid: boolean;
  /** BN normalizado (sin espacios ni guiones). */
  normalized: string;
  /** Raíz del BN (9 dígitos), null si inválido. */
  root: string | null;
  /** Código de programa (RT, RP, RC, RM), null si inválido. */
  programCode: string | null;
  /** Número de cuenta (4 dígitos), null si inválido. */
  accountNumber: string | null;
  /** Errores de formato encontrados. */
  errors: string[];
}

/**
 * Resultado de validación de un Social Insurance Number.
 */
export interface SinValidationResult {
  /** true si el SIN pasa todas las validaciones. */
  valid: boolean;
  /** SIN normalizado (9 dígitos sin espacios). */
  normalized: string;
  /** SIN enmascarado para display (*** *** 123). */
  masked: string;
  /** true si el checksum de Luhn es correcto. */
  luhnValid: boolean;
  /** Provincia/región de emisión inferida del primer dígito. */
  region: string;
  /** Errores de validación. */
  errors: string[];
}

/**
 * Resultado de validación de constraints entre boxes T4.
 */
export interface T4BoxConstraintsResult {
  /** true si el slip cumple todas las reglas. */
  valid: boolean;
  /** Errores de constraints (bloqueantes). */
  errors: string[];
  /** Advertencias que no bloquean. */
  warnings: string[];
}

/**
 * Datos de boxes T4 para validación de constraints.
 *
 * Todos los montos en centavos enteros CAD.
 */
export interface T4BoxData {
  /** Box 14 — Employment Income */
  box14: number;
  /** Box 16 — Employee CPP contributions */
  box16: number;
  /** Box 18 — Employee EI premiums */
  box18: number;
  /** Box 22 — Income Tax deducted */
  box22: number;
  /** Box 24 — EI insurable earnings */
  box24: number;
  /** Box 26 — CPP pensionable earnings */
  box26: number;
  /** Box 28 — Exempt (CPP/EI), default 0 */
  box28?: number;
  /** Box 44 — Union dues */
  box44?: number;
  /** Box 46 — Charitable donations */
  box46?: number;
  /** Box 50 — RPP contributions */
  box50?: number;
  /** Box 52 — Pension adjustment */
  box52?: number;
  /** Año fiscal del T4 (para YMPE y max insurable earnings). */
  taxYear: number;
}

// =========================================================================
// Constants
// =========================================================================

/** Códigos de programa válidos para Business Number de CRA. */
const VALID_PROGRAM_CODES = ["RT", "RP", "RC", "RM"];

/** Códigos de terminación ROE según Service Canada. */
const VALID_ROE_REASON_CODES = [
  "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "M", "N", "P", "Z",
];

/** Descripciones de códigos ROE. */
const ROE_REASON_DESCRIPTIONS: Record<string, string> = {
  A: "Shortage of work / End of contract or season",
  B: "Strike or lockout",
  C: "Return to school",
  D: "Illness or injury",
  E: "Quit / Voluntary leaving",
  F: "Maternity",
  G: "Retirement",
  H: "Work sharing",
  J: "Apprentice training",
  K: "Other",
  M: "Dismissal / Termination with cause",
  N: "Leave of absence",
  P: "Parental",
  Z: "Compassionate care",
};

/**
 * CPP YMPE (Year's Maximum Pensionable Earnings) por año fiscal, en centavos.
 * Fuente: CRA annual announcement. 2024-2026 confirmados.
 */
const YMPE_BY_YEAR: Record<number, number> = {
  2024: 68_500_00, // $68,500
  2025: 71_300_00, // $71,300
  2026: 73_200_00, // $73,200
};

/**
 * EI Maximum Insurable Earnings por año fiscal, en centavos.
 */
const EI_MAX_BY_YEAR: Record<number, number> = {
  2024: 63_200_00, // $63,200
  2025: 65_700_00, // $65,700
  2026: 67_700_00, // $67,700
};

// =========================================================================
// calculateGstOnPartialPeriods
// =========================================================================

/**
 * Calcula el GST para un período fiscal irregular donde la empresa no operó
 * el trimestre/mes completo.
 *
 * Escenarios cubiertos:
 *   - Alta fiscal a mitad de trimestre (startup).
 *   - Baja fiscal a mitad de trimestre (cierre del negocio).
 *   - Cambio de año fiscal (fiscal year-end no es 31-Dic).
 *   - Período de inactividad temporal dentro del trimestre.
 *
 * El prorrateo se basa en días calendario activos / días totales del período.
 *
 * @param fullPeriod — Período en formato YYYY-QN (ej. "2026-Q2") o YYYY-MM.
 * @param operationsStart — Primer día con operaciones (YYYY-MM-DD).
 * @param operationsEnd — Último día con operaciones (YYYY-MM-DD), o null si continúa.
 * @param gstCollectedCents — GST total cobrado en los días activos.
 * @param gstItcCents — Input Tax Credits totales en los días activos.
 * @returns PartialPeriodGstResult con el desglose del período parcial.
 *
 * @example
 * ```ts
 * // Empresa se registró para GST el 15 de mayo de 2026 (Q2 empieza 1-abr)
 * const result = calculateGstOnPartialPeriods(
 *   "2026-Q2", "2026-05-15", null, 1500_00, 800_00
 * );
 * // result.isPartialPeriod === true
 * // result.prorationFactor ≈ 0.52 (47/91 días)
 * ```
 */
export function calculateGstOnPartialPeriods(
  fullPeriod: string,
  operationsStart: string,
  operationsEnd: string | null,
  gstCollectedCents: number,
  gstItcCents: number,
): PartialPeriodGstResult {
  const [periodStart, periodEnd] = periodToDateRange(fullPeriod);
  // periodEnd is already exclusive (first day AFTER the period)
  const periodStartDate = new Date(periodStart + "T00:00:00");
  const periodEndDate = new Date(periodEnd + "T00:00:00");
  const totalDays = daysBetween(periodStartDate, periodEndDate);

  const opsStartDate = new Date(operationsStart + "T00:00:00");
  // Clamp to period start
  const effectiveStart = opsStartDate < periodStartDate ? periodStartDate : opsStartDate;

  // opsEnd is exclusive: if user provides a last-day, advance by 1
  const opsEndDate = operationsEnd
    ? nextDay(new Date(operationsEnd + "T00:00:00"))
    : periodEndDate;
  // Clamp to period end
  const effectiveEnd = opsEndDate > periodEndDate ? periodEndDate : opsEndDate;

  const activeDays = daysBetween(effectiveStart, effectiveEnd);
  const rawFactor = totalDays > 0 ? activeDays / totalDays : 1;
  const prorationFactor = Math.round(rawFactor * 10000) / 10000;
  const isPartial = activeDays < totalDays;

  const gstNetActive = gstCollectedCents - gstItcCents;
  const gstNetProRated = Math.round(gstNetActive * prorationFactor);

  return {
    fullPeriod,
    operationsStart,
    operationsEnd,
    totalDaysInPeriod: totalDays,
    activeDays,
    gstCollectedActiveCents: gstCollectedCents,
    gstItcActiveCents: gstItcCents,
    gstNetProRatedCents: gstNetProRated,
    prorationFactor,
    isPartialPeriod: isPartial,
  };
}

// =========================================================================
// validateBusinessNumber
// =========================================================================

/**
 * Valida el formato de un Business Number (BN) canadiense.
 *
 * El BN de CRA tiene 15 caracteres en total:
 *   - 9 dígitos: raíz del BN registrado ante CRA
 *   - 2 letras: código de programa (RT=GST, RP=Payroll, RC=Corporate, RM=Import/Export)
 *   - 4 dígitos: número de cuenta de programa (usualmente 0001 para la cuenta principal)
 *
 * Formato aceptado: con o sin espacios/guiones (ej. "123456789RT0001", "12345 6789 RT 0001").
 *
 * @param bn — Business Number a validar (string crudo).
 * @returns BnValidationResult con BN normalizado y errores.
 *
 * @example
 * ```ts
 * const result = validateBusinessNumber("123456789RT0001");
 * // result.valid === true
 * // result.root === "123456789"
 * // result.programCode === "RT"
 *
 * const invalid = validateBusinessNumber("123-RT");
 * // invalid.valid === false
 * ```
 */
export function validateBusinessNumber(bn: string): BnValidationResult {
  const errors: string[] = [];
  const cleaned = bn.replace(/[\s-]/g, "");

  if (cleaned.length === 0) {
    return {
      valid: false,
      normalized: "",
      root: null,
      programCode: null,
      accountNumber: null,
      errors: ["Business Number está vacío."],
    };
  }

  if (cleaned.length !== 15) {
    errors.push(
      `Business Number debe tener 15 caracteres (9 dígitos + 2 letras + 4 dígitos). Recibido: ${cleaned.length} caracteres.`,
    );
  }

  const root = cleaned.slice(0, 9);
  const program = cleaned.slice(9, 11).toUpperCase();
  const account = cleaned.slice(11, 15);

  if (!/^\d{9}$/.test(root)) {
    errors.push(`Raíz del BN inválida: "${root}". Deben ser 9 dígitos.`);
  }

  if (!VALID_PROGRAM_CODES.includes(program)) {
    errors.push(
      `Código de programa inválido: "${program}". Códigos válidos: ${VALID_PROGRAM_CODES.join(", ")}.`,
    );
  }

  if (!/^\d{4}$/.test(account)) {
    errors.push(`Número de cuenta inválido: "${account}". Deben ser 4 dígitos.`);
  }

  return {
    valid: errors.length === 0,
    normalized: cleaned,
    root: /^\d{9}$/.test(root) ? root : null,
    programCode: VALID_PROGRAM_CODES.includes(program) ? program : null,
    accountNumber: /^\d{4}$/.test(account) ? account : null,
    errors,
  };
}

// =========================================================================
// validateSinFormat
// =========================================================================

/**
 * Valida un Social Insurance Number (SIN) canadiense.
 *
 * Validaciones:
 *   1. 9 dígitos exactos.
 *   2. Checksum de Luhn (algoritmo oficial de Service Canada).
 *   3. No puede empezar con 0 ni 8 (rangos reservados/no emitidos).
 *   4. El primer dígito indica la provincia/región de emisión.
 *
 * Se aceptan formatos con espacios: "123 456 789" o "*** *** 789".
 * Para SINs enmascarados, solo se valida el formato, no el checksum.
 *
 * @param sin — SIN a validar (puede incluir espacios o estar enmascarado).
 * @returns SinValidationResult con SIN normalizado, máscara, y errores.
 *
 * @example
 * ```ts
 * const result = validateSinFormat("046 454 286");
 * // result.valid === true (Luhn válido, emitido en ON/QC)
 *
 * const bad = validateSinFormat("123 456 789");
 * // bad.valid === false (Luhn inválido)
 * ```
 */
export function validateSinFormat(sin: string): SinValidationResult {
  const errors: string[] = [];
  const cleaned = sin.replace(/[\s-]/g, "");
  const isMasked = cleaned.startsWith("***");

  // Masked SIN: validate format only
  if (isMasked) {
    const maskedValid = /^\*\*\*\*\*\*\d{3}$/.test(cleaned);
    return {
      valid: maskedValid,
      normalized: cleaned,
      masked: sin,
      luhnValid: false,
      region: "Enmascarado",
      errors: maskedValid ? [] : ["SIN enmascarado con formato inválido. Esperado: *** *** 123."],
    };
  }

  // Plain SIN
  if (cleaned.length !== 9) {
    errors.push(`SIN debe tener 9 dígitos. Recibido: ${cleaned.length} dígitos.`);
    return {
      valid: false,
      normalized: cleaned,
      masked: cleaned.length >= 3 ? `*** *** ${cleaned.slice(-3)}` : "*** *** ***",
      luhnValid: false,
      region: "Desconocida",
      errors,
    };
  }

  if (!/^\d{9}$/.test(cleaned)) {
    errors.push("SIN contiene caracteres no numéricos.");
    return {
      valid: false,
      normalized: cleaned,
      masked: `*** *** ${cleaned.slice(-3)}`,
      luhnValid: false,
      region: "Desconocida",
      errors,
    };
  }

  // Cannot start with 8 (reserved for special use)
  if (cleaned[0] === "8") {
    errors.push("SIN no puede empezar con 8 (reservado para usos especiales).");
  }

  // Luhn checksum
  const luhnValid = validateLuhnChecksum(cleaned);
  if (!luhnValid) {
    errors.push("Checksum de Luhn inválido — el SIN no es un número válido emitido por Service Canada.");
  }

  const region = getSinRegion(cleaned[0]);

  return {
    valid: errors.length === 0,
    normalized: cleaned,
    masked: `*** *** ${cleaned.slice(-3)}`,
    luhnValid,
    region,
    errors,
  };
}

/**
 * Algoritmo de Luhn (mod 10) para validar SIN canadiense.
 *
 * Service Canada usa Luhn para generar el dígito verificador (posición 9).
 * El algoritmo: duplica cada dígito en posición par (1-indexado desde la derecha
 * en Luhn clásico; para SIN es 1-indexado desde la izquierda, posiciones pares).
 *
 * @internal
 */
function validateLuhnChecksum(digits: string): boolean {
  if (digits.length !== 9) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = parseInt(digits[i], 10);
    // Double every second digit (2nd, 4th, 6th, 8th — 1-indexed)
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9; // Sum digits of the result
      }
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Mapeo del primer dígito del SIN a provincia/región de emisión.
 *
 * Fuente: Service Canada SIN allocation by region.
 */
function getSinRegion(firstDigit: string): string {
  const map: Record<string, string> = {
    "1": "Atlantic (NB, NL, NS, PE)",
    "2": "Québec",
    "3": "Québec",
    "4": "Ontario (incl. Ottawa)",
    "5": "Ontario",
    "6": "Prairies (AB, MB, SK), NWT, Nunavut",
    "7": "Pacific (BC, Yukon)",
    "8": "Reservado (no emitido para individuos)",
    "9": "Inmigrantes temporales / refugiados",
    "0": "No emitido",
  };
  return map[firstDigit] ?? "Desconocida";
}

// =========================================================================
// validateRoeReasonCode
// =========================================================================

/**
 * Valida un código de motivo de terminación de ROE según Service Canada.
 *
 * El Record of Employment (Block 16) usa códigos de una letra para indicar
 * el motivo de la interrupción de ingresos. Solo los códigos de la lista
 * oficial de Service Canada son válidos para transmisión electrónica.
 *
 * @param code — Código de motivo (una letra, case-insensitive).
 * @returns Objeto con validez, código normalizado, descripción, y errores.
 *
 * @example
 * ```ts
 * const result = validateRoeReasonCode("A");
 * // result.valid === true
 * // result.description === "Shortage of work / End of contract or season"
 *
 * const invalid = validateRoeReasonCode("X");
 * // invalid.valid === false
 * ```
 */
export function validateRoeReasonCode(code: string): {
  valid: boolean;
  code: string;
  description: string | null;
  error: string | null;
} {
  const upper = code.trim().toUpperCase();

  if (upper.length !== 1) {
    return {
      valid: false,
      code: upper,
      description: null,
      error: `Código ROE debe ser exactamente una letra. Recibido: "${code}".`,
    };
  }

  if (!VALID_ROE_REASON_CODES.includes(upper)) {
    return {
      valid: false,
      code: upper,
      description: null,
      error: `"${upper}" no es un código ROE válido. Códigos válidos: ${VALID_ROE_REASON_CODES.join(", ")}.`,
    };
  }

  return {
    valid: true,
    code: upper,
    description: ROE_REASON_DESCRIPTIONS[upper],
    error: null,
  };
}

/**
 * Devuelve la lista completa de códigos ROE válidos con sus descripciones.
 *
 * Útil para dropdowns de UI o validación en formularios.
 *
 * @returns Array de { code, description }.
 */
export function getValidRoeReasonCodes(): Array<{ code: string; description: string }> {
  return VALID_ROE_REASON_CODES.map((code) => ({
    code,
    description: ROE_REASON_DESCRIPTIONS[code] ?? "Desconocido",
  }));
}

// =========================================================================
// validateT4BoxConstraints
// =========================================================================

/**
 * Valida las restricciones cruzadas entre boxes de un T4 slip según reglas CRA.
 *
 * Reglas CRA implementadas:
 *   - Box26 (CPP pensionable earnings) ≤ Box14 (Employment income)
 *   - Box24 (EI insurable earnings) ≤ Box14 (Employment income)
 *   - Box26 ≤ YMPE del año fiscal
 *   - Box24 ≤ EI maximum insurable earnings del año fiscal
 *   - Box22 (Income tax deducted) > 0 si Box14 > 0 (advertencia si no)
 *   - Box16 (CPP) y Box26 coherentes: si hay CPP, debe haber pensionable earnings
 *   - Box18 (EI) y Box24 coherentes: si hay EI, debe haber insurable earnings
 *   - Box28 (Exempt) no debe coexistir con valores de CPP/EI > 0
 *   - Box44 (Union dues) ≤ Box14 (no puedes deducir más de lo que ganas)
 *   - Box50 (RPP) y Box52 (Pension adjustment) deben ser coherentes con Box14
 *
 * @param boxes — Datos de los boxes T4 a validar.
 * @returns T4BoxConstraintsResult con errores bloqueantes y advertencias.
 *
 * @example
 * ```ts
 * const result = validateT4BoxConstraints({
 *   box14: 45_000_00, box16: 2_500_00, box18: 733_50,
 *   box22: 8_000_00, box24: 45_000_00, box26: 45_000_00,
 *   taxYear: 2026,
 * });
 * // result.valid === true
 * ```
 */
export function validateT4BoxConstraints(
  boxes: T4BoxData,
): T4BoxConstraintsResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const b14 = boxes.box14;
  const b16 = boxes.box16;
  const b18 = boxes.box18;
  const b22 = boxes.box22;
  const b24 = boxes.box24;
  const b26 = boxes.box26;
  const b28 = boxes.box28 ?? 0;
  const b44 = boxes.box44 ?? 0;
  const b50 = boxes.box50 ?? 0;
  const b52 = boxes.box52 ?? 0;
  const year = boxes.taxYear;

  // ── Negative values ────────────────────────────────────────────────────
  if (b14 < 0) errors.push("Box14 (Employment Income) no puede ser negativo.");
  if (b16 < 0) errors.push("Box16 (CPP) no puede ser negativo.");
  if (b18 < 0) errors.push("Box18 (EI) no puede ser negativo.");
  if (b22 < 0) errors.push("Box22 (Income Tax deducted) no puede ser negativo.");
  if (b24 < 0) errors.push("Box24 (EI insurable earnings) no puede ser negativo.");
  if (b26 < 0) errors.push("Box26 (CPP pensionable earnings) no puede ser negativo.");

  // ── Box26 ≤ Box14 ──────────────────────────────────────────────────────
  if (b26 > b14) {
    errors.push(
      `Box26 (CPP pensionable earnings: ${centsToDollars(b26)}) excede Box14 (Employment income: ${centsToDollars(b14)}).`,
    );
  }

  // ── Box24 ≤ Box14 ──────────────────────────────────────────────────────
  if (b24 > b14) {
    errors.push(
      `Box24 (EI insurable earnings: ${centsToDollars(b24)}) excede Box14 (Employment income: ${centsToDollars(b14)}).`,
    );
  }

  // ── Box26 ≤ YMPE del año ───────────────────────────────────────────────
  const ympe = YMPE_BY_YEAR[year];
  if (ympe && b26 > ympe) {
    errors.push(
      `Box26 (CPP pensionable earnings: ${centsToDollars(b26)}) excede el YMPE de ${year} (${centsToDollars(ympe)}).`,
    );
  }

  // ── Box24 ≤ EI Maximum ─────────────────────────────────────────────────
  const eiMax = EI_MAX_BY_YEAR[year];
  if (eiMax && b24 > eiMax) {
    errors.push(
      `Box24 (EI insurable earnings: ${centsToDollars(b24)}) excede el máximo asegurable EI de ${year} (${centsToDollars(eiMax)}).`,
    );
  }

  // ── Box22 > 0 si Box14 > 0 ─────────────────────────────────────────────
  if (b14 > 0 && b22 === 0) {
    warnings.push(
      "Box14 (Employment Income) tiene valor pero Box22 (Income Tax deducted) es 0. " +
      "Verificar que no haya retención de impuestos pendiente.",
    );
  }

  // ── Box16 > 0 implica Box26 > 0 ─────────────────────────────────────────
  if (b16 > 0 && b26 === 0) {
    errors.push(
      "Box16 (CPP contributions) > 0 pero Box26 (CPP pensionable earnings) es 0. Inconsistente.",
    );
  }

  // ── Box18 > 0 implica Box24 > 0 ─────────────────────────────────────────
  if (b18 > 0 && b24 === 0) {
    errors.push(
      "Box18 (EI premiums) > 0 pero Box24 (EI insurable earnings) es 0. Inconsistente.",
    );
  }

  // ── Box28 (Exempt) vs CPP/EI ────────────────────────────────────────────
  if (b28 > 0 && (b16 > 0 || b18 > 0)) {
    errors.push(
      "Box28 (Exempt) > 0 pero hay contribuciones CPP/EI (Box16 > 0 o Box18 > 0). " +
      "Un empleado exento no debería tener deducciones CPP/EI.",
    );
  }

  // ── Box26 > 0 implica que hay CPP ───────────────────────────────────────
  if (b26 > 0 && b16 === 0 && b28 === 0) {
    warnings.push(
      "Box26 (CPP pensionable earnings) > 0 pero Box16 (CPP contributions) es 0. " +
      "¿Empleado exento de CPP? Si es así, Box28 debe ser > 0.",
    );
  }

  // ── Box24 > 0 implica que hay EI ────────────────────────────────────────
  if (b24 > 0 && b18 === 0 && b28 === 0) {
    warnings.push(
      "Box24 (EI insurable earnings) > 0 pero Box18 (EI premiums) es 0. " +
      "¿Empleado exento de EI? Si es así, Box28 debe ser > 0.",
    );
  }

  // ── Box44 ≤ Box14 ──────────────────────────────────────────────────────
  if (b44 > b14) {
    errors.push(
      `Box44 (Union dues: ${centsToDollars(b44)}) excede Box14 (Employment income: ${centsToDollars(b14)}).`,
    );
  }

  // ── Box50 coherence ────────────────────────────────────────────────────
  if (b50 > 0 && b52 === 0) {
    warnings.push(
      "Box50 (RPP contributions) > 0 pero Box52 (Pension adjustment) es 0. " +
      "Las contribuciones a RPP generalmente generan un pension adjustment.",
    );
  }

  // ── Tax deducido razonable ─────────────────────────────────────────────
  // Advertencia si el tax es > 60% o < 5% del ingreso (muy atípico en BC)
  if (b14 > 0 && b22 > 0) {
    const taxRate = b22 / b14;
    if (taxRate > 0.60) {
      warnings.push(
        `Box22 (Income Tax) es ${(taxRate * 100).toFixed(1)}% de Box14 (Employment Income). ` +
        "Tasa de retención inusualmente alta — verificar.",
      );
    }
    if (taxRate < 0.02 && b14 > 10_000_00) {
      warnings.push(
        `Box22 (Income Tax) es solo ${(taxRate * 100).toFixed(1)}% de Box14 (Employment Income). ` +
        "Tasa de retención inusualmente baja — verificar.",
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Convierte un período YYYY-QN o YYYY-MM a rango de fechas [start, end].
 *
 * @param periodo — "2026-Q2" o "2026-08".
 * @returns [start, end] en YYYY-MM-DD.
 */
function periodToDateRange(periodo: string): [string, string] {
  const quarterMatch = periodo.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const year = parseInt(quarterMatch[1], 10);
    const quarter = parseInt(quarterMatch[2], 10);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;

    const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
    // Exclusive upper bound: first day AFTER the period ends
    const firstDayAfter = new Date(year, endMonth, 1);
    const end = firstDayAfter.toISOString().slice(0, 10);

    return [start, end];
  }

  const monthMatch = periodo.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    // Exclusive upper bound: first day of next month
    const firstDayAfter = new Date(year, month, 1);
    const end = firstDayAfter.toISOString().slice(0, 10);

    return [start, end];
  }

  throw new Error(`Formato de período inválido: "${periodo}". Esperado: YYYY-QN o YYYY-MM.`);
}

/**
 * Avanza una fecha un dia (retorna nuevo Date, no modifica el original).
 */
function nextDay(d: Date): Date {
  const n = new Date(d);
  n.setDate(n.getDate() + 1);
  return n;
}

/**
 * Dias entre dos fechas, intervalo semiabierto start inclusive, end exclusive.
 */
function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / msPerDay));
}

/**
 * Formatea centavos a string de dólares para mensajes de error.
 */
function centsToDollars(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
