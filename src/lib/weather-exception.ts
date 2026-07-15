/**
 * v8.3 E7 (D.10, excepción #10) — "Clima adverso: Environment Canada; alerta
 * 2h antes, reagendar sin penalización; equipo no llega = aborto seguro +
 * Day Rate + reagendamiento con 20% dcto".
 *
 * Función pura: dado cuánta anticipación hubo entre la alerta y el servicio,
 * decide la resolución correcta. La regla es dura, no discrecional: >= 2h de
 * anticipación siempre reagenda sin penalización; menos de eso (o sin alerta
 * previa, equipo ya en sitio/en camino) siempre es aborto seguro con Day
 * Rate garantizado al empleado y 20% de descuento al cliente en el
 * reagendamiento.
 */

export const WEATHER_ALERT_LEAD_TIME_THRESHOLD_HOURS = 2;
export const WEATHER_SAFE_ABORT_RESCHEDULE_DISCOUNT_PERCENT = 20;

export type WeatherExceptionResolution = "reschedule_no_penalty" | "safe_abort_day_rate_discount";

export interface WeatherExceptionDecision {
  resolution: WeatherExceptionResolution;
  rescheduleDiscountPercent: number | null;
}

/**
 * `alertLeadTimeHours` es null cuando no hubo alerta previa reconocible (el
 * equipo ya estaba en sitio o en camino cuando el clima se volvió adverso) —
 * eso siempre resuelve en aborto seguro, nunca en "reagendar sin penalización"
 * porque no hubo margen para evitar el desplazamiento.
 */
export function classifyWeatherException(alertLeadTimeHours: number | null): WeatherExceptionDecision {
  if (alertLeadTimeHours !== null && alertLeadTimeHours >= WEATHER_ALERT_LEAD_TIME_THRESHOLD_HOURS) {
    return { resolution: "reschedule_no_penalty", rescheduleDiscountPercent: null };
  }
  return {
    resolution: "safe_abort_day_rate_discount",
    rescheduleDiscountPercent: WEATHER_SAFE_ABORT_RESCHEDULE_DISCOUNT_PERCENT,
  };
}
