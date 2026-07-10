/**
 * v8.3 E9 (D.9.2) — Mapeo puro ft² → índice de banda de la tabla HHE 4×5
 * (hhe_settings.range_index, migración 034). Extraído a su propia lib para
 * poder testearlo sin tocar hhe-adjustment.ts (que ya está construido y
 * testeado — invariante de esta sesión: no se modifica lógica ya probada).
 *
 * Bandas (mismas que RANGE_LABELS en /api/admin/hhe-settings/route.ts):
 *   0: ≤ 700 ft²
 *   1: 700 – 1,500 ft²
 *   2: 1,500 – 2,500 ft²
 *   3: 2,500 – 3,500 ft²
 *   4: > 3,500 ft²
 */

export const HHE_RANGE_LABELS = [
  "≤ 700 ft²",
  "700 – 1,500 ft²",
  "1,500 – 2,500 ft²",
  "2,500 – 3,500 ft²",
  "> 3,500 ft²",
] as const;

export function sqftToRangeIndex(sqft: number): number {
  if (sqft <= 700) return 0;
  if (sqft <= 1500) return 1;
  if (sqft <= 2500) return 2;
  if (sqft <= 3500) return 3;
  return 4;
}
