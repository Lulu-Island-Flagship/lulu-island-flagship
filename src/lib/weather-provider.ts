/**
 * v8.3 E7 (D.10, excepción #10) — Interfaz de consulta de clima.
 *
 * TODO(dueño/infra): no hay integración contratada con Environment Canada
 * (ni credenciales) todavía. Antes de automatizar la detección de clima
 * adverso, integrar la API real de Environment Canada (o un proveedor
 * equivalente) y setear las credenciales como variables de entorno (nunca
 * hardcodeadas). Esta función es la interfaz estable que el resto del
 * sistema debe llamar; hoy la declaración de excepciones de clima
 * (weather_exceptions, migración 143) es 100% manual por el admin —
 * `source = 'manual'`. Cuando exista el proveedor real, este adaptador pasa
 * a devolver `source = 'environment_canada'` sin cambiar el resto del flujo.
 *
 * Mismo patrón que src/lib/sms.ts: mientras no haya proveedor configurado,
 * getForecast() nunca intenta una llamada de red — devuelve status
 * "not_configured" de forma determinista para que el caller pueda registrar
 * el intento sin fallar silenciosamente ni inventar una integración que no
 * existe.
 */

export interface GetForecastInput {
  /** Código postal o coordenadas del área de servicio (Richmond, BC). */
  location: string;
  /** Fecha del servicio a evaluar (YYYY-MM-DD). */
  serviceDate: string;
}

export interface GetForecastResult {
  status: "not_configured" | "ok" | "error";
  /** true si el pronóstico indica condición adversa (nevada, viento fuerte, etc.) — null si status != 'ok'. */
  isAdverse: boolean | null;
  condition: string | null;
  providerResponse: string | null;
}

/**
 * Interfaz estable de consulta de clima. Implementación real pendiente (ver
 * TODO arriba). Nunca lanza: siempre resuelve con un resultado explícito
 * para que el caller decida sin condicionales especiales por proveedor
 * faltante.
 */
export async function getForecast(_input: GetForecastInput): Promise<GetForecastResult> {
  // TODO(dueño/infra): reemplazar este bloque por la llamada real a
  // Environment Canada una vez exista el adaptador. Ejemplo de forma
  // esperada (NO implementado, NO son credenciales reales):
  //
  //   const client = getEnvironmentCanadaClient();
  //   const response = await client.forecast(input.location, input.serviceDate);
  //   return { status: "ok", isAdverse: response.severity >= ADVERSE_THRESHOLD, condition: response.summary, providerResponse: response.id };

  return {
    status: "not_configured",
    isAdverse: null,
    condition: null,
    providerResponse: null,
  };
}
