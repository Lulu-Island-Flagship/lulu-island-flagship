/**
 * v8.3 E.1.5 — Time Value Calculator (Calculadora de Valor del Tiempo).
 *
 * El cliente no debe ver "$285" — debe ver "Recupere 4.5 horas de su tiempo
 * por $285." Traduce el precio del servicio a horas liberadas para el cliente,
 * con un desglose transparente colapsable: Mano de obra, Productos,
 * Seguro/Overhead, y Margen.
 *
 * Principio de diseño (del plan E.1.5): el precio no es un costo — es una
 * inversión en tiempo recuperado. El cliente que paga $70+/hora no compra
 * limpieza, compra horas de su vida de vuelta.
 *
 * Conecta con: components/cotizador/PriceBreakdown.tsx (ya existe, este
 * módulo provee los datos que ese componente renderiza).
 *
 * INVARIANTES:
 *   - NUNCA expone el costo por hora del empleado (HHE).
 *   - NUNCA expone el margen exacto en porcentaje (solo categoría "Margen").
 *   - Los porcentajes del desglose se redondean a enteros (sin decimales).
 *
 * Lógica pura: sin I/O. Los precios vienen del cotizador; este módulo solo
 * los traduce a valor de tiempo y desglose.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tiempo estimado que un hogar promedio tardaría en hacer la limpieza por
 * sí mismo (en horas). Este es el "valor de referencia" contra el que se
 * calcula el tiempo recuperado.
 *
 * Ajustable por tipo de servicio y tamaño de propiedad en el caller.
 */
export const DEFAULT_HOMEOWNER_CLEANING_HOURS = 4.5;

/**
 * Tarifa horaria implícita del tiempo del cliente (CAD/hora).
 * Representa lo que vale una hora del tiempo del cliente, basado en
 * salario mínimo de BC × factor de oportunidad. No es un dato científico —
 * es una heurística de comunicación de valor.
 *
 * BC min wage 2024: $17.40/hr. Con factor de oportunidad 3× = $52.20.
 * Redondeado a $50 para claridad.
 */
export const IMPLIED_HOURLY_VALUE_CAD = 50;

/** Peso de cada categoría en el precio total (deben sumar 1.0). */
export const COST_BREAKDOWN_WEIGHTS = {
  labor: 0.55,       // Mano de obra (salarios + cargas)
  products: 0.12,    // Productos de limpieza
  insurance: 0.15,   // Seguro + overhead operativo
  margin: 0.18,      // Margen (sostenibilidad del negocio)
} as const;

/** Nombres legibles de las categorías del desglose. */
export const BREAKDOWN_LABELS: Record<keyof typeof COST_BREAKDOWN_WEIGHTS, string> = {
  labor: "Mano de obra",
  products: "Productos",
  insurance: "Seguro y operación",
  margin: "Margen",
};

/** Descripciones de cada categoría para el tooltip colapsable. */
export const BREAKDOWN_DESCRIPTIONS: Record<keyof typeof COST_BREAKDOWN_WEIGHTS, string> = {
  labor: "Salarios justos, cargas sociales, WorkSafeBC y beneficios del equipo de limpieza.",
  products: "Productos de limpieza profesionales, hipoalergénicos y seguros para mascotas.",
  insurance: "Seguro de responsabilidad civil, vehículos, equipo, y costos operativos.",
  margin: "Margen operativo que mantiene el negocio sostenible y nos permite garantizar el servicio.",
};

/** Íconos para cada categoría (uso en UI). */
export const BREAKDOWN_ICONS: Record<keyof typeof COST_BREAKDOWN_WEIGHTS, string> = {
  labor: "👥",
  products: "🧴",
  insurance: "🛡️",
  margin: "📊",
};

// ═══════════════════════════════════════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const CostBreakdownItemSchema = z.object({
  category: z.enum(["labor", "products", "insurance", "margin"]),
  label: z.string().min(1),
  description: z.string().min(1),
  icon: z.string(),
  amountCAD: z.number().min(0),
  percentage: z.number().int().min(0).max(100),
});

