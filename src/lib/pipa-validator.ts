/**
 * v8.3 E10 (B.2.20, D.10.7) — Validador PIPA para contenido de marketing.
 * Función pura: NO hace red/DB, solo analiza el texto recibido. Es el paso
 * obligatorio antes de que cualquier pieza de marketing generada (blog,
 * posts de redes, copy de campaña) pueda pasar de "borrador" a "aprobado"
 * (criterio de aceptación E10: "Toda pieza de marketing generada pasa el
 * validador PIPA").
 *
 * Dos categorías de violación, ambas del spec:
 *   1. Inferencia médica (B.2.20 literal): "detectamos alérgenos" prohibido;
 *      "basado en su historial de servicio…" es el lenguaje permitido.
 *      PIPA (BC) prohíbe presentar datos operativos como diagnóstico o
 *      hallazgo de salud — eso es información médica inferida sin consentimiento
 *      clínico, no un dato de limpieza.
 *   2. Identificación de cliente específico sin consentimiento: cualquier
 *      detalle que permita identificar a una persona real (nombre completo +
 *      dirección, email, teléfono) en una pieza pública, a menos que el
 *      caller declare explícitamente `hasMarketingConsent: true` (el
 *      checkbox de consentimiento de fotos/marketing ya existe en el
 *      clickwrap de D.9 — esta función solo verifica que la bandera llegue
 *      encendida, no la vuelve a pedir).
 */

export interface PipaViolation {
  category: "medical_inference" | "client_identification";
  pattern: string;
  reason: string;
}

export interface PipaValidationResult {
  passes: boolean;
  violations: PipaViolation[];
}

export interface PipaValidationOptions {
  /** true solo si el cliente referenciado dio consentimiento explícito de marketing (checkbox D.9). */
  hasMarketingConsent?: boolean;
}

/**
 * Frases/patrones que presentan un dato operativo como hallazgo médico o
 * diagnóstico. Regex case-insensitive, con límites de palabra donde aplica
 * para evitar falsos positivos dentro de otras palabras.
 */
const MEDICAL_INFERENCE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /detectamos\s+al[eé]rgenos?/i, label: "detectamos alérgeno(s)" },
  { pattern: /detectamos?\s+(moho\s+t[oó]xico|bacterias?\s+peligrosas?)/i, label: "detectamos moho tóxico / bacterias peligrosas" },
  { pattern: /diagn[oó]stic(o|amos)/i, label: "diagnóstico / diagnosticamos" },
  { pattern: /(le|te)\s+recomendamos\s+ver\s+a\s+un\s+m[eé]dico/i, label: "recomendación médica directa" },
  { pattern: /su\s+(alergia|condici[oó]n\s+m[eé]dica|enfermedad)/i, label: "referencia a alergia/condición médica del cliente" },
  { pattern: /riesgo\s+de\s+(asma|c[aá]ncer|intoxicaci[oó]n)/i, label: "atribución de riesgo de salud específico" },
  { pattern: /esto\s+(es|puede\s+ser)\s+peligroso\s+para\s+su\s+salud/i, label: "afirmación de peligro para la salud" },
];

/**
 * Un dato identificador de una persona real: email, teléfono, o el patrón
 * "nombre completo + dirección/calle" en la misma pieza. No se buscan
 * nombres propios sueltos (imposible sin falsos positivos masivos); se
 * buscan formatos estructurados que sí identifican de forma inequívoca.
 */
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
const STREET_ADDRESS_PATTERN = /\d{1,6}\s+[a-zA-ZÀ-ÿ.\s]{2,40}\b(street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|calle|avenida)\b/i;

function detectMedicalInferences(text: string): PipaViolation[] {
  const violations: PipaViolation[] = [];
  for (const { pattern, label } of MEDICAL_INFERENCE_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({
        category: "medical_inference",
        pattern: label,
        reason:
          "Presenta un dato operativo como hallazgo/diagnóstico médico. PIPA (B.2.20): usar 'basado en su historial de servicio…', nunca inferencias médicas.",
      });
    }
  }
  return violations;
}

function detectClientIdentification(text: string, hasMarketingConsent: boolean): PipaViolation[] {
  if (hasMarketingConsent) return [];

  const violations: PipaViolation[] = [];
  if (EMAIL_PATTERN.test(text)) {
    violations.push({
      category: "client_identification",
      pattern: "email",
      reason: "Contiene un email identificable sin consentimiento de marketing registrado.",
    });
  }
  if (PHONE_PATTERN.test(text)) {
    violations.push({
      category: "client_identification",
      pattern: "teléfono",
      reason: "Contiene un número de teléfono identificable sin consentimiento de marketing registrado.",
    });
  }
  if (STREET_ADDRESS_PATTERN.test(text)) {
    violations.push({
      category: "client_identification",
      pattern: "dirección",
      reason: "Contiene una dirección identificable sin consentimiento de marketing registrado.",
    });
  }
  return violations;
}

/**
 * Valida una pieza de marketing (blog, post, copy de campaña) contra las
 * reglas PIPA del spec. `passes` es la única bandera que debe leer el flujo
 * de aprobación: si es false, la pieza NO puede pasar de borrador a aprobado.
 */
export function validateMarketingCopy(
  text: string,
  options: PipaValidationOptions = {}
): PipaValidationResult {
  const violations = [
    ...detectMedicalInferences(text),
    ...detectClientIdentification(text, options.hasMarketingConsent === true),
  ];
  return { passes: violations.length === 0, violations };
}
