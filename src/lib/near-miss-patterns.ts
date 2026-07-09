/**
 * v8.3 E7 (D.7.8) — Patrones semanales de near-misses + consecuencias tipificadas.
 * Funciones puras: no penalizan a nadie (regla explícita del spec: "reporte
 * sin penalización"), solo agregan y sugieren la acción de sistema correcta.
 */

export type NearMissCategory =
  | "near_fall"
  | "near_chemical_mix"
  | "near_bite"
  | "near_burn"
  | "other";

export interface NearMissRecord {
  id: string;
  category: NearMissCategory;
  clientPropertyId?: string | null;
  createdAt: string; // ISO
}

export interface WeeklyPattern {
  category: NearMissCategory;
  count: number;
  suggestedAction: string;
}

/**
 * Consecuencia tipificada por categoría (D.7.8). `recurrentAtSameProperty`
 * solo importa para casi-mezcla (mezcla química): la primera vez es revisión
 * del poka-yoke; si se repite en la misma propiedad, escala a re-entrenamiento.
 */
export function suggestConsequenceAction(
  category: NearMissCategory,
  recurrentAtSameProperty: boolean = false
): string {
  switch (category) {
    case "near_fall":
      return "Marcar flag de riesgo en la dirección (pre-evaluación de riesgo).";
    case "near_chemical_mix":
      return recurrentAtSameProperty
        ? "Revisar poka-yoke químico Y re-entrenamiento obligatorio (recurrente en esta propiedad)."
        : "Revisar poka-yoke químico del equipo involucrado.";
    case "near_bite":
      return "Marcar 'dueño debe estar presente' en la dirección.";
    case "near_burn":
      return "Verificar funcionamiento del timer del equipo.";
    default:
      return "Revisar caso individualmente (categoría 'otro').";
  }
}

/**
 * Agrega near-misses de una semana por categoría, con la acción sugerida.
 * No expone quién reportó (anonimato es responsabilidad de la capa de datos/API,
 * pero esta función ni siquiera recibe esa columna para reforzarlo por diseño).
 */
export function weeklyPatternSummary(
  records: NearMissRecord[],
  weekStart: string,
  weekEndExclusive: string
): WeeklyPattern[] {
  const inWeek = records.filter(
    (r) => r.createdAt >= weekStart && r.createdAt < weekEndExclusive
  );

  const byCategory = new Map<NearMissCategory, NearMissRecord[]>();
  for (const r of inWeek) {
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const propertyRecurrence = new Map<string, number>();
  for (const r of inWeek) {
    if (r.category === "near_chemical_mix" && r.clientPropertyId) {
      propertyRecurrence.set(
        r.clientPropertyId,
        (propertyRecurrence.get(r.clientPropertyId) ?? 0) + 1
      );
    }
  }
  const hasRecurrentChemicalMix = Array.from(propertyRecurrence.values()).some((n) => n > 1);

  const patterns: WeeklyPattern[] = [];
  byCategory.forEach((list, category) => {
    patterns.push({
      category,
      count: list.length,
      suggestedAction: suggestConsequenceAction(
        category,
        category === "near_chemical_mix" ? hasRecurrentChemicalMix : false
      ),
    });
  });

  // Orden estable: mayor conteo primero (los patrones más frecuentes arriba).
  patterns.sort((a, b) => b.count - a.count);
  return patterns;
}
