/**
 * v8.3 E10 (B.2.24, B.2.25) — Reglas de coherencia de posicionamiento premium.
 * Función pura: valida que un texto de marketing no prometa algo que la app
 * no cumple todavía, y que el tono nunca sea "barato/descuento/oferta".
 *
 * B.2.25 (regla dura, criterio de aceptación E10 explícito): "El sitio NO
 * muestra 'asegurados/bonded' mientras el flag de pólizas esté apagado."
 * Sigue el mismo patrón fail-closed de feature-flags.ts: si no se puede
 * confirmar que el flag está activo, se trata como apagado (bloquea el claim).
 *
 * B.2.24: tono "inversión, cuidado, tranquilidad", nunca "barato/descuento/
 * oferta". Los descuentos se comunican como beneficios de relación, no como
 * rebaja de precio.
 */

export interface PositioningViolation {
  category: "unsubstantiated_bonded_claim" | "discount_tone";
  pattern: string;
  reason: string;
}

export interface PositioningValidationResult {
  passes: boolean;
  violations: PositioningViolation[];
}

export interface PositioningValidationOptions {
  /**
   * Debe venir de isPublicInsuredClaimReady() (src/lib/business-insurance.ts)
   * u otra función que valide vigencia REAL de las 3 pólizas requeridas —
   * nunca de un flag manual desconectado de las fechas de vencimiento, y
   * nunca asumir true por default.
   */
  bondedPolicyFlagActive: boolean;
}

const BONDED_CLAIM_PATTERN = /\b(asegurad[oa]s?|bonded|bonding|insured|insurance)\b/i;

const DISCOUNT_TONE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bbarat[oa]s?\b/i, label: "barato/a(s)" },
  { pattern: /\bdescuentos?\b/i, label: "descuento(s)" },
  { pattern: /\boferta[s]?\b/i, label: "oferta(s)" },
  { pattern: /\b(promo|promoci[oó]n(es)?)\b/i, label: "promo/promoción" },
  { pattern: /\bliquidaci[oó]n\b/i, label: "liquidación" },
  { pattern: /\bprecio\s+m[aá]s\s+bajo\b/i, label: "precio más bajo" },
];

/**
 * B.2.25: bloquea "asegurados/bonded" mientras el flag de pólizas esté
 * apagado. Fail-closed: `bondedPolicyFlagActive` debe llegar ya resuelto
 * (true solo si isFlagEnabled confirmó activo); cualquier duda = bloqueado.
 */
function detectUnsubstantiatedBondedClaim(
  text: string,
  bondedPolicyFlagActive: boolean
): PositioningViolation[] {
  if (bondedPolicyFlagActive) return [];
  if (!BONDED_CLAIM_PATTERN.test(text)) return [];
  return [
    {
      category: "unsubstantiated_bonded_claim",
      pattern: "asegurados / bonded / insured",
      reason:
        "B.2.25: prohibido publicar 'asegurados/bonded' hasta que las pólizas reales estén contratadas y el flag de pólizas esté activo.",
    },
  ];
}

/**
 * B.2.24: nunca "barato/descuento/oferta". Los descuentos reales se
 * comunican como beneficio de relación (ej. "programa de regalos por
 * lealtad"), nunca como rebaja de precio directa.
 */
function detectDiscountTone(text: string): PositioningViolation[] {
  const violations: PositioningViolation[] = [];
  for (const { pattern, label } of DISCOUNT_TONE_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({
        category: "discount_tone",
        pattern: label,
        reason:
          "B.2.24: posicionamiento premium exige tono 'inversión, cuidado, tranquilidad'; nunca 'barato/descuento/oferta'. Los descuentos se comunican como beneficio de relación.",
      });
    }
  }
  return violations;
}

export function validatePositioningCoherence(
  text: string,
  options: PositioningValidationOptions
): PositioningValidationResult {
  const violations = [
    ...detectUnsubstantiatedBondedClaim(text, options.bondedPolicyFlagActive),
    ...detectDiscountTone(text),
  ];
  return { passes: violations.length === 0, violations };
}
