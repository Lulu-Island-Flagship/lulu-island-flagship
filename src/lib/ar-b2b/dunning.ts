/**
 * AR B2B — Dunning module.
 *
 * Flujo de cobranza preventiva (dunning): recordatorio → aviso → llamada → cobranza.
 */
import { type Factura } from "./invoice";

// =========================================================================
// Types
// =========================================================================

/** Etapas del proceso de dunning. */
export type DunningStage = "recordatorio" | "segundo_aviso" | "llamada" | "cobranza";

/**
 * Registro de una acción de dunning sobre una factura vencida.
 */
export interface DunningRecord {
  /** ID de la factura */
  factura_id: string;
  /** Etapa del flujo de dunning alcanzada */
  etapa: DunningStage;
  /** Días transcurridos desde la fecha de emisión */
  dias_desde_emision: number;
  /** Fecha en que se ejecuta la acción de dunning (ISO 8601) */
  fecha_accion: string;
  /** Mensaje o descripción de la acción */
  mensaje: string;
}

// =========================================================================
// Constants
// =========================================================================

/** Etapas del flujo de dunning. */
export const DUNNING_STAGES = [
  { etapa: "recordatorio" as const, dias: 31, descripcion: "Recordatorio amable de pago por email" },
  { etapa: "segundo_aviso" as const, dias: 45, descripcion: "Segundo aviso — copia a contacto financiero" },
  { etapa: "llamada" as const, dias: 60, descripcion: "Llamada telefónica al cliente" },
  { etapa: "cobranza" as const, dias: 90, descripcion: "Escalación a cobranza externa / legal" },
] as const;

// =========================================================================
// Dunning stage detection
// =========================================================================

/**
 * Determina la etapa de dunning que corresponde a una factura según los
 * días transcurridos desde su emisión.
 *
 * Etapas:
 *  - Día 31: recordatorio
 *  - Día 45: segundo aviso
 *  - Día 60: llamada
 *  - Día 90: cobranza
 *
 * Si no se ha alcanzado ninguna etapa (≤30 días), devuelve null.
 *
 * @param factura — Factura a evaluar.
 * @param fechaReferencia — Fecha de referencia para el cálculo (default: hoy).
 * @returns DunningRecord si corresponde una acción, null si aún no.
 */
