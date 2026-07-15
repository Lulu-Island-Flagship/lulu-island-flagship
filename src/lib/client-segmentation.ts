/**
 * v8.3 E5.14 — Segmentación de clientes: VIP / Regular / Esporádico / En
 * riesgo / Nuevo. Función pura de clasificación (no toca la base de datos).
 *
 * Esta pieza faltaba y era una dependencia real: `churn-detection.ts` (E10)
 * ya recibe un `pattern: "recurring" | "sporadic"` como entrada, asumiendo
 * que algo más arriba lo calculó -- pero ese "algo" nunca se construyó.
 * `mapSegmentToChurnPattern()` cierra ese puente.
 */

export type ClientSegment = "vip" | "regular" | "sporadic" | "at_risk" | "new";

export interface ClientSegmentInput {
  /** Gasto total del cliente en los últimos 30 días, en CENTAVOS. */
  monthlySpendCents: number;
  /** Cantidad total de servicios completados históricamente (no solo del mes). */
  totalServicesCount: number;
  /** Días desde el último servicio completado. */
  daysSinceLastService: number;
}

export const VIP_MONTHLY_SPEND_THRESHOLD_CENTS = 50000; // $500
export const VIP_SERVICES_THRESHOLD = 10;
export const REGULAR_MIN_MONTHLY_SPEND_CENTS = 20000; // $200
export const NEW_CLIENT_MAX_SERVICES = 2;
export const AT_RISK_DAYS_SINCE_LAST_SERVICE = 60;

/**
 * Precedencia (de mayor a menor prioridad):
 *  1. Nuevo: 1-2 servicios históricos -- no hay suficiente historial para
 *     clasificar por gasto/frecuencia, sin importar cuánto haya gastado en
 *     su primer servicio.
 *  2. En riesgo: 60+ días sin servicio Y ya tiene más de 2 servicios (un
 *     cliente "Nuevo" que tarda en volver no es lo mismo que uno que se
 *     está yendo después de una relación establecida).
 *  3. VIP: >$500/mes O >10 servicios históricos.
 *  4. Regular: $200-500/mes.
 *  5. Esporádico: <$200/mes.
 */
export function computeClientSegment(input: ClientSegmentInput): ClientSegment {
  if (input.totalServicesCount <= NEW_CLIENT_MAX_SERVICES) {
    return "new";
  }
  if (input.daysSinceLastService >= AT_RISK_DAYS_SINCE_LAST_SERVICE) {
    return "at_risk";
  }
  if (input.monthlySpendCents > VIP_MONTHLY_SPEND_THRESHOLD_CENTS || input.totalServicesCount > VIP_SERVICES_THRESHOLD) {
    return "vip";
  }
  if (input.monthlySpendCents >= REGULAR_MIN_MONTHLY_SPEND_CENTS) {
    return "regular";
  }
  return "sporadic";
}

/**
 * Puente hacia src/lib/churn-detection.ts (E10, D.10.9), que espera
 * "recurring" | "sporadic" como patrón de entrada. VIP y Regular son
 * clientes de relación establecida (recurring); Esporádico se mapea tal
 * cual. "new" y "at_risk" no se mapean -- un cliente Nuevo aún no tiene
 * patrón que evaluar por fuga, y uno En riesgo ya ES la señal, no necesita
 * pasar por churn-detection otra vez.
 */
export function mapSegmentToChurnPattern(segment: ClientSegment): "recurring" | "sporadic" | null {
  if (segment === "vip" || segment === "regular") return "recurring";
  if (segment === "sporadic") return "sporadic";
  return null;
}
