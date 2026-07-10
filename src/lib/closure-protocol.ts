/**
 * v8.3 E4.11 — Protocolo de Cierre Externo.
 *
 * Del plan: "COMPLETADO requiere (1) checklist 100% verde, (2) ≥1 foto
 * 'después' por zona, (3) implementos confirmados, (4) confirmación externa
 * (cliente aprueba verbal, o auditoría visual del líder con foto de cierre,
 * o Auditor presente), (5) T_out."
 *
 * T_out (el evento #5) solo debe aceptarse si los 4 requisitos anteriores
 * ya están completos. Esta función pura decide eso — la ruta de la API
 * (route.ts) solo junta los datos de Supabase y llama aquí.
 */

export interface ZoneClosureStatus {
  zone: string;
  zoneLabel: string;
  totalItems: number;
  completedItems: number;
  /** ¿al menos un ítem de esta zona tiene foto de evidencia? */
  hasAfterPhoto: boolean;
}

export type ExternalConfirmationType =
  | "client_verbal"
  | "leader_audit"
  | "auditor_present";

export interface ClosureProtocolInput {
  zones: ZoneClosureStatus[];
  implementsConfirmed: boolean;
  externalConfirmation: ExternalConfirmationType | null;
}

export interface ClosureProtocolResult {
  complete: boolean;
  /** Mensajes legibles de lo que falta, para devolver al empleado. */
  missing: string[];
}

export function evaluateClosureProtocol(
  input: ClosureProtocolInput
): ClosureProtocolResult {
  const missing: string[] = [];

  if (input.zones.length === 0) {
    missing.push("No hay checklist cargado para este servicio.");
  }

  const incompleteZones = input.zones.filter(
    (z) => z.totalItems > 0 && z.completedItems < z.totalItems
  );
  if (incompleteZones.length > 0) {
    missing.push(
      `Checklist incompleto en: ${incompleteZones
        .map((z) => z.zoneLabel)
        .join(", ")}.`
    );
  }

  const zonesWithoutPhoto = input.zones.filter(
    (z) => z.totalItems > 0 && !z.hasAfterPhoto
  );
  if (zonesWithoutPhoto.length > 0) {
    missing.push(
      `Falta foto "después" en: ${zonesWithoutPhoto
        .map((z) => z.zoneLabel)
        .join(", ")}.`
    );
  }

  if (!input.implementsConfirmed) {
    missing.push("Implementos no confirmados.");
  }

  if (!input.externalConfirmation) {
    missing.push(
      "Falta confirmación externa (cliente, auditoría visual del líder, o auditor presente)."
    );
  }

  return { complete: missing.length === 0, missing };
}