export function getDunningStage(
  factura: Factura,
  fechaReferencia?: string,
): DunningRecord | null {
  // Solo facturas con saldo pendiente entran en dunning
  if (factura.saldo_pendiente <= 0n) return null;

  const referencia = fechaReferencia
    ? new Date(`${fechaReferencia}T00:00:00.000Z`)
    : new Date();

  const emision = new Date(`${factura.fecha_emision}T00:00:00.000Z`);
  const diasDesdeEmision = Math.floor(
    (referencia.getTime() - emision.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Recorrer etapas de mayor a menor para encontrar la más avanzada aplicable
  const etapasOrdenadas = [...DUNNING_STAGES].sort((a, b) => b.dias - a.dias);

  for (const etapa of etapasOrdenadas) {
    if (diasDesdeEmision >= etapa.dias) {
      const fechaAccion = new Date(
        emision.getTime() + etapa.dias * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);

      return {
        factura_id: factura.factura_id,
        etapa: etapa.etapa,
        dias_desde_emision: diasDesdeEmision,
        fecha_accion: fechaAccion,
        mensaje: etapa.descripcion,
      };
    }
  }

  return null;
}

/**
 * Obtiene la próxima acción de dunning pendiente para una factura.
 *
 * A diferencia de getDunningStage (que devuelve la etapa actual alcanzada),
 * esta función devuelve la PRÓXIMA etapa que se debe ejecutar cuando
 * se alcancen los días correspondientes.
 *
 * @param factura — Factura a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns La próxima etapa de dunning o null si ya pasaron todas o no aplica.
 */
export function getNextDunningAction(
  factura: Factura,
  fechaReferencia?: string,
): DunningRecord | null {
  if (factura.saldo_pendiente <= 0n) return null;

  const referencia = fechaReferencia
    ? new Date(`${fechaReferencia}T00:00:00.000Z`)
    : new Date();

  const emision = new Date(`${factura.fecha_emision}T00:00:00.000Z`);
  const diasDesdeEmision = Math.floor(
    (referencia.getTime() - emision.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Buscar la primera etapa cuyo umbral de días sea mayor que el actual
  for (const etapa of DUNNING_STAGES) {
    if (diasDesdeEmision < etapa.dias) {
      const fechaAccion = new Date(
        emision.getTime() + etapa.dias * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);

      return {
        factura_id: factura.factura_id,
        etapa: etapa.etapa,
        dias_desde_emision: diasDesdeEmision,
        fecha_accion: fechaAccion,
        mensaje: etapa.descripcion,
      };
    }
  }

  return null; // Ya pasaron todas las etapas
}

// =========================================================================
// Overdue invoices
// =========================================================================

/**
 * Filtra las facturas vencidas con saldo pendiente > 0 desde una colección.
 *
 * Una factura se considera vencida si su fecha_vencimiento es anterior a la
 * fecha de referencia y aún tiene saldo_pendiente > 0. Se excluyen facturas
 * PAGADAS y ANULADAS.
 *
 * @param facturas — Lista de facturas a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns Facturas vencidas no pagadas, ordenadas por días de mora descendente.
 */
export function getOverdueInvoices(
  facturas: Factura[],
  fechaReferencia?: string,
): Factura[] {
  const referencia = fechaReferencia
    ? new Date(fechaReferencia + "T00:00:00.000Z")
    : new Date();

  return facturas
    .filter((f) => {
      if (f.estado === "PAGADA" || f.estado === "ANULADA") return false;
      if (f.saldo_pendiente <= 0n) return false;
      const vencimiento = new Date(f.fecha_vencimiento + "T00:00:00.000Z");
      return vencimiento < referencia;
    })
    .sort((a, b) => {
      const diasA =
        (referencia.getTime() -
          new Date(a.fecha_vencimiento + "T00:00:00.000Z").getTime()) /
        (1000 * 60 * 60 * 24);
      const diasB =
        (referencia.getTime() -
          new Date(b.fecha_vencimiento + "T00:00:00.000Z").getTime()) /
        (1000 * 60 * 60 * 24);
      return diasB - diasA; // Más vencidas primero
    });
}

// =========================================================================
// Dunning actions
// =========================================================================

/**
 * Retorna las acciones de dunning sugeridas para un conjunto de facturas,
 * agrupadas por etapa del flujo de cobranza.
 *
 * Cada acción incluye la factura asociada, la etapa correspondiente, y
 * el mensaje recomendado. Solo se incluyen facturas con saldo pendiente > 0
 * que hayan alcanzado al menos la etapa de recordatorio (31 días).
 *
 * Buckets del flujo:
 *  - 31 días: recordatorio amable por email
 *  - 45 días: segundo aviso con copia a contacto financiero
 *  - 60 días: llamada telefónica al cliente
 *  - 90 días: escalación a cobranza externa / legal
 *
 * @param facturas — Lista de facturas a evaluar.
 * @param fechaReferencia — Fecha de referencia (default: hoy).
 * @returns Acciones de dunning sugeridas, agrupadas por factura.
 */
export function getDunningActions(
  facturas: Factura[],
  fechaReferencia?: string,
): DunningRecord[] {
  const acciones: DunningRecord[] = [];

  for (const factura of facturas) {
    const accion = getDunningStage(factura, fechaReferencia);
    if (accion) {
      acciones.push(accion);
    }
  }

  // Ordenar: etapa más avanzada primero (cobranza → recordatorio), luego por días descendente
  const etapaOrden: Record<DunningStage, number> = {
    cobranza: 4,
    llamada: 3,
    segundo_aviso: 2,
    recordatorio: 1,
  };

  return acciones.sort((a, b) => {
    const cmp = (etapaOrden[b.etapa] ?? 0) - (etapaOrden[a.etapa] ?? 0);
    if (cmp !== 0) return cmp;
    return b.dias_desde_emision - a.dias_desde_emision;
  });
}
