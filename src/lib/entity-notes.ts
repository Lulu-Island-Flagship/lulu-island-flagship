/**
 * v8.3 C.3 / E11.2 — Backup de conocimiento operativo: notas ligadas a
 * entidades, sugeridas por contexto ("asignar Equipo María → 'no con
 * Pedro'"; "llegar a 123 Main St → 'escaleras empinadas'").
 *
 * La tabla `entity_notes` (migración 050) y su RLS ya existían desde antes
 * de esta sesión pero NADA la usaba: ningún API route, ninguna UI. Este
 * archivo es la lógica pura de "¿qué notas debo sugerir aquí?" — el mismo
 * patrón de huérfano-detectado-y-conectado que daily_checkins (E8) y
 * get_team_top3 (E8).
 */

export type EntityType = "employee" | "client_property" | "client_profile" | "vehicle";

export interface EntityNote {
  id: string;
  entityType: EntityType;
  entityId: string;
  note: string;
  suggestContext: string[];
}

/**
 * Filtra las notas de una entidad que aplican a un contexto dado (ej:
 * "dispatch", "quote", "checkin"). Una nota sin contexto declarado
 * (suggestContext vacío) nunca se sugiere automáticamente -- solo aparece
 * en la vista completa de la entidad, para evitar ruido en flujos
 * operativos donde el admin no la pidió.
 */
export function suggestNotesForContext(notes: EntityNote[], context: string): EntityNote[] {
  return notes.filter((n) => n.suggestContext.includes(context));
}

/** Agrupa notas por entidad (entityType:entityId) — útil para precargar sugerencias de un lote (ej: toda la orden del día). */
export function groupNotesByEntity(notes: EntityNote[]): Map<string, EntityNote[]> {
  const map = new Map<string, EntityNote[]>();
  for (const n of notes) {
    const key = `${n.entityType}:${n.entityId}`;
    const existing = map.get(key) || [];
    existing.push(n);
    map.set(key, existing);
  }
  return map;
}

export const KNOWN_SUGGEST_CONTEXTS = ["dispatch", "quote", "checkin", "servicio"] as const;
export type KnownSuggestContext = (typeof KNOWN_SUGGEST_CONTEXTS)[number];
