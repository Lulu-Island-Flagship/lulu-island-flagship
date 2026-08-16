// ─── Dinero exacto — unidades enteras mínimas (ext-financial) ──────────────
// Núcleo v5.0: el dinero se representa en CENTAVOS ENTEROS como `bigint`.
// Nunca se multiplica ni redondea con floats para aritmética monetaria.
//
// La conversión dólares→centavos es EXACTA: parsea la representación decimal
// (string) o el decimal más corto de un `number`, y redondea medio-arriba en
// el tercer decimal. Esto evita el clásico `Math.round(amount * 100)`, que
// pierde precisión por punto flotante (ej. 19.99 * 100 ≈ 1998.9999...).

/** Centavos enteros — la unidad mínima canónica de dinero en este repo. */
export type Cents = bigint;

// Tasas fiscales de BC como RACIONALES ENTEROS (numerador/denominador),
// para que el cálculo de impuestos sea aritmética entera exacta — nunca
// multiplicar centavos por 0.05 / 0.07 (floats).
export const GST_RATE_NUMERATOR = 5n;
export const GST_RATE_DENOMINATOR = 100n;
export const PST_RATE_NUMERATOR = 7n;
export const PST_RATE_DENOMINATOR = 100n;

/**
 * División entera con redondeo medio-arriba (round half up) para magnitudes
 * no negativas: round(num / den) al entero más cercano, .5 hacia arriba.
 */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error(`roundHalfUp: denominador inválido ${den}`);
  if (num < 0n) {
    throw new Error(`roundHalfUp: solo admite magnitudes no negativas (recibido ${num})`);
  }
  return (num + den / 2n) / den;
}

/**
 * Convierte una cadena decimal de dólares (ej. "19.99", "0.1", "-3.50") a
 * centavos enteros `bigint`, redondeando medio-arriba en el tercer decimal.
 */
export function parseDollarsToCents(value: string): bigint {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Monto inválido: ${JSON.stringify(value)}`);
  }
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracRaw = ""] = unsigned.split(".");

  // Conservamos 3 decimales: el tercero decide el redondeo medio-arriba.
  const frac = (fracRaw + "000").slice(0, 3);
  const thirdDigit = frac.charCodeAt(2) - 48; // 0..9
  const firstTwoCents = BigInt(frac.slice(0, 2) || "0");
  let cents = BigInt(intPart) * 100n + firstTwoCents;
  if (thirdDigit >= 5) cents += 1n;

  return negative ? -cents : cents;
}

/**
 * Convierte dólares (string o number) a centavos enteros `bigint` de forma
 * exacta. Para `number`, usa su representación decimal más corta
 * (`Number.prototype.toString`), que es la lectura decimal que el emisor
 * quiso expresar — no la aproximación binaria amplificada por `* 100`.
 */
export function dollarsToCentsExact(value: string | number): bigint {
  const decimal = typeof value === "number" ? numberToDecimalString(value) : value;
  return parseDollarsToCents(decimal);
}

function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Monto inválido: ${value}`);
  }
  return value.toString();
}

/** Centavos → dólares como `number` (límite de display/persistencia NUMERIC). */
export function centsToDollarsNumber(cents: Cents | number): number {
  return Number(cents) / 100;
}

/** Centavos → cadena decimal exacta "0.00" (sin pérdida, para logging/reportes). */
export function centsToDollarsString(cents: Cents | number): string {
  const c = BigInt(cents);
  const negative = c < 0n;
  const abs = negative ? -c : c;
  const intPart = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${intPart}.${frac}`;
}

/** GST (5%) sobre una base en centavos, con redondeo medio-arriba exacto. */
export function gstFromBaseCents(baseCents: Cents): bigint {
  return roundHalfUp(baseCents * GST_RATE_NUMERATOR, GST_RATE_DENOMINATOR);
}

/** PST (7%) sobre una base en centavos, con redondeo medio-arriba exacto. */
export function pstFromBaseCents(baseCents: Cents): bigint {
  return roundHalfUp(baseCents * PST_RATE_NUMERATOR, PST_RATE_DENOMINATOR);
}

/**
 * Multiplica centavos por un porcentaje decimal (ej. 2.9 → 2.9%) con
 * redondeo medio-arriba EXACTO: el porcentaje se convierte a racional
 * entero (2.9% = 29/1000) y la división usa roundHalfUp. Sustituye a
 * `Math.round(cents * (pct / 100))` y `Math.round(cents * 0.029)`.
 */
export function applyPercentRoundHalfUp(baseCents: Cents, percent: number): bigint {
  const { num, den } = percentToRational(percent);
  return roundHalfUp(baseCents * num, den);
}

/** Convierte un decimal (number) a racional entero: 1.5 → 15/10, 0.0205 → 205/10000. */
export function decimalToRational(value: number): { num: bigint; den: bigint } {
  if (!Number.isFinite(value)) {
    throw new Error(`Decimal inválido: ${value}`);
  }
  const s = value.toString(); // decimal más corto (round-trip)
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const digits = (intPart || "0") + fracPart || "0";
  return {
    num: BigInt(digits) * (negative ? -1n : 1n),
    den: 10n ** BigInt(fracPart.length),
  };
}

/** Convierte un porcentaje decimal (number) a racional entero (ej. 2.9 → 29/1000). */
function percentToRational(percent: number): { num: bigint; den: bigint } {
  const { num, den } = decimalToRational(percent);
  return { num, den: den * 100n };
}
