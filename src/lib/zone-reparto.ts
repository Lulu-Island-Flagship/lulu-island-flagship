/**
 * v8.3 E4 (D.7) — Reparto de zonas del checklist entre los N operarios de un
 * equipo, usando el peso/dificultad de cada zona.
 *
 * Regla exacta del plan (D.7):
 *   "Reparto según N: sumar pesos ÷ N, balancear. Regla dura: nunca Cocina +
 *   Baño a la misma persona si N≥2."
 * Criterio de aceptación E4:
 *   "Con N=2, ninguna asignación pone Cocina + Baño en la misma persona
 *   (property test)."
 *
 * Antes de este módulo, `zone_weight` no existía en ningún lado del repo
 * (ni columna, ni formulario del editor, ni tipo) — se agrega en la
 * migración 104. El peso NO determina el tamaño N del equipo (eso sigue
 * siendo HHE vía pricing.ts/calculateTeamRequirements, D.4) — determina
 * cómo se reparten las zonas entre los N operarios ya asignados por
 * dispatch-team.ts. Por eso vive junto a dispatch-team.ts y no en pricing.ts.
 *
 * Función pura, 100% testeable, mismo estilo que dispatch-team.ts.
 */

export interface ZoneWeight {
  /** Código de zona, ej. "kitchen", "bathroom" (columna sop_checklists.zone). */
  zone: string;
  weight: number;
}

export interface OperatorAssignment {
  operatorIndex: number;
  zones: string[];
  totalWeight: number;
}

const KITCHEN_ZONE = "kitchen";
const BATHROOM_ZONE = "bathroom";

/**
 * Reparte las zonas entre `operatorCount` operarios balanceando por peso:
 * algoritmo greedy que siempre asigna la zona más pesada restante al
 * operario con menor carga acumulada. Regla dura D.7: si N>=2, Cocina y
 * Baño nunca terminan en el mismo operario — si el candidato de menor carga
 * ya tiene la zona incompatible, se busca el siguiente candidato disponible.
 */
export function assignZonesToOperators(
  zoneWeights: ZoneWeight[],
  operatorCount: number
): OperatorAssignment[] {
  if (operatorCount <= 0) return [];

  const operators: OperatorAssignment[] = Array.from({ length: operatorCount }, (_, i) => ({
    operatorIndex: i,
    zones: [],
    totalWeight: 0,
  }));

  const sorted = [...zoneWeights].sort((a, b) => b.weight - a.weight);

  for (const zw of sorted) {
    const candidates = [...operators].sort((a, b) => a.totalWeight - b.totalWeight);

    let chosen = candidates[0];

    if (operatorCount >= 2 && zw.zone === BATHROOM_ZONE) {
      const withoutKitchen = candidates.find((op) => !op.zones.includes(KITCHEN_ZONE));
      if (withoutKitchen) chosen = withoutKitchen;
    } else if (operatorCount >= 2 && zw.zone === KITCHEN_ZONE) {
      const withoutBathroom = candidates.find((op) => !op.zones.includes(BATHROOM_ZONE));
      if (withoutBathroom) chosen = withoutBathroom;
    }

    chosen.zones.push(zw.zone);
    chosen.totalWeight += zw.weight;
  }

  return operators;
}

/** true si alguna asignación resultante viola la regla dura Cocina+Baño con N>=2 (para tests/QA). */
export function violatesKitchenBathroomRule(assignments: OperatorAssignment[]): boolean {
  if (assignments.length < 2) return false;
  return assignments.some(
    (op) => op.zones.includes(KITCHEN_ZONE) && op.zones.includes(BATHROOM_ZONE)
  );
}
