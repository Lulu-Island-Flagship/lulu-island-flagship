/**
 * v8.3 E8.4 — "Clima y tráfico 6:00 AM (OpenWeatherMap + Google Traffic):
 * retraso >15 min → SMS automático al cliente con nueva ETA; cierre de vía →
 * ruta alternativa antes de salir."
 *
 * TODO(dueño/infra): no hay integración contratada con OpenWeatherMap ni
 * Google Traffic (ni credenciales) todavía. Mismo patrón que sms.ts y
 * weather-provider.ts (E7): mientras no exista proveedor configurado, esta
 * función nunca intenta una llamada de red — devuelve status
 * "not_configured" de forma determinista para que el caller (el cron de las
 * 6AM) pueda registrar el intento sin fallar silenciosamente ni inventar una
 * integración que no existe.
 */

export interface GetMorningConditionsInput {
  /** Zona/área de servicio a evaluar (Richmond, BC y alrededores). */
  zone: string;
  /** Fecha del día a evaluar (YYYY-MM-DD). */
  date: string;
}

export interface GetMorningConditionsResult {
  status: "not_configured" | "ok" | "error";
  /** Minutos de retraso estimado vs. tiempo de tránsito normal — null si status != 'ok'. */
  estimatedDelayMinutes: number | null;
  /** true si hay cierre de vía reportado en la zona — null si status != 'ok'. */
  roadClosureReported: boolean | null;
  condition: string | null;
  providerResponse: string | null;
}

export const DELAY_SMS_THRESHOLD_MINUTES = 15;

/**
 * Interfaz estable de consulta de clima/tráfico matutino. Implementación
 * real pendiente (ver TODO arriba). Nunca lanza: siempre resuelve con un
 * resultado explícito.
 */
export async function getMorningConditions(_input: GetMorningConditionsInput): Promise<GetMorningConditionsResult> {
  // TODO(dueño/infra): reemplazar por las llamadas reales a OpenWeatherMap +
  // Google Traffic una vez exista el adaptador. Ejemplo de forma esperada
  // (NO implementado, NO son credenciales reales):
  //
  //   const weather = await openWeatherMapClient.current(input.zone);
  //   const traffic = await googleTrafficClient.delayEstimate(input.zone);
  //   return { status: "ok", estimatedDelayMinutes: traffic.delayMinutes, roadClosureReported: traffic.closures.length > 0, condition: weather.summary, providerResponse: `${weather.id}/${traffic.id}` };

  return {
    status: "not_configured",
    estimatedDelayMinutes: null,
    roadClosureReported: null,
    condition: null,
    providerResponse: null,
  };
}

/** ¿El retraso estimado amerita el SMS automático al cliente con nueva ETA? */
export function shouldNotifyClientOfDelay(estimatedDelayMinutes: number | null): boolean {
  return estimatedDelayMinutes !== null && estimatedDelayMinutes > DELAY_SMS_THRESHOLD_MINUTES;
}
