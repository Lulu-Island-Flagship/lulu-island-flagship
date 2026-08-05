/**
 * v8.3 F.1 — Auto-Evaluación Post-Jornada.
 *
 * Al cerrar jornada en PWA, el empleado (típicamente el líder del equipo)
 * responde 3 preguntas. Los resultados alimentan tres módulos existentes:
 *
 *   1. ¿Tuviste todos los insumos necesarios? (Sí/No)
 *      → inventory-reorder.ts: si responde "No", es una señal temprana de
 *        que el stock real no alcanzó para los servicios del día —
 *        complementa el chequeo de umbral fijo de needsReorder() con una
 *        señal de campo en tiempo real.
 *
 *   2. ¿Algo inesperado en la propiedad? (texto libre, máximo 280 chars)
 *      → property-risk.ts: el caller (ruta API) debe evaluar si el texto
 *        contiene palabras clave de riesgo (moho, escalera rota, perro
 *        suelto, etc.) y, de ser así, insertar o actualizar un flag en
 *        property_risk_flags para esa dirección.
 *
 *   3. ¿Cómo te sentiste físicamente? (😊 | 😐 | 😫)
 *      → wellbeing.ts: el mood reportado aquí se suma al agregado diario
 *        de ánimo del equipo (TeamMoodDay), alimentando
 *        shouldSuggestTeamCheckin() y la regla de riesgo químico
 *        (shouldTriggerChemicalWellbeingAlert).
 *
 * Funciones puras: validan, transforman, y producen el objeto listo para
 * insertar. El caller (ruta API) hace el INSERT en post_shift_evals y
 * dispara los efectos colaterales (alertas de inventario, flags de riesgo,
 * actualización de mood agregado).
 *
 * Privacidad: este módulo solo expone el contrato de datos de la
 * auto-evaluación. Nunca expone evaluaciones de otros empleados ni
 * permite consultas cross-employee — el caller debe filtrar por
 * empleado_id autenticado.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Nivel de bienestar físico reportado (emoji en PWA). */
export type PhysicalMood = "happy" | "neutral" | "sad";

/** Las tres preguntas de la auto-evaluación post-jornada. */
export interface PostShiftAnswers {
  /** ¿Tuviste todos los insumos necesarios para completar los servicios? */
  hadSufficientSupplies: boolean;
  /** ¿Algo inesperado en la(s) propiedad(es)? Máximo 280 caracteres. */
  unexpectedPropertyIssue: string | null;
  /** ¿Cómo te sentiste físicamente durante la jornada? */
  physicalMood: PhysicalMood;
}

