import {
  type HheObservation,
} from "./hhe-adjustment";
import {
  type PayrollCalculationInput,
} from "./payroll";
import {
  type SystemEvent,
  type EmpleadoHorasRegistradasPayload,
  buildSystemEvent,
} from "./events";

/**
 * v8.3 C.1 — Bridge Despacho → Nómina: conecta hhe-adjustment.ts con
 * payroll.ts a través de un evento `empleado.horas_registradas`.
 *
 * El flujo canónico:
 *   1. El despacho completa → hhe-adjustment registra observaciones reales.
 *   2. Este bridge toma la observación de HHE real, calcula el input de
 *      nómina correspondiente y emite el evento.
 *   3. El consumer de nómina (payroll.ts) recibe el evento y calcula el
 *      pago con day_rate + QC + rework — sin duplicar lógica.
 *
 * Responsabilidades claras:
 *   - hhe-adjustment.ts: solo detecta desviaciones y sugiere ajustes.
 *   - payroll-bridge.ts: solo conecta y emite eventos.
 *   - payroll.ts: solo calcula dinero (función pura).
 *
 * Ninguno de los tres módulos toca la base de datos directamente — el
 * caller (cron/ruta) es responsable de persistir.
 */

// ── Tipos de entrada ────────────────────────────────────────────────────────

/** Datos que vienen del despacho al completar un servicio. */
export interface ServicioCompletado {
  /** ID de la orden de servicio. */
  orderId: string;
  /** ID del empleado que ejecutó el servicio. */
  employeeId: string;
  /** Fecha del servicio (YYYY-MM-DD). */
  fechaServicio: string;
  /** Tipo de servicio (regular, deep, move_in_out, post_construction). */
  serviceType: string;
  /** Banda ft² (ej. "700-1500"). */
  sqftBand: string;
  /** HHE baseline vigente al momento del servicio (de la tabla D.1). */
  baselineHhe: number;
  /** HHE realmente consumida (T_out - T_in normalizado). */
  actualHhe: number;
  /** Zonas completadas durante el servicio. */
  zonasCompletadas: string[];
  /** Day rate del empleado en centavos CAD. */
  dayRateCents: number;
  /** Minutos estimados del servicio (default 480 = 8h). */
  estimatedServiceMinutes: number;
  /** Minutos de rework incurridos (si aplica). */
  reworkMinutes: number;
  /** Score QC del servicio (0-100, undefined si no aplica). */
  qcScore?: number;
}

/** Resultado del bridge: evento emitido + input de nómina derivado. */
export interface PayrollBridgeResult {
  /** El evento validado listo para persistir/publicar. */
  event: SystemEvent;
  /** Input de nómina derivado — listo para alimentar calculatePayroll(). */
  payrollInput: PayrollCalculationInput;
}

// ── Conversión a observación HHE ────────────────────────────────────────────

/**
 * Convierte los datos de un servicio completado a una observación HHE
 * compatible con hhe-adjustment.ts. Esto permite que el mismo dato que
 * alimenta la nómina también alimente la detección de desviaciones,
 * manteniendo una sola fuente de verdad.
 */
export function servicioCompletadoToHheObservation(s: ServicioCompletado): HheObservation {
  return {
    serviceType: s.serviceType,
    sqftBand: s.sqftBand,
    date: s.fechaServicio,
    baselineHhe: s.baselineHhe,
    actualHhe: s.actualHhe,
  };
}

// ── Emisión del evento ──────────────────────────────────────────────────────

/**
 * Emite un evento `empleado.horas_registradas` a partir de los datos de un
 * servicio completado. Esta es la función principal del bridge — conecta
 * el despacho con la nómina sin que ninguno de los dos módulos se acople
 * directamente.
 *
 * @param servicio — datos del servicio completado tal como salen del despacho.
 * @param correlationId — opcional; si no se provee se genera uno nuevo (UUIDv4).
 *   Se recomienda reutilizar el correlation_id de la orden para trazabilidad
 *   end-to-end.
 * @returns PayrollBridgeResult con el evento validado y el input de nómina derivado.
 */