export const TimeValueResultSchema = z.object({
  /** Precio total del servicio en CAD. */
  totalPriceCAD: z.number().min(0),
  /** Horas de tiempo del cliente recuperadas. */
  hoursRecovered: z.number().min(0),
  /** Valor monetario del tiempo recuperado (horas × implied hourly value). */
  timeValueCAD: z.number().min(0),
  /** Mensaje principal: "Recupere X horas de su tiempo por $Y". */
  headlineMessage: z.string().min(1),
  /** Desglose del precio en las 4 categorías. */
  breakdown: z.array(CostBreakdownItemSchema).length(4),
  /** ¿El desglose está completo? (validación: los 4 ítems suman ~100%). */
  breakdownComplete: z.boolean(),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DERIVADOS
// ═══════════════════════════════════════════════════════════════════════════

export type CostBreakdownItem = z.infer<typeof CostBreakdownItemSchema>;
export type TimeValueResult = z.infer<typeof TimeValueResultSchema>;
export type BreakdownCategory = keyof typeof COST_BREAKDOWN_WEIGHTS;

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO DE HORAS RECUPERADAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula las horas de tiempo del cliente que el servicio recupera.
 *
 * Fórmula base: cada $IMPLIED_HOURLY_VALUE_CAD del precio total = 1 hora
 * recuperada. El tiempo base (homeownerCleaningHours) establece el piso —
 * incluso un servicio pequeño "recupera" al menos el tiempo que el cliente
 * habría pasado limpiando.
 *
 * Ejemplo: servicio de $285 con implied value de $50/hr = 5.7 horas.
 * Si el homeownerCleaningHours es 4.5, se muestra el mayor de ambos.
 *
 * @param totalPriceCAD Precio total del servicio en dólares canadienses.
 * @param homeownerCleaningHours Horas estimadas que el cliente tardaría
 *   limpiando por sí mismo (default 4.5).
 */
export function calculateHoursRecovered(
  totalPriceCAD: number,
  homeownerCleaningHours: number = DEFAULT_HOMEOWNER_CLEANING_HOURS
): number {
  const timeValueHours = totalPriceCAD / IMPLIED_HOURLY_VALUE_CAD;
  // El cliente siempre recupera al menos el tiempo base de limpieza
  // (incluso servicios pequeños), y gana más con servicios más completos.
  const recovered = Math.max(homeownerCleaningHours, timeValueHours);
  return Math.round(recovered * 10) / 10;
}

/**
 * Calcula el valor monetario del tiempo recuperado.
 * horas × valor implícito por hora.
 */
export function calculateTimeValueCAD(hoursRecovered: number): number {
  return Math.round(hoursRecovered * IMPLIED_HOURLY_VALUE_CAD);
}

// ═══════════════════════════════════════════════════════════════════════════
// DESGLOSE DEL PRECIO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula el desglose del precio en las 4 categorías (labor, products,
 * insurance, margin) usando los pesos definidos en COST_BREAKDOWN_WEIGHTS.
 *
 * Los montos se redondean a 2 decimales. Los porcentajes se redondean a
 * enteros para simplicidad visual. Si los porcentajes no suman exactamente
 * 100 por redondeo, se ajusta la categoría de mayor peso.
 */
export function calculatePriceBreakdown(totalPriceCAD: number): CostBreakdownItem[] {
  const categories = Object.keys(COST_BREAKDOWN_WEIGHTS) as BreakdownCategory[];
  const items: CostBreakdownItem[] = [];

  let totalRounded = 0;

  for (const cat of categories) {
    const weight = COST_BREAKDOWN_WEIGHTS[cat];
    const amount = Math.round(totalPriceCAD * weight * 100) / 100;
    const percentage = Math.round(weight * 100);

    items.push({
      category: cat,
      label: BREAKDOWN_LABELS[cat],
      description: BREAKDOWN_DESCRIPTIONS[cat],
      icon: BREAKDOWN_ICONS[cat],
      amountCAD: amount,
      percentage,
    });

    totalRounded += amount;
  }

  // Ajuste de redondeo: si la suma de los 4 montos no cuadra con el total,
  // ajustar la categoría de mayor peso (labor) para que cuadre.
  const diff = Math.round((totalPriceCAD - totalRounded) * 100) / 100;
  if (Math.abs(diff) > 0.001) {
    const laborItem = items[0]; // labor siempre es el primero
    laborItem.amountCAD = Math.round((laborItem.amountCAD + diff) * 100) / 100;
  }

  return items;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DEL RESULTADO COMPLETO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye el resultado completo de la calculadora de valor del tiempo.
 * Esta es LA función que el componente PriceBreakdown.tsx llama para obtener
 * los datos que renderiza.
 *
 * @param totalPriceCAD Precio total del servicio en CAD.
 * @param homeownerCleaningHours Horas estimadas de limpieza DIY (opcional).
 * @returns TimeValueResult con headline, horas recuperadas, desglose y
 *   validación de completitud.
 */
export function buildTimeValueResult(
  totalPriceCAD: number,
  homeownerCleaningHours?: number
): TimeValueResult {
  const hoursRecovered = calculateHoursRecovered(totalPriceCAD, homeownerCleaningHours);
  const timeValueCAD = calculateTimeValueCAD(hoursRecovered);
  const breakdown = calculatePriceBreakdown(totalPriceCAD);

  // Validar que los porcentajes sumen aproximadamente 100
  const totalPercentage = breakdown.reduce((sum, item) => sum + item.percentage, 0);
  const breakdownComplete = totalPercentage >= 98 && totalPercentage <= 102;

  const headlineMessage = `Recupere ${hoursRecovered} hora${hoursRecovered !== 1 ? "s" : ""} de su tiempo por $${totalPriceCAD.toFixed(0)}`;

  return {
    totalPriceCAD,
    hoursRecovered,
    timeValueCAD,
    headlineMessage,
    breakdown,
    breakdownComplete,
  };
}

/**
 * Genera un mensaje de comparación para reforzar el valor:
 * "Hacerlo usted mismo le tomaría ~4.5 horas. Nuestro equipo lo hace en ~2 horas
 * mientras usted recupera ese tiempo para lo que realmente importa."
 */
export function buildComparisonMessage(
  hoursRecovered: number,
  homeownerCleaningHours: number = DEFAULT_HOMEOWNER_CLEANING_HOURS
): string {
  return `Hacerlo usted mismo le tomaría ~${homeownerCleaningHours} horas. ` +
    `Al delegarlo, recupera ${hoursRecovered} horas para lo que realmente importa.`;
}

/**
 * Genera la pregunta de cierre para el cotizador, justo debajo del desglose:
 * "¿Qué haría con ${horas} horas extra este mes?"
 */
export function buildClosingQuestion(hoursRecovered: number): string {
  const examples = [
    "pasar tiempo con su familia",
    "avanzar en ese proyecto pendiente",
    "disfrutar Richmond sin preocupaciones",
    "descansar — que también es productivo",
  ];
  const example = examples[Math.floor(hoursRecovered) % examples.length];
  return `¿Qué haría con ${hoursRecovered} horas extra? Como ${example}.`;
}

/**
 * Valida que el resultado cumpla con el schema Zod y las reglas de negocio.
 */
export function validateTimeValueResult(
  raw: unknown
): { valid: true; data: TimeValueResult } | { valid: false; error: string } {
  const result = TimeValueResultSchema.safeParse(raw);
  if (!result.success) {
    return { valid: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }

  // Verificar que el headline contenga el precio
  if (!result.data.headlineMessage.includes(`$${result.data.totalPriceCAD.toFixed(0)}`)) {
    return { valid: false, error: "headlineMessage must include the total price" };
  }

  return { valid: true, data: result.data };
}