/** Registro completo de una auto-evaluación, listo para INSERT en `post_shift_evals`. */
export interface PostShiftEvalRecord {
  employee_id: string;
  shift_date: string; // YYYY-MM-DD
  had_sufficient_supplies: boolean;
  unexpected_property_issue: string | null;
  physical_mood: PhysicalMood;
  submitted_at_iso: string;
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Longitud máxima del campo "algo inesperado". */
export const MAX_UNEXPECTED_ISSUE_LENGTH = 280;

/** Palabras clave de riesgo que, si aparecen en unexpectedPropertyIssue,
 *  ameritan la creación de un property_risk_flag. */
export const RISK_KEYWORDS: readonly string[] = [
  "moho", "mold",
  "escalera rota", "broken stairs",
  "perro suelto", "loose dog", "aggressive dog",
  "lockbox", "llave",
  "confined", "confinado",
  "water damage", "daño por agua",
  "piso resbaloso", "slippery floor",
  "cable suelto", "loose wire",
  "vidrio roto", "broken glass",
  "plaga", "pest", "infestation",
] as const;

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Valida que las respuestas de la auto-evaluación cumplan las reglas de
 * negocio antes de insertar. Retorna un array de mensajes de error; si está
 * vacío, la evaluación es válida.
 *
 * Reglas:
 * - physicalMood debe ser uno de los tres valores válidos.
 * - unexpectedPropertyIssue, si se provee, no debe exceder
 *   MAX_UNEXPECTED_ISSUE_LENGTH chars.
 */
export function validatePostShiftAnswers(answers: PostShiftAnswers): string[] {
  const errors: string[] = [];

  const validMoods: PhysicalMood[] = ["happy", "neutral", "sad"];
  if (!validMoods.includes(answers.physicalMood)) {
    errors.push(
      `physicalMood debe ser "happy", "neutral" o "sad". Recibido: "${answers.physicalMood}".`
    );
  }

  if (
    answers.unexpectedPropertyIssue !== null &&
    answers.unexpectedPropertyIssue.length > MAX_UNEXPECTED_ISSUE_LENGTH
  ) {
    errors.push(
      `unexpectedPropertyIssue no debe exceder ${MAX_UNEXPECTED_ISSUE_LENGTH} caracteres. ` +
        `Recibido: ${answers.unexpectedPropertyIssue.length}.`
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Construcción del registro
// ---------------------------------------------------------------------------

/**
 * Construye el registro PostShiftEvalRecord listo para INSERT en
 * `post_shift_evals`. Valida antes de construir — lanza si hay errores.
 *
 * @param employeeId - ID del empleado autenticado que responde.
 * @param shiftDate - Fecha de la jornada (YYYY-MM-DD).
 * @param answers - Las tres respuestas.
 * @param submittedAtIso - Timestamp ISO del momento de envío.
 */
export function buildPostShiftEvalRecord(
  employeeId: string,
  shiftDate: string,
  answers: PostShiftAnswers,
  submittedAtIso: string
): PostShiftEvalRecord {
  const errors = validatePostShiftAnswers(answers);
  if (errors.length > 0) {
    throw new Error(`Invalid post-shift eval: ${errors.join("; ")}`);
  }

  return {
    employee_id: employeeId,
    shift_date: shiftDate,
    had_sufficient_supplies: answers.hadSufficientSupplies,
    unexpected_property_issue: answers.unexpectedPropertyIssue,
    physical_mood: answers.physicalMood,
    submitted_at_iso: submittedAtIso,
  };
}

// ---------------------------------------------------------------------------
// Señales para otros módulos
// ---------------------------------------------------------------------------

/**
 * ¿La evaluación indica un posible problema de inventario?
 * True cuando el empleado reporta que NO tuvo insumos suficientes.
 *
 * El caller debe usar esta señal para disparar una verificación temprana
 * de inventory-reorder.ts (computeReorderSuggestions) sin esperar al job
 * nocturno de umbral fijo.
 */
export function hasInventorySignal(answers: PostShiftAnswers): boolean {
  return !answers.hadSufficientSupplies;
}

/**
 * Escanea el texto de "algo inesperado" contra las RISK_KEYWORDS.
 * Retorna las palabras clave detectadas (vacío si ninguna).
 *
 * El caller debe evaluar si insertar/actualizar property_risk_flags para
 * la dirección asociada al servicio de ese día, usando
 * evaluatePropertyRisk() de property-risk.ts.
 */
export function detectRiskKeywords(issueText: string | null): string[] {
  if (!issueText) return [];
  const lower = issueText.toLowerCase();
  return RISK_KEYWORDS.filter((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Traduce el mood físico a la escala que espera wellbeing.ts
 * ("happy" | "neutral" | "sad"), idéntica — este mapping es 1:1 hoy pero
 * existe como función explícita para que, si wellbeing.ts llegara a
 * cambiar su escala, solo se ajuste aquí.
 */
export function toWellbeingMood(mood: PhysicalMood): "happy" | "neutral" | "sad" {
  return mood;
}

// ---------------------------------------------------------------------------
// Agregación de ánimo (alimenta wellbeing.ts TeamMoodDay)
// ---------------------------------------------------------------------------

export interface MoodAggregationInput {
  /** Fecha de la jornada (YYYY-MM-DD). */
  shiftDate: string;
  /** Ánimo reportado. */
  physicalMood: PhysicalMood;
}

/**
 * Agrega evaluaciones individuales en un TeamMoodDay para una fecha dada.
 * Nunca expone quién reportó qué — solo conteos agregados.
 *
 * @param evals - Evaluaciones de una misma fecha (ya filtradas por el caller).
 */
export function aggregateMoodForDate(
  evals: MoodAggregationInput[]
): { date: string; neutralOrSadCount: number; totalCount: number } {
  const neutralOrSadCount = evals.filter(
    (e) => e.physicalMood === "neutral" || e.physicalMood === "sad"
  ).length;
  return {
    date: evals[0]?.shiftDate ?? "",
    neutralOrSadCount,
    totalCount: evals.length,
  };
}