export function emitirHorasRegistradas(
  servicio: ServicioCompletado,
  correlationId?: string,
): PayrollBridgeResult {
  const payload: EmpleadoHorasRegistradasPayload = {
    order_id: servicio.orderId,
    employee_id: servicio.employeeId,
    horas_reales: servicio.actualHhe,
    zonas_completadas: servicio.zonasCompletadas,
    fecha_servicio: new Date(
      `${servicio.fechaServicio}T12:00:00-08:00`
    ).toISOString(),
  };

  const event = buildSystemEvent(
    "empleado.horas_registradas",
    servicio.orderId,
    correlationId ?? crypto.randomUUID(),
    payload,
  );

  const payrollInput: PayrollCalculationInput = {
    dayRate: servicio.dayRateCents,
    estimatedServiceMinutes: servicio.estimatedServiceMinutes,
    reworkMinutes: servicio.reworkMinutes,
    qcScore: servicio.qcScore,
  };

  return { event, payrollInput };
}

/**
 * Emite eventos en lote para múltiples servicios completados.
 * Útil cuando el cron de cierre de jornada procesa todas las órdenes
 * del día de una sola vez.
 *
 * @returns Array de PayrollBridgeResult, uno por cada servicio completado.
 */
export function emitirHorasRegistradasBatch(
  servicios: ServicioCompletado[],
  /** Correlation ID compartido para todo el batch (ej. "cierre-jornada-2026-08-04"). */
  batchCorrelationId?: string,
): PayrollBridgeResult[] {
  const correlationId = batchCorrelationId ?? crypto.randomUUID();
  return servicios.map((s) => emitirHorasRegistradas(s, correlationId));
}

// ── Verificación de coherencia ──────────────────────────────────────────────

/**
 * Verifica que un servicio completado tenga datos coherentes antes de
 * emitir el evento. No bloquea la emisión — devuelve warnings para que
 * el caller decida si loguear o abortar.
 *
 * Chequeos:
 *   - HHE real no puede ser 0 o negativo.
 *   - Zonas completadas no puede estar vacío.
 *   - Day rate debe ser razonable (≥ BC minimum wage × 8h en centavos).
 */
export interface CoherenceWarning {
  field: string;
  message: string;
}

/**
 * @returns Lista de warnings de coherencia. Vacía = todo OK.
 */
export function verificarCoherenciaServicio(servicio: ServicioCompletado): CoherenceWarning[] {
  const warnings: CoherenceWarning[] = [];

  if (servicio.actualHhe <= 0) {
    warnings.push({
      field: "actualHhe",
      message: `HHE real es ${servicio.actualHhe} — debería ser > 0. ¿El servicio se completó?`,
    });
  }

  if (servicio.zonasCompletadas.length === 0) {
    warnings.push({
      field: "zonasCompletadas",
      message: "No hay zonas completadas — ¿se registró correctamente el cierre?",
    });
  }

  // BC minimum wage × 8h = $18.25 × 8 = $146.00 = 14600 cents
  const minReasonableDayRateCents = 14600;
  if (servicio.dayRateCents < minReasonableDayRateCents) {
    warnings.push({
      field: "dayRateCents",
      message: `Day rate ${servicio.dayRateCents}¢ (< $146.00) — ¿está en centavos? Verificar conversión.`,
    });
  }

  return warnings;
}

// ── Constantes ──────────────────────────────────────────────────────────────

/** Mínimo razonable de day rate (BC min wage 18.25 × 8h × 100 cents). */
export const MIN_REASONABLE_DAY_RATE_CENTS = 14600;

/** Sufijo del correlation_id para batches de cierre de jornada. */
export const CIERRE_JORNADA_CORRELATION_PREFIX = "cierre-jornada";
