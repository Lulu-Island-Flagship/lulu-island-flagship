/**
 * v8.3 E4 (D.5 + B.2.7 + B.2.8) — Candado químico real.
 *
 * Invariante B.2.8: el código cromático de seguridad química SIEMPRE se
 * confirma con TRES señales redundantes (color + ícono + texto), nunca solo
 * color — 8% de los hombres tiene daltonismo. `CodigoCromatico.tsx` mostraba
 * la leyenda pero no exigía nada: un empleado podía marcar el checklist sin
 * haber confirmado el producto correcto. Este módulo hace la confirmación
 * OBLIGATORIA antes de que una zona del checklist se pueda tocar.
 *
 * Diseño en dos capas, igual que offline-queue.ts:
 *  - Funciones puras (este archivo): deciden si una confirmación es válida
 *    y si una zona está desbloqueada. 100% testeable sin navegador.
 *  - El componente CodigoCromatico.tsx (v8.3 fix m-1: renombrado sin acento,
 *    ver src/components/empleado/CodigoCromatico.tsx) y ChecklistCierre.tsx
 *    consumen esto para bloquear/desbloquear la UI.
 */

export type ChemicalColor = "red" | "blue" | "green" | "yellow" | "white" | "black";

export interface ChemicalCode {
  color: ChemicalColor;
  icon: string;
  textEn: string;
  textEs: string;
  zoneLabel: string;
  product: string;
  riskEn: string;
}

/**
 * Fuente única de verdad del código cromático (D.5). Si esto cambia,
 * cámbialo aquí — CodigoCromático.tsx y ChecklistCierre.tsx lo consumen
 * desde este archivo, no deben mantener su propia copia.
 */
export const CHEMICAL_CODES: ChemicalCode[] = [
  {
    color: "red",
    icon: "🚽",
    textEn: "BATHROOM — ACID",
    textEs: "BAÑO — ÁCIDO",
    zoneLabel: "Baño",
    product: "Desinfectante ácido",
    riskEn: "NEVER mix with BLUE (ammonia) — chlorine gas risk",
  },
  {
    color: "blue",
    icon: "🍳",
    textEn: "KITCHEN — AMMONIA",
    textEs: "COCINA — AMONIO",
    zoneLabel: "Cocina",
    product: "Desengrasante alcalino",
    riskEn: "NEVER mix with RED (acid) — chlorine gas risk",
  },
  {
    color: "green",
    icon: "✨",
    textEn: "NEUTRAL",
    textEs: "NEUTRO",
    zoneLabel: "Encimeras",
    product: "Limpiador neutro",
    riskEn: "Compatible with all colors",
  },
  {
    color: "yellow",
    icon: "🪵",
    textEn: "WOOD",
    textEs: "MADERA",
    zoneLabel: "Superficies / polvo",
    product: "Polish",
    riskEn: "Never on floors — slippery",
  },
  {
    color: "white",
    icon: "🪟",
    textEn: "GLASS",
    textEs: "CRISTAL",
    zoneLabel: "Ventanas",
    product: "Limpiador de vidrio",
    riskEn: "Glass only",
  },
  {
    color: "black",
    icon: "🧹",
    textEn: "FLOOR",
    textEs: "PISO",
    zoneLabel: "Suelos",
    product: "pH neutro",
    riskEn: "Never on countertops or wood",
  },
];

export function getChemicalCode(color: string): ChemicalCode | undefined {
  return CHEMICAL_CODES.find((c) => c.color === color);
}

/** Pares que NUNCA se mezclan (D.5): rojo (ácido) + azul (amonio) → gas cloro. */
const INCOMPATIBLE_PAIRS: [ChemicalColor, ChemicalColor][] = [["red", "blue"]];

export function areIncompatible(a: string, b: string): boolean {
  return INCOMPATIBLE_PAIRS.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  );
}

/**
 * Intento de confirmación. La UI debe enviar los TRES campos leídos por el
 * empleado (color, ícono, texto), nunca solo el color — así una confirmación
 * "de un solo toque sobre un botón rojo" es imposible de construir sin pasar
 * también el ícono y el texto correctos. El daltónico igual puede confirmar
 * correctamente por ícono+texto aunque perciba mal el color.
 */
export interface ChemicalConfirmationAttempt {
  targetColor: string;
  selectedColor: string;
  selectedIcon: string;
  selectedText: string;
}

export function isValidConfirmation(attempt: ChemicalConfirmationAttempt): boolean {
  const code = getChemicalCode(attempt.targetColor);
  if (!code) return false;
  return (
    attempt.selectedColor === code.color &&
    attempt.selectedIcon === code.icon &&
    (attempt.selectedText === code.textEn || attempt.selectedText === code.textEs)
  );
}

/**
 * ¿Puede el empleado interactuar con una zona del checklist de este color?
 * Solo si ya confirmó explícitamente el código químico de esa zona.
 */
export function isZoneUnlocked(
  zoneColor: string,
  confirmedColors: ReadonlySet<string>
): boolean {
  return confirmedColors.has(zoneColor);
}

export interface ApplyConfirmationResult {
  confirmedColors: Set<string>;
  ok: boolean;
  error?: string;
}

/**
 * Aplica una confirmación al set de colores confirmados. Nunca muta el set
 * de entrada (inmutable, igual que el resto de la cola offline). Si la
 * confirmación no es válida (no coincide color+ícono+texto), no desbloquea
 * nada y devuelve el motivo.
 */
export function applyConfirmation(
  confirmedColors: ReadonlySet<string>,
  attempt: ChemicalConfirmationAttempt
): ApplyConfirmationResult {
  if (!isValidConfirmation(attempt)) {
    return {
      confirmedColors: new Set(confirmedColors),
      ok: false,
      error: "La confirmación no coincide con color, ícono y texto del producto.",
    };
  }
  const next = new Set(confirmedColors);
  next.add(attempt.targetColor);
  return { confirmedColors: next, ok: true };
}

export interface HazardCheckResult {
  hazard: boolean;
  conflictingColor?: string;
}

/**
 * Poka-yoke (D.5): si el color que se está por confirmar/usar es
 * incompatible con uno ya activo (confirmado y en uso en esta jornada),
 * bloquea con alerta "GAS CLORO POTENCIAL".
 */
export function detectHazard(
  newColor: string,
  activeColors: ReadonlySet<string>
): HazardCheckResult {
  const conflicting = Array.from(activeColors).find((c) => areIncompatible(newColor, c));
  return conflicting ? { hazard: true, conflictingColor: conflicting } : { hazard: false };
}
